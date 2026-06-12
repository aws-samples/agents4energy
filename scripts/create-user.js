#!/usr/bin/env node
// Usage: node scripts/create-user.js
//
// Creates a Cognito user in the Amplify User Pool and immediately sets their
// password as permanent (no forced-reset on first sign-in).
// Email is prompted and printed; password is prompted silently.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = JSON.parse(
  readFileSync(resolve(root, 'web/amplify_outputs.json'), 'utf8'),
);

const { user_pool_id: userPoolId, aws_region: region } = outputs.auth;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function askSilent(question) {
  return new Promise((resolve) => {
    // Allow the question text through, suppress keystroke echo after.
    let questionWritten = false;
    rl._writeToOutput = (str) => {
      if (!questionWritten) {
        process.stdout.write(str);
        questionWritten = true;
      }
    };
    rl.question(question, (answer) => {
      rl._writeToOutput = (str) => process.stdout.write(str);
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const email = await ask('Email: ');
if (!email) {
  console.error('Email cannot be empty.');
  rl.close();
  process.exit(1);
}

const password = await askSilent('Password: ');
rl.close();
if (!password) {
  console.error('Password cannot be empty.');
  process.exit(1);
}

const client = new CognitoIdentityProviderClient({ region });

// Create the user (suppress the welcome email's temporary password).
await client.send(
  new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: email,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
    ],
    MessageAction: 'SUPPRESS',
  }),
);

// Set a permanent password so the user can sign in immediately.
await client.send(
  new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: email,
    Password: password,
    Permanent: true,
  }),
);

console.log(`Created user: ${email}`);
