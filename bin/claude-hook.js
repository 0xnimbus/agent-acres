#!/usr/bin/env node
// Claude Code hook: reports what a Claude session is doing to Agent Acres, so each
// project you work on shows up as a worker in its own room.
//
// Wire it up in a settings.json "hooks" block for these events:
//   SessionStart, UserPromptSubmit, Notification, Stop, SessionEnd
// with the command:  node "<path to agent-acres>/bin/claude-hook.js"
//
// Env:
//   ACRES_URL           where the station is (default http://127.0.0.1:8790)
//   AGENT_ACRES_TOKEN   required for the hosted (Vercel) station
//   ACRES_PROJECT       room name (default: the project folder's name)
//   ACRES_AGENT         worker id (default: derived from the project name)
//
// It never blocks or fails a Claude session: errors are swallowed and it gives up after 3 seconds.
'use strict';

const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => { main().catch(() => {}).finally(() => process.exit(0)); });
setTimeout(() => process.exit(0), 3000).unref();

const PRETTY = { 'jobhunt.ai': 'JobHunt.ai', jobhuntai: 'JobHunt.ai', habixrpg: 'Habix RPG', 'habix-rpg': 'Habix RPG', 'agent-acres': 'Agent Acres' };

async function main() {
  let h = {};
  try { h = JSON.parse(input || '{}'); } catch { return; }
  const folder = path.basename(h.cwd || process.cwd());
  const project = process.env.ACRES_PROJECT || PRETTY[folder.toLowerCase()] || folder;
  const agent = (process.env.ACRES_AGENT || ('claude-' + project)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'claude';
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

  const events = [];
  switch (h.hook_event_name) {
    case 'SessionStart':
      events.push({ type: 'agent.hello', agent, name: 'Claude', project, business: 'Claude Code on ' + project, model: process.env.ACRES_MODEL || undefined });
      break;
    case 'UserPromptSubmit':
      events.push({ type: 'agent.hello', agent, name: 'Claude', project, business: 'Claude Code on ' + project });
      events.push({ type: 'task.start', agent, task: h.session_id, title: clip(h.prompt, 120) || 'New request' });
      break;
    case 'Notification':
      events.push({ type: 'task.progress', agent, task: h.session_id, note: clip(h.message, 120) || 'Waiting for you' });
      break;
    case 'Stop':
      events.push({ type: 'task.done', agent, task: h.session_id, result: 'Finished, waiting for your next message' });
      break;
    case 'SessionEnd':
      events.push({ type: 'agent.idle', agent, note: 'Session closed' });
      break;
    default:
      return;
  }

  const base = (process.env.ACRES_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AGENT_ACRES_TOKEN) headers.Authorization = 'Bearer ' + process.env.AGENT_ACRES_TOKEN;
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 2500).unref();
  await fetch(base + '/api/events', { method: 'POST', headers, body: JSON.stringify(events), signal: ctl.signal });
}
