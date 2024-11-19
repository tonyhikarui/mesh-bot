import { coday, start } from './scripts.js';
import readline from 'readline/promises'; 
import fs from 'fs/promises'; 
import crypto from 'crypto';
import { logger } from './logger.js';
import { banner } from './banner.js';
import Mailjs from "@cemalgnlts/mailjs";

const mailjs = new Mailjs();

let headers = {
    'Content-Type': 'application/json',
};

// Register Function
async function register(name, email, password, referral_code) {
    const payloadReg = {
        full_name: name,
        email: email,
        password: password,
        referral_code: referral_code,
    };
    const response = await coday(
        'https://api.meshchain.ai/meshmain/auth/email-signup',
        'POST',
        headers,
        payloadReg
    );
    return response.message || "No message returned";
}

// Login Function
async function login(email, password) {
    const payloadLogin = {
        email: email,
        password: password,
    };
    const response = await coday(
        'https://api.meshchain.ai/meshmain/auth/email-signin',
        'POST',
        headers,
        payloadLogin
    );

    if (response.access_token) {
        logger('Login successful!', "success");
        return response;
    }
    logger('Login failed. Check your credentials.', "error");
    return null;
}

// Verify Email Function
async function verify(email, otp) {
    const payloadVerify = {
        email: email,
        code: otp,
    };
    const response = await coday(
        'https://api.meshchain.ai/meshmain/auth/verify-email',
        'POST',
        headers,
        payloadVerify
    );
    return response.message || "Verify failed";
}

// Claim BNB Reward Function
async function claimBnb(headers) {
    const payloadClaim = { mission_id: "ACCOUNT_VERIFICATION" };
    const response = await coday(
        'https://api.meshchain.ai/meshmain/mission/claim',
        'POST',
        headers,
        payloadClaim
    );
    return response.status || "Claim failed";
}

// Generate a 16-byte hexadecimal string
function generateHex() {
    return crypto.randomBytes(16).toString('hex');
}

// Initialize Node and Save Unique ID
async function init(randomHex, headers) {
    const url = "https://api.meshchain.ai/meshmain/nodes/link";
    const payload = { "unique_id": randomHex, "node_type": "browser", "name": "Extension" };

    const response = await coday(url, 'POST', headers, payload);
    if (response.id) {
        try {
            // Append the unique ID to unique_id.txt
            await fs.appendFile('unique_id.txt', `${response.unique_id}\n`, 'utf-8');
            logger(`ID saved to unique_id.txt: ${response.unique_id}`, "success");
        } catch (err) {
            logger('Failed to save unique ID to file:', "error", err.message);
        }
    }
    return response;
}

async function saveAccountToFile(email, password) {
    try {
        const accountData = `Email: ${email}, Password: ${password}\n`;
        await fs.appendFile('accounts.txt', accountData, 'utf-8');
        logger("Account credentials saved to accounts.txt");
    } catch (error) {
        console.error("Failed to save account credentials:", error);
    }
}

async function manageMailAndRegister() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        logger(banner, "debug");
        const input = await rl.question("How Many Accounts You Want To Create: ");
        const number = parseFloat(input);
        let refCode;
        const ref = await rl.question("Do Your Want Using Refferal Code (y/N): ");
        if (ref === 'N') {
            refCode = await rl.question("Enter Your Refferal Code: ");
        } else {
            refCode = "IOVO3G77Q0QQ";
        }
        logger(`Register Accounts Using Referral Code: ${refCode}`, "info");

        for (let i = 0; i < number; i++) {
            try {
                // Step 1: Create a temporary email account
                const account = await mailjs.createOneAccount();
                const email = account.data.username;
                const password = account.data.password;
                const name = email;

                if (email && password) {
                    logger(`Account #${i + 1} created. Name: ${name}, Email: ${email}`, "debug");

                    // Save email and password to a file
                    await saveAccountToFile(email, password);

                    // Step 2: Register the user
                    const registerMessage = await register(name, email, password, refCode);
                    logger(`Register response: ${registerMessage}`);

                    // Step 3: Log in the user
                    const loginData = await login(email, password);
                    if (!loginData) throw new Error("Login failed.");
                    
                    const accountHeaders = {
                        ...headers,
                        'Authorization': `Bearer ${loginData.access_token}`,
                    };

                    // Log in to email account
                    await mailjs.login(email, password);

                    logger("Waiting for OTP...");
                    const otp = await new Promise((resolve, reject) => {
                        mailjs.on("arrive", async (msg) => {
                            try {
                                logger(`Message id: ${msg.id} has arrived.`);
                                const fullMessage = await mailjs.getMessage(msg.id);
                                const messageText = fullMessage.data.text;

                                // Extract OTP
                                const regex = /Your verification code is:\s*(\d+)/;
                                const match = messageText.match(regex);

                                if (match) {
                                    resolve(match[1]);
                                    mailjs.off();
                                } else {
                                    reject(new Error("Verification code not found."));
                                    mailjs.off();
                                }
                            } catch (err) {
                                reject(err);
                            }
                        });
                        
                    });

                    logger(`Verification Code: ${otp}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Step 4: Verify Email
                    const verifyMessage = await verify(email, otp);
                    logger("Verify email success", "success");

                    // Step 5: Claim Reward
                    const claimMessage = await claimBnb(accountHeaders);
                    logger("Claim 0.01 BNB success", "success");

                    // Step 6: Create and link a unique ID
                    const randomHex = generateHex();
                    logger(`Create Extension ID and Init To accounts: ${randomHex}`, "info");
                    const linkResponse = await init(randomHex, accountHeaders);

                    // Step 7: Save tokens and unique ID
                    await fs.appendFile(
                        'token.txt',
                        `${loginData.access_token}|${loginData.refresh_token}\n`,
                        'utf-8'
                    );
                    logger('Tokens saved to token.txt', "success");
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Step 8: Start the node
                    logger(`Starting Extension ID: ${randomHex}`);
                    const starting = await start(randomHex, accountHeaders);
                    if (starting) {
                        logger(`Extension ID: ${randomHex} is active`, "success");
                    }
                } else {
                    logger(`Account #${i + 1} Created is Failed Retrying...`, "error");
                    i--;
                }
                
            } catch (error) {
                logger(`Error in account ${i + 1}: ${error.message}`, "error");
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } catch (error) {
        console.error("An error occurred:", error);
    } finally {
        rl.close();
    }
}

manageMailAndRegister();
