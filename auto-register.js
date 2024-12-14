import "./addRequire.js";
import { readToken, delay } from "./utils/file.js";
import { coday, start } from './scripts.js';
import readline from 'readline/promises';
import fs from 'fs/promises';
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
//const imap = new Imap(imapConfig);
function openInbox(cb) {
    imap.openBox('INBOX', false, cb);
}

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

// resend mail Function
async function resend(email) {
    try {
        const payload = {
            email: email
        };
        const response = await coday('https://api.meshchain.ai/meshmain/auth/resend-email', 'POST', headers, payload);
        if (!response || response.error) throw new Error(response.error || 'Unknown registration error.');
        return response.message || 'No message returned.';
    } catch (error) {
        logger(`Register failed: ${error.message}`, 'error');
        throw error;
    }
}


async function register(typeKey, apiKey, name, email, password, referralCode) {
    try {
        // Construct the payload with captcha token and user details
        const payload = {
            captcha_token: await captchaSolver(typeKey, apiKey),
            full_name: name,
            email: email,
            password: password,
            referral_code: referralCode
        };

        // Send the registration request
        const response = await coday('https://api.meshchain.ai/meshmain/auth/email-signup', 'POST', headers, payload);

        // Check for errors in the response
        if (!response || response.error) {
            throw new Error(response.error || 'Unknown registration error.');
        }

        // If a message is returned in the response, check its type
        if (response.message) {
            // If it's a string, check for specific keywords
            if (typeof response.message === 'string') {
                if (response.message.includes('success')) {
                    console.log('Success message:', response.message);
                } else if (response.message.includes('exists')) {
                    console.log('Error message:', response.message);
                } else {
                    console.log('Message received:', response.message);
                }
            }
            // If it's an object, inspect its contents
            else if (typeof response.message === 'object') {
                // Example: Check if the object has a 'status' or 'error' field
                if (response.message.status === 'success') {
                    console.log('Success:', response.message);
                } else if (response.message.errorCode) {
                    console.log('Error code:', response.message.errorCode);
                } else {
                    console.log('Object message:', response.message);
                }
            }
        } else {
            console.log('No message returned.');
        }

        // Return the message or a fallback string if no message is found
        return response.message || 'No message returned.';
    } catch (error) {
        // Log the error and throw it
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

/*
//jeff addd
function waitForOTP(email, password) {
    imapConfig = {
        user: email,
        password: password,
        host: 'imap.mail.yahoo.com',
        port: 993,
        tls: true
    };
    imap = new Imap(imapConfig);
    Promise.promisifyAll(imap);

        imap.once('ready', function () {
            console.log('open inbox');
            openInbox(function (err, box) {                
                if(err) throw err;
                console.log('search email content');
                imap.search(['UNSEEN', ['SUBJECT', 'MeshChain Account Verification']], function (err, results) {
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

                        const f = imap.fetch(results, { bodies: '', markSeen: false });
                        //      var f = imap.seq.fetch(box.messages.total + ':*', { bodies: ['HEADER.FIELDS (FROM)','TEXT'] });
                        f.on('message', function (msg, seqno) {
                            //console.log('Message #%d', seqno);

                            var prefix = '(#' + seqno + ') ';
                            msg.on('body', function (stream, info) {
                                processMessage(stream).then((numbers) => {
                                    console.log('Numbers extracted:', numbers);
                                    var otp = numbers;
                                    return otp;
                                  }).catch((error) => {
                                    console.error('Failed to process message:', error);
                                  });
                                

                            });

                            f.once('error', function (err) {
                                console.log('Fetch error: ' + err);
                            });
                            f.once('end', function () {
                                console.log('Done fetching all messages!');
                                imap.end();
                            });
                        });
                    }    
                });
            });
        });

    imap.connect();
}

*/

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
                // Open INBOX folder
                console.log('Opening INBOX...');
                const boxInInbox = await openInboxAsync('INBOX', false);

                console.log('Searching for emails in INBOX...');
                const resultsInInbox = await searchAsync(['UNSEEN', ['SUBJECT', 'MeshChain Account Verification']]);

                // Open Bulk folder
                console.log('Opening Bulk folder...');
                const boxInBulk = await openInboxAsync('Bulk', false);

                console.log('Searching for emails in Bulk...');
                const resultsInBulk = await searchAsync(['UNSEEN', ['SUBJECT', 'MeshChain Account Verification']]);

                // Combine the results from both folders
                const allResults = [...resultsInInbox, ...resultsInBulk];

                if (allResults.length === 0) {
                    console.log('No unseen emails found in INBOX or Bulk folder');
                    imap.end();
                    return Promise.reject(new Error('No OTP email found'));
                }

                console.log(`Found ${allResults.length} unseen emails in INBOX or Bulk folder`);

                // Fetch emails from both folders in parallel using Promise.all
                const [otpFromInbox, otpFromBulk] = await Promise.all([
                    fetchEmailsFromFolder(imap, resultsInInbox),
                    fetchEmailsFromFolder(imap, resultsInBulk)
                ]);
        
                // You can choose to return or process either OTP or both
                if (otpFromInbox) {
                    console.log('OTP from Inbox:', otpFromInbox);
                }
        
                if (otpFromBulk) {
                    console.log('OTP from Bulk:', otpFromBulk);
                }

            } catch (error) {
                console.error('Error fetching emails:', error);
                imap.end();
                return Promise.reject(error);
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


async function fetchEmailsFromFolder(imap, results, timeout = 10000) {
    if (results.length === 0) {
        console.log('No emails to fetch.');
        return null; // Return null if no emails
    }

    return new Promise((resolve, reject) => {
        console.log(`Starting to fetch ${results.length} email(s) from folder`);

        const fetch = imap.fetch(results, { bodies: '', markSeen: true });

        let timeoutId = setTimeout(() => {
            console.log('Fetch timed out');
            fetch.abort(); // Abort fetch operation after the timeout
            reject(new Error('Message fetch timed out'));
        }, timeout);

        fetch.on('message', (msg, seqno) => {
            console.log(`Fetching message #${seqno}`);

            let emailBody = '';

            msg.on('body', (stream) => {
                console.log(`Streaming body of message #${seqno}`);

                stream.on('data', (chunk) => {
                    console.log(`Received chunk for message #${seqno}: ${chunk.toString().slice(0, 100)}...`); // Log first 100 chars of chunk
                    emailBody += chunk.toString(); // Collect body data
                });

                stream.on('end', async () => {
                    console.log(`Finished streaming body of message #${seqno}`);
                    try {
                        console.log(`Processing email body for OTP extraction: ${emailBody.slice(0, 100)}...`); // Log first 100 chars of email body
                        const otp = await processMessage(emailBody); // Process OTP from email body
                        console.log('OTP extracted:', otp);
                        clearTimeout(timeoutId); // Clear timeout on successful resolution
                        resolve(otp); // Resolve with OTP if found
                    } catch (err) {
                        console.error(`Error processing message #${seqno}:`, err);
                        clearTimeout(timeoutId); // Clear timeout if processing fails
                        reject(err);  // Reject the promise if error in processing
                    }
                });
            });

            msg.once('end', () => {
                console.log(`Finished processing message #${seqno}`);
            });
        });

        
        fetch.once('error', (err) => {
            console.error('Fetch error:', err);
            clearTimeout(timeoutId); // Clear timeout on fetch error
            reject(err);  // Reject if fetch fails
        });

        fetch.once('end', () => {
            console.log('Done fetching messages!');
            clearTimeout(timeoutId); // Clear timeout on fetch end
        });
    });
}




async function waitForOTPWithRetry(email, password, maxRetries = 3, delay = 5000) {
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
        console.log('OTP successfully retrieved:', otp);
        logger(`OTP retrieved: ${otp}`, 'success');

        // Await the login data so that it resolves before proceeding
        const loginData = await login(typeKey, apiKey, email, password);

        // Ensure login data has access token
        if (!loginData || !loginData.access_token) {
            throw new Error('Login failed, no access token returned');
        }

        // Use the login data to set authorization headers
        const accountHeaders = { ...headers, Authorization: `Bearer ${loginData.access_token}` };

        // Log the start of OTP verification
        logger(`Verifying`, 'debug');

        // Await the verify call to ensure OTP verification completes before moving forward
        await verify(typeKey, apiKey, email, otp);

        // Log success after OTP has been verified and login is complete
        logger(`OTP verified and login successful`, 'success');

        // Proceed with the rest of your logic (e.g., login or other actions)
        console.log('Proceeding with further logic after login...');
    } catch (error) {
        // Handle errors that occur during the OTP retrieval, login, or verification process
        console.error('Error during OTP or login process:', error.message);
        // Handle the failure (e.g., notify the user to retry manually or log the error)
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
            console.log("email is: ", email);
            console.log("password is: ", password);
            await delay(5000);

            const referralCode = "DJNMDUID1PL5";//await rl.question('Use my referral code? (y/N): ');
            try {

                logger(`Creating account #${i + 1} - Email: ${email}`, 'debug');

                try {
                    //const message = await register(typeKey, apiKey, name, email, password, referralCode);
                    logger(`Registration Result:: ${message}`, 'debug');
                } catch (error) {
                    console.error('Registration failed:', error.message);
                }


                // Usage: Call the handleOTPProcess function with appropriate parameters
                handleOTPProcess(email, password, typeKey, apiKey);


                //await claimBnb(accountHeaders);
                /*    
                const randomHex = generateHex();
                logger(`Initializing node with ID: ${randomHex}`, 'info');
                await initNode(randomHex, accountHeaders);

                //await saveToFile('accounts.txt', `Email: ${email}, Password: ${password}`);
                await saveToFile('token.txt', `${loginData.access_token}|${loginData.refresh_token}`);
                logger(`Account #${i + 1} created successfully.`, 'success');
                */

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
