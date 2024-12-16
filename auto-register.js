import "./addRequire.js";
import { readToken, delay } from "./utils/file.js";
import { coday, start } from './scripts.js';
import readline from 'readline/promises';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from './logger.js';
import { banner } from './banner.js';
//import Mailjs from '@cemalgnlts/mailjs';
import { solveAntiCaptcha, solve2Captcha } from './utils/solver.js';
const { promisify } = require('util');
//jeff add
const Imap = require("imap");
var mailParser = require("mailparser");
var Promise = require("bluebird");
Promise.longStackTraces();
const util = require('util');
//const simpleParser = require('mailparser');
const fs_account = require('fs').promises; 
const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'origin': 'https://app.meshchain.ai',
    'referer': 'https://app.meshchain.ai/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' // Optional, if required by API
};
const getAPI = () => {
    return fs.readFileSync('apikey.txt', 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
};
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


async function processMessage(msg) {
    return new Promise((resolve, reject) => {
        mailParser.simpleParser(msg, 'skipHtmlToText', (err, parsed) => {
            if (err) {
                console.error(err);
                reject(err); // 拒绝 Promise 并传递错误
            } else {
                // 提取消息文本中的4个数字
                const numbers = parsed.text.match(/is:\s*(\d{4})/);
                if (numbers) {
                    console.log('Found numbers in the email:', numbers[1]);
                    resolve(numbers[1]); // 解决 Promise 并传递找到的数字
                } else {
                    reject(new Error('No numbers found in the email.')); // 如果没有找到数字，则拒绝 Promise
                }
            }
        });
    });
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

// resend mail Function
async function resend(email) {
    try {
        const payload = {
            email: email
        };
        const response = await coday('https://api.meshchain.ai/meshmain/auth/resend-email', 'POST', headers, payload);
        console.log('resend mail for server Response :', response);

        // Check for errors in the response
        if (!response || response.error) {
            throw new Error(response.error || 'Resend verification code error.');
        }

        // Return the message or a fallback string if no message is found
        return response.message || 'No message returned.';
    } catch (error) {
        // Log the error message from the caught error
        console.error(`Resend failed: ${error.message}`);
        // Log using your custom logger function
        throw error;
    }
}



async function register(typeKey, apiKey, name, email, password, referralCode) {
    try {
        // Construct the payload with captcha token and user details
        const payloadReg = {
            captcha_token: await solveAntiCaptcha(apiKey),
            full_name: name,
            email: email,
            password: password,
            referral_code: referralCode
        };

        // Send the POST request to the API
        const response = await coday(
            'https://api.meshchain.ai/meshmain/auth/email-signup',
            'POST',
            headers,
            payloadReg
        );
        console.log('Response object:', response);

        // Check if the response object exists
        if (response) {
            // Handle conflict if user already exists (HTTP 409)
            if (response.status && response.status === 409) {
                if (response.data && response.data.message) {
                    if (response.data.message.includes('exists')) {
                        console.log('Error message: User already exists');
                        return response.data.message;  // Return error message
                    } else {
                        console.log('Message received:', response.data.message);  // Other messages
                    }
                } else {
                    console.log('No message returned in the response data.');
                }
            } else if (response.message) {
                // If there's a message in the response
                if (response.message.includes('Verification')) {
                    console.log('Success message: Account created, please verify email');
                    return response.message;  // Return verification success message
                } else {
                    console.log('Message received:', response.message);  // Handle other types of messages
                }
            } else {
                console.log('No message returned in the response data.');
            }
        } else {
            console.log('No valid response returned from the API.');
            throw new Error('No valid response or data returned from the API.');
        }
    } catch (error) {
        // Log the error and throw it
        console.error(`Registration failed: ${error.message}`);
        throw error;  // Throw the error after logging it
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
        console.log('Verify mail by server Response :', response);
        if (!response || response.error) throw new Error(response.error || 'Verification failed.');
        return response.message || 'Verification succeeded.';
    } catch (error) {
        logger(`Email verification error: ${error.message}`, 'error');
        throw error;
    }
}


async function waitForOTP(email, password) {
    const imapConfig = {
        user: email,
        password: password,
        host: 'imap.mail.yahoo.com',
        port: 993,
        tls: true
    };

    const imap = new Imap(imapConfig);

    // Promisify the required IMAP methods
    const openInboxAsync = promisify(imap.openBox.bind(imap));
    const searchAsync = promisify(imap.search.bind(imap));
    const fetchAsync = promisify(imap.fetch.bind(imap));

    return new Promise((resolve, reject) => {
        /*
                imap.once('ready', function() {
                    imap.getBoxes((err, boxes) => {
                        if (err) {
                            console.error('Error getting boxes:', err);
                            return;
                        }
                        console.log('IMAP Folders:', boxes);
                        // You should see the folder names here, including 'Spam' or 'INBOX.Spam'
                        imap.end();
                    });
                });
        */
        imap.once('ready', async () => {
            try {
                console.log('Opening INBOX...');
                const boxInInbox = await openInboxAsync('INBOX', false);

                console.log('Searching for emails in INBOX...');
                let resultsInInbox = await searchAsync(['UNSEEN', ['SUBJECT', 'MeshChain Account Verification']]);

                // If no emails found in INBOX, search in Bulk (Junk) folder
                if (resultsInInbox.length === 0) {
                    //console.log('No unseen emails found in INBOX. Searching in Bulk (Junk) folder...');
                    const boxInBulk = await openInboxAsync('Bulk', false);  // Open Bulk folder
                    resultsInInbox = await searchAsync(['UNSEEN', ['SUBJECT', 'MeshChain Account Verification']]);
                }

                // If still no emails found, reject the promise
                if (resultsInInbox.length === 0) {
                    console.log('No OTP email found in either INBOX or Bulk folder');
                    imap.end();
                    return reject(new Error('No OTP email found'));
                }

                console.log(`Found ${resultsInInbox.length} unseen emails in INBOX or Bulk folder`);

                // Now, fetch the email messages
                const fetch = imap.fetch(resultsInInbox, { bodies: '', markSeen: true });

                fetch.on('message', (msg, seqno) => {
                    console.log(`Fetching message #${seqno}`);

                    msg.on('body', async (stream) => {
                        try {
                            // Process the email body stream to extract OTP
                            const otp = await processMessage(stream);  // Assuming processMessage returns OTP
                            console.log('OTP extracted:', otp);

                            imap.end();
                            resolve(otp);  // Return the OTP once it's extracted
                        } catch (err) {
                            console.error('Error processing message:', err);
                            imap.end();
                            reject(err);  // Reject in case of any processing error
                        }
                    });

                    msg.once('end', () => {
                        console.log(`Finished processing message #${seqno}`);
                    });
                });

                fetch.once('error', (err) => {
                    console.error('Fetch error:', err);
                    imap.end();
                    reject(err);
                });

                fetch.once('end', () => {
                    console.log('Done fetching messages!');
                });

            } catch (err) {
                console.error('Error during IMAP operations:', err);
                imap.end();
                reject(err);
            }
        });

        imap.once('error', (err) => {
            console.error('IMAP connection error:', err);
            imap.end();
            reject(err);
        });

        imap.connect();
    });
}


async function waitForOTPWithRetry(email, password, maxRetries = 10, delay = 5000) {
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            // Increment attempt count
            attempt++;
            console.log(`Attempt ${attempt} of ${maxRetries} to wait for OTP...`);

            // Try to wait for the OTP
            const otp = await waitForOTP(email, password);

            // If OTP is retrieved, return it and stop the retries
            console.log(`OTP retrieved: ${otp}`);
            return otp;
        } catch (error) {
            console.error(`Error waiting for OTP on attempt ${attempt}: ${error.message}`);

            // If we've reached the max retries, throw an error
            if (attempt >= maxRetries) {
                throw new Error('Max retries reached. OTP not retrieved.');
            }

            // Otherwise, wait for the specified delay before retrying
            console.log(`Retrying in ${delay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // Optionally, you can increase the delay for exponential backoff:
            // delay *= 2; // Exponential backoff (optional)
        }
    }
}


// The main function to handle the OTP process
async function handleOTPProcess(email, password, typeKey, apiKey) {
    try {
        // Attempt to retrieve OTP with retry mechanism
        const otp = await waitForOTPWithRetry(email, password);

        // Log OTP retrieval success
        logger(`OTP retrieved: ${otp}`, 'success');

        logger(`Verifying`, 'debug');

        // Await the verify call to ensure OTP verification completes before moving forward
        await verify(typeKey, apiKey, email, otp);

        // Log success after OTP has been verified and login is complete
        logger(`OTP verified successful`, 'success');

     } catch (error) {
        // Handle errors that occur during the OTP retrieval, login, or verification process
        console.error('Error during OTP or login process:', error.message);
        // Handle the failure (e.g., notify the user to retry manually or log the error)
    }
}


// Main Function: Manage Mail and Registration
async function manageMailAndRegister() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const anti_apiKey = getAPI();
    try {
        //logger(banner, 'debug');
        const typeKey = "2";//await rl.question('Choose Captcha API (1: 2Captcha, 2: Anti-Captcha): ');
        const apiKey = anti_apiKey[0];//await rl.question('Enter Captcha API Key: ');
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
            console.log("email is: ", email);
            console.log("password is: ", password);
            await delay(5000);

            const referralCode = "DJNMDUID1PL5";//await rl.question('Use my referral code? (y/N): ');
            try {

                logger(`Creating account #${i + 1} - Email: ${email}`, 'debug');

                try {
                    // Attempt to register the user
                    const message = await register(typeKey, apiKey, name, email, password, referralCode);
                    logger(`Registration Result:: ${message}`, 'debug');  // Log the message for debugging

                    // Check if the registration message indicates the email already exists
                    if (message.includes('exists')) {
                        console.log('Email already exists, attempting to resend email:', email);

                        try {
                            // Attempt to resend the verification email
                            const resend_message = await resend(email);
                            console.log('Resend message:', resend_message);

                        } catch (error) {
                            // Handle resend-specific errors
                            console.error('Resend failed:', error.message);
                            logger(`Resend failed for email ${email}: ${error.message}`, 'error');
                        }
                    } else {
                        console.log('Registration successful:', message);
                    }

                } catch (error) {
                    // General registration error                    
                    logger(`Registration failed for ${email}: ${error.message}`, 'error');
                }

                // Usage: Call the handleOTPProcess function with appropriate parameters
                await handleOTPProcess(email, password, typeKey, apiKey);

                await saveAccount(email, password, i);           


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



async function saveAccount(email, password, i) {
    try {
        // Append account to reg_success.txt
        await fs_account.appendFile(
            'reg_success.txt',
            `${email}|${password}\n`,
            'utf-8'
        );
        logger(`Account ${email}saved to reg_success.txt`, "success");
        logger(`Account #${i + 1} created successfully.`, 'success');
    } catch (err) {
        logger('Failed to save data to reg_success.txt:', "error", err.message);
    }
}



manageMailAndRegister();
