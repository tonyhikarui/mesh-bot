import { coday, estimate, claim, start, info, infoSpin, doSpin } from './scripts.js';
import { logger } from './logger.js';
import fs from 'fs/promises';
import { banner } from './banner.js';

let headers = {
    'Content-Type': 'application/json',
};

async function readTokensAndIds() {
    try {
        const tokenData = await fs.readFile('token.txt', 'utf-8');
        const tokens = tokenData
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes('|'));

        const idsData = await fs.readFile('unique_id.txt', 'utf-8');
        const uniqueIds = idsData
            .split('\n')
            .map(line => line.trim())
            .filter(line => line);

        let proxies = [];
        try {
            const proxyData = await fs.readFile('proxy.txt', 'utf-8');
            proxies = proxyData.split('\n').filter(line => line.trim());
        } catch (err) {
            logger("File proxy.txt not found, Running without proxy", 'warn');
        }

        if (proxies.length === 0) {
            proxies = null;
        }

        if (tokens.length !== uniqueIds.length) {
            logger("Mismatch between the number of tokens and unique ID lines.", "error");
            return [];
        }

        const accounts = tokens.map((line, index) => {
            const [access_token, refresh_token] = line.split('|').map(token => token.trim());
            const ids = uniqueIds[index].split('|').map(id => id.trim());
            return { access_token, refresh_token, unique_ids: ids, proxy: proxies ? proxies[index % proxies.length] : null };
        });

        return accounts;
    } catch (err) {
        logger("Failed to read token or unique ID file:", "error", err.message);
        return [];
    }
}

const asyncLock = {};
const tokenLocks = new Set();

async function lockAndWrite(file, content) {
    while (asyncLock[file]) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    asyncLock[file] = true;

    try {
        await fs.writeFile(file, content, 'utf-8');
    } finally {
        asyncLock[file] = false;
    }
}

async function refreshToken(refresh_token, accountIndex) {
    if (tokenLocks.has(accountIndex)) {
        logger(`Account ${accountIndex + 1} is already refreshing. Waiting...`, "info");
        while (tokenLocks.has(accountIndex)) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return null;
    }

    tokenLocks.add(accountIndex);

    try {
        logger(`Refreshing access token for Account ${accountIndex + 1}...`, "info");
        const payloadData = { refresh_token };
        const response = await coday("https://api.meshchain.ai/meshmain/auth/refresh-token", 'POST', headers, payloadData);

        if (response && response.access_token) {
            const tokenLines = (await fs.readFile('token.txt', 'utf-8'))
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean);

            tokenLines[accountIndex] = `${response.access_token}|${response.refresh_token}`.trim();
            await lockAndWrite('token.txt', tokenLines.join('\n') + '\n');
            logger(`Account ${accountIndex + 1} token refreshed successfully`, "success");
            return response.access_token;
        }

        logger(`Account ${accountIndex + 1} failed to refresh token`, "error");
        console.log(response);
        return null;
    } catch (err) {
        logger(`Error refreshing token for Account ${accountIndex + 1}: ${err.message}`, "error");
        return null;
    } finally {
        tokenLocks.delete(accountIndex);
    }
}

// Main process for a single account
async function processAccount({ access_token, refresh_token, unique_ids, proxy }, accountIndex) {
    headers = {
        ...headers,
        Authorization: `Bearer ${access_token}`,
    };

    for (const unique_id of unique_ids) {
        const profile = await info(unique_id, headers, proxy);

        if (profile.status === 401) {
            logger(`Account ${accountIndex + 1} | ${unique_id}: Unauthorized, attempting to refresh token...`, "warn");
            const newAccessToken = await refreshToken(refresh_token, accountIndex);
            if (!newAccessToken) return;
            headers.Authorization = `Bearer ${newAccessToken}`;
        } else if (profile.status >= 400) {
            logger(`Account ${accountIndex + 1} | ${unique_id}: Profile fetch failed with status ${profile.status}`, "error");
            logger(`Account ${accountIndex + 1} | ${unique_id}: ${profile.data.message}`, "error");
        } else {
            const { name, total_reward } = profile;
            logger(`Account ${accountIndex + 1} | ${unique_id}: ${name} | Balance: ${total_reward}`, "success");
        }

        const filled = await estimate(unique_id, headers, proxy);
        if (!filled) {
            logger(`Account ${accountIndex + 1} | ${unique_id}: Failed to fetch estimate.`, "error");
            continue;
        }

        if (filled.filled && filled.claimable) {
            logger(`Account ${accountIndex + 1} | ${unique_id}: Attempting to claim reward...`);
            const reward = await claim(unique_id, headers, proxy);
            if (reward) {
                logger(`Account ${accountIndex + 1} | ${unique_id}: Claim successful! New Balance: ${reward}`, "success");
                await start(unique_id, headers);
                logger(`Account ${accountIndex + 1} | ${unique_id}: Started mining again.`, "info");
            } else {
                logger(`Account ${accountIndex + 1} | ${unique_id}: Failed to claim reward, make sure your bnb balance is enough`, "error");
            }
        } else {
            logger(`Account ${accountIndex + 1} | ${unique_id}: Mine already started. Mine value: ${filled.value}`, "info");
        }
    }
    await spins(headers, proxy)
};

async function spins(headers, proxy) {
    logger('Checking Current Round Spins Informations...')
    const spinsData = await infoSpin(headers, proxy);
    if (spinsData) {
        const timeNow = Math.floor(Date.now() / 1000);
        const { spinStartTime, spinEndTime, maxSpinPerUser, userCurrentSpin } = spinsData;
        const timesNow = {
            timeNow: new Date(timeNow * 1000).toLocaleString(),
            spinEndTime: new Date(spinEndTime * 1000).toLocaleString(),
            spinStartTime: new Date(spinStartTime * 1000).toLocaleString(),
        };

        if (timeNow > spinStartTime && timeNow < spinEndTime && userCurrentSpin < maxSpinPerUser) {
            logger(`Let's do Spinning with current account ${accountIndex + 1}`);
            const spinResult = await doSpin(headers, proxy);
            console.log(`Spins result:`, spinResult);
        } else {
            logger(`The current round has already ended, or you have reached the maximum allowed spins.`, 'warn');
            logger(`Current time: ${timesNow.timeNow} | Next Round Spin Time: ${timesNow.spinStartTime}`, 'warn');
        }
    }
}

// Main function
async function main() {
    logger(banner, "debug");

    while (true) {
        const accounts = await readTokensAndIds();

        if (accounts.length === 0) {
            logger("No accounts to process.", "error");
            return;
        }

        logger(`Processing ${accounts.length} accounts...`, "info");

        await Promise.all(
            accounts.map((account, index) =>
                processAccount(account, index)
                    .then(() => {
                        logger(`Account ${index + 1} processed successfully, proxy: ${account.proxy}`, "info");
                    })
                    .catch(error => {
                        logger(`Error processing account ${index + 1}: ${error.message}`, "error");
                    })
            )
        );

        logger("All accounts processed. Waiting 15 minutes for the next run.", "info");
        await new Promise(resolve => setTimeout(resolve, 905 * 1000));
    }
}

process.on('SIGINT', () => {
    logger('Process terminated by user.', 'warn');
    process.exit(0);
});

// Run Main
main();
