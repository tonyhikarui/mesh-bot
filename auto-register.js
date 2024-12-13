import { coday, start } from './scripts.js';
import readline from 'readline/promises';
import fs from 'fs/promises';
import crypto from 'crypto';
import { logger } from './logger.js';
import { banner } from './banner.js';
import Mailjs from '@cemalgnlts/mailjs';
import { solveAntiCaptcha, solve2Captcha } from './utils/solver.js';
//jeff add
var Imap = require("imap");
var mailParser = require("mailparser");
var Promise = require("bluebird");
Promise.longStackTraces();
const util = require('util');
//const simpleParser = require('mailparser');

function inspect(obj) {
    return util.inspect(obj);
}
var imapConfig = {
    user: '123@yahoo.com',
    password: '123',
    host: 'imap.mail.yahoo.com',
    port: 993,
    tls: true
};
var imap;
function openInbox(cb) {
    imap.openBox('INBOX', false, cb);
}
function processMessage(msg) {
    mailParser.simpleParser(msg, 'skipHtmlToText', (err, parsed) => {
        if (err) {
            console.log(err);
        } else {
            // 提取消息文本中的4个数字
            const numbers = parsed.text.match(/is:\s*(\d{4})/);
            if (numbers) {
                console.log('Found numbers in the email:', numbers[1]);
                return numbers[1];
            }
        }
    });
}

const mailjs = new Mailjs();
const headers = { 'Content-Type': 'application/json' };

// Helper: Generate a 16-byte hexadecimal string
function generateHex() {
    return crypto.randomBytes(16).toString('hex');
}

// Helper: Save data to a file
async function saveToFile(filename, data) {
    try {
        await fs.appendFile(filename, `${data}\n`, 'utf-8');
        logger(`Data saved to ${filename}`, 'success');
    } catch (error) {
        logger(`Failed to save data to ${filename}: ${error.message}`, 'error');
    }
}

// Captcha Solver
async function captchaSolver(type, apiKey) {
    return type === '2captcha' || type === '1'
        ? solve2Captcha(apiKey)
        : solveAntiCaptcha(apiKey);
}

// Wait for OTP Email
async function waitForEmail(mailjs, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        const messages = await mailjs.getMessages();
        if (messages.data.length > 0) {
            const message = messages.data[0];
            const fullMessage = await mailjs.getMessage(message.id);
            const match = fullMessage.data.text.match(/Your verification code is:\s*(\d+)/);
            if (match) return match[1];
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Verification email not received.');
}



//jeff addd
async function waitForOTP(email, password) {
    imapConfig = {
        user: email,
        password: password,
        host: 'imap.mail.yahoo.com',
        port: 993,
        tls: true
    };
    imap = new Imap(imapConfig);
    Promise.promisifyAll(imap);
    const retries = 10;
    const delay = 5000;
    for (let i = 0; i < retries; i++) {
        imap.once('ready', function () {
            openInbox((function (err, box), iamp) {
                if(err) throw err;

                imap.search(['SEEN', ['SUBJECT', 'MeshChain Account Verification']], function (err, results) {
                    if (err) {
                        console.error('Error searching emails: ' + err);
                        imap.end();
                        return;
                    }
                    if (results.length === 0) {
                        console.log('No unseen emails found');
                        imap.end();
                        return;

                    } else {
                        console.log('Found ' + results.length);
                        // Fetch emails...

                        const f = imap.fetch(results, { bodies: '', markSeen: true });
                        //      var f = imap.seq.fetch(box.messages.total + ':*', { bodies: ['HEADER.FIELDS (FROM)','TEXT'] });
                        f.on('message', function (msg, seqno) {
                            //console.log('Message #%d', seqno);

                            var prefix = '(#' + seqno + ') ';
                            msg.on('body', function (stream, info) {
                                processMessage(stream);
                            });

                            f.once('error', function (err) {
                                console.log('Fetch error: ' + err);
                            });
                            f.once('end', function () {
                                console.log('Done fetching all messages!');
                                imap.end();
                            });
                        }
                });
            });
        });
        await new Promise(resolve => setTimeout(resolve, delay));
    }//rery

    imap.connect();
}


// Registration Function
async function register(typeKey, apiKey, name, email, password, referralCode) {
    try {
        const payload = {
            captcha_token: await captchaSolver(typeKey, apiKey),
            full_name: name,
            email,
            password,
            referral_code: referralCode,
        };
        const response = await coday('https://api.meshchain.ai/meshmain/auth/email-signup', 'POST', headers, payload);
        if (!response || response.error) throw new Error(response.error || 'Unknown registration error.');
        return response.message || 'No message returned.';
    } catch (error) {
        logger(`Register failed: ${error.message}`, 'error');
        throw error;
    }
}

// Login Function
async function login(typeKey, apiKey, email, password) {
    try {
        const payload = {
            captcha_token: await captchaSolver(typeKey, apiKey),
            email,
            password,
        };
        const response = await coday('https://api.meshchain.ai/meshmain/auth/email-signin', 'POST', headers, payload);
        if (response.access_token) {
            logger('Login successful!', 'success');
            return response;
        }
        throw new Error('Login failed. Check your credentials.');
    } catch (error) {
        logger(`Login error: ${error.message}`, 'error');
        throw error;
    }
}

// Verify Email Function
async function verify(typeKey, apiKey, email, otp) {
    try {
        const payload = {
            captcha_token: await captchaSolver(typeKey, apiKey),
            email,
            code: otp,
        };
        const response = await coday('https://api.meshchain.ai/meshmain/auth/verify-email', 'POST', headers, payload);
        if (!response || response.error) throw new Error(response.error || 'Verification failed.');
        return response.message || 'Verification succeeded.';
    } catch (error) {
        logger(`Email verification error: ${error.message}`, 'error');
        throw error;
    }
}

// Claim BNB Reward
async function claimBnb(headers) {
    try {
        const payload = { mission_id: 'EMAIL_VERIFICATION' };
        const response = await coday('https://api.meshchain.ai/meshmain/mission/claim', 'POST', headers, payload);
        logger(`Claim response: ${JSON.stringify(response)}`, 'debug');
        return response.status;
    } catch (error) {
        logger(`Claim error: ${error.message}`, 'error');
        throw error;
    }
}

// Link Node Function
async function initNode(randomHex, headers) {
    try {
        const payload = { unique_id: randomHex, node_type: 'browser', name: 'Extension' };
        const response = await coday('https://api.meshchain.ai/meshmain/nodes/link', 'POST', headers, payload);
        if (!response.id) throw new Error('Failed to link node.');
        await saveToFile('unique_id.txt', response.unique_id);
        return response;
    } catch (error) {
        logger(`Node initialization error: ${error.message}`, 'error');
        throw error;
    }
}

// Main Function: Manage Mail and Registration
async function manageMailAndRegister() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
        logger(banner, 'debug');
        const typeKey = "2";//await rl.question('Choose Captcha API (1: 2Captcha, 2: Anti-Captcha): ');
        const apiKey = "2d49fc8ce88d95b9c2854380c8897405";//await rl.question('Enter Captcha API Key: ');
        if (!apiKey) throw new Error('Invalid API key.');


        const accounts = await readToken("accounts.txt");
        const proxies = await readToken("proxy.txt");


        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            var acc = account.toString().split(":");
            const email = acc[0];
            const password = acc[1];
            const proxy = proxies[i];
            var names = email.toString().split("@");
            const name = names[0];
            console.log("name is: ", name);
            await delay(5000);

            const referralCode = "DJNMDUID1PL5";//await rl.question('Use my referral code? (y/N): ');
            try {
                /*
                logger(`Creating account #${i + 1} - Email: ${email}`, 'debug');
                await mailjs.login(email, password);
                logger('Logged into temporary email.');
                */
                await register(typeKey, apiKey, name, email, password, referralCode);

                //const otp = await waitForEmail(mailjs);
                const otp = await waitForOTP(email, password);

                logger(`OTP retrieved: ${otp}`, 'success');

                await verify(typeKey, apiKey, email, otp);
                await claimBnb(accountHeaders);

                const loginData = await login(typeKey, apiKey, email, password);
                const accountHeaders = { ...headers, Authorization: `Bearer ${loginData.access_token}` };

                const randomHex = generateHex();
                logger(`Initializing node with ID: ${randomHex}`, 'info');
                await initNode(randomHex, accountHeaders);

                //await saveToFile('accounts.txt', `Email: ${email}, Password: ${password}`);
                await saveToFile('token.txt', `${loginData.access_token}|${loginData.refresh_token}`);
                logger(`Account #${i + 1} created successfully.`, 'success');
            } catch (error) {
                logger(`Error with account #${i + 1}: ${error.message}`, 'error');
            }
        }
    } catch (error) {
        logger(`Error: ${error.message}`, 'error');
    } finally {
        rl.close();
    }
}

manageMailAndRegister();
