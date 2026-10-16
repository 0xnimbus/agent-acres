#!/usr/bin/env node
// One-time setup for the hosted station. Run it yourself from this folder after
// the project is linked to Vercel (`vercel link`):
//
//   npm run setup:vercel
//
// It asks for your Resend API key and sender address, generates SESSION_SECRET and
// AGENT_ACRES_TOKEN, saves all of them as Vercel environment variables, and stores
// ACRES_URL + AGENT_ACRES_TOKEN in your Windows user environment so the Claude Code
// hook can report to the hosted station. Generated secrets are never printed.
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
const shell = process.platform === 'win32';

function setVercelEnv(name, value) {
  for (const target of ['production', 'preview']) {
    spawnSync('vercel', ['env', 'rm', name, target, '--yes'], { stdio: 'ignore', shell });
    const r = spawnSync('vercel', ['env', 'add', name, target], { input: value, stdio: ['pipe', 'ignore', 'inherit'], shell });
    if (r.status !== 0) throw new Error('vercel env add ' + name + ' ' + target + ' failed');
  }
  console.log('  set ' + name);
}

(async () => {
  console.log('Agent Acres hosted setup\n');
  const url = await ask('Station URL (e.g. https://agent-acres.vercel.app): ');
  const resend = await ask('Resend API key (from resend.com/api-keys): ');
  const from = await ask('Sender, on a domain verified in Resend (e.g. Agent Acres <login@yourdomain.com>): ');
  rl.close();
  if (!url || !resend || !from) { console.error('All three are needed.'); process.exit(1); }

  const sessionSecret = crypto.randomBytes(48).toString('base64url');
  const token = crypto.randomBytes(32).toString('base64url');
  console.log('\nSaving to Vercel:');
  setVercelEnv('RESEND_API_KEY', resend);
  setVercelEnv('MAIL_FROM', from);
  setVercelEnv('SESSION_SECRET', sessionSecret);
  setVercelEnv('AGENT_ACRES_TOKEN', token);

  if (process.platform === 'win32') {
    execFileSync('setx', ['ACRES_URL', url.replace(/\/$/, '')], { stdio: 'ignore' });
    execFileSync('setx', ['AGENT_ACRES_TOKEN', token], { stdio: 'ignore' });
    console.log('\nSaved ACRES_URL and AGENT_ACRES_TOKEN to your Windows user environment (new terminals and Claude sessions pick them up).');
  } else {
    console.log('\nAdd these to your shell profile so the Claude Code hook can report:\n  export ACRES_URL=' + url + '\n  export AGENT_ACRES_TOKEN=<the token now in Vercel>');
  }
  console.log('\nDone. Redeploy with:  vercel --prod');
})().catch((e) => { console.error(e.message); process.exit(1); });
