#!/usr/bin/env node
// Send one event to a running Agent Acres server. Handy from scripts and agents.
//   node bin/emit.js task.start ebay "List 5 vintage items" --detail "From the garage bin"
//   node bin/emit.js task.progress ebay "Uploaded photos" --pct 50
//   node bin/emit.js task.done ebay "5 listings live" --url https://ebay.com/... --value "$85"
//   node bin/emit.js task.fail ebay "eBay API rate limit"
//   node bin/emit.js agent.idle ebay
//   node bin/emit.js agent.hello scout --name Scout --business "Lead research"
// Env: ACRES_URL (default http://127.0.0.1:8790), AGENT_ACRES_TOKEN
'use strict';

const [type, agent, text, ...rest] = process.argv.slice(2);
if (!type || !agent) {
  console.error('Usage: node bin/emit.js <type> <agent-id> [text] [--key value ...]');
  process.exit(1);
}

const ev = { type, agent };
const textField = { 'task.start': 'title', 'task.progress': 'note', 'task.done': 'result', 'task.fail': 'error', 'agent.idle': 'note', note: 'text', 'agent.hello': 'name' }[type];
if (text !== undefined) {
  if (text.startsWith('--')) rest.unshift(text);
  else if (textField) ev[textField] = text;
}
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, '');
  const val = rest[i + 1];
  ev[key] = key === 'pct' ? Number(val) : val;
}

const base = process.env.ACRES_URL || 'http://127.0.0.1:8790';
const headers = { 'Content-Type': 'application/json' };
if (process.env.AGENT_ACRES_TOKEN) headers.Authorization = 'Bearer ' + process.env.AGENT_ACRES_TOKEN;

fetch(base + '/api/events', { method: 'POST', headers, body: JSON.stringify(ev) })
  .then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('Rejected: ' + (body.error || r.status)); process.exit(1); }
    console.log('ok ' + body.id);
  })
  .catch((e) => { console.error('Could not reach ' + base + ': ' + e.message); process.exit(1); });
