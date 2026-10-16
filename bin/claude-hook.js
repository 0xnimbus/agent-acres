#!/usr/bin/env node
// Claude Code hook: reports what Claude sessions are doing to Agent Acres. Each
// project folder is a room, and every Claude thread (session) is its own worker there.
//
// Wire it up in a settings.json "hooks" block for these events:
//   SessionStart, UserPromptSubmit, Notification, Stop, SessionEnd
// with the command:  node "<path to agent-acres>/bin/claude-hook.js"
//
// Env:
//   ACRES_URL           where the station is (default http://127.0.0.1:8790)
//   AGENT_ACRES_TOKEN   required for the hosted (Vercel) station
//   ACRES_PROJECT       room name (default: the project folder's name)
//
// It never blocks or fails a Claude session: errors are swallowed and it gives up after 3 seconds.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => { main().catch(() => {}).finally(() => { process.exitCode = 0; }); });
setTimeout(() => process.exit(0), 3000).unref();

// Folder name -> room. Your job search folders all feed the Job Applications room.
const PRETTY = { 'jobhunt.ai': 'Job Applications', jobhuntai: 'Job Applications', 'jobhunt': 'Job Applications', habitquest: 'Habix RPG', habixrpg: 'Habix RPG', 'habix-rpg': 'Habix RPG' };
// Folders that never get a room (work on the station itself).
const SKIP = new Set(['agent-acres']);
const STATE_FILE = path.join(os.homedir(), '.agent-acres', 'sessions.json');
const FILLER = /^(hey|hi|ok(ay)?|so|please|can you|could you|would you|i want( you)? to|i would like( you)? to|let'?s|now|also|and)\s+/i;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// Prompts from Claude project threads arrive wrapped in an envelope (<wake>, relays,
// system reminders). Keep only what the person actually wrote.
function humanText(prompt) {
  let t = String(prompt || '');
  const trig = t.match(/<message[^>]*trigger="true"[^>]*>([\s\S]*?)<\/message>/);
  if (trig) t = trig[1];
  else {
    const cited = [...t.matchAll(/<cited[^>]*author="user"[^>]*>([\s\S]*?)<\/cited>/g)].pop();
    const note = t.match(/<note>([\s\S]*?)<\/note>/);
    if (cited) t = cited[1];
    else if (note) t = note[1];
  }
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/<[^>]+>/g, ' ');
  // drop relay boilerplate lines
  t = t.split(/\r?\n/).filter((l) => !/^\s*(The (note|messages) below|A message from this project|\[SYSTEM NOTIFICATION)/i.test(l)).join(' ');
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const BOT_NAMES = ['Nova', 'Bolt', 'Echo', 'Rivet', 'Sable', 'Juno', 'Cipher', 'Orbit', 'Flux', 'Atlas', 'Vega', 'Pico',
  'Quill', 'Spark', 'Zephyr', 'Onyx', 'Dash', 'Halo', 'Ion', 'Kilo', 'Lumen', 'Mira', 'Nyx', 'Opal', 'Pulse', 'Rook', 'Sol', 'Tango'];
function botName(sid) { let h = 0; for (const c of String(sid)) h = (h * 31 + c.charCodeAt(0)) | 0; return BOT_NAMES[Math.abs(h) % BOT_NAMES.length]; }

function threadName(prompt) {
  let t = clip(prompt, 200);
  for (let i = 0; i < 4; i++) t = t.replace(FILLER, '');
  const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'my', 'this', 'that', 'it', 'me', 'for', 'in', 'on', 'with', 'is', 'are', 'and', 'so', 'some', 'more']);
  const words = t.replace(/[^\w\s-]/g, '').split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase())).slice(0, 2);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name.slice(0, 14) || 'Thread';
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sessions: {} }; }
}
function saveState(st) {
  const cutoff = Date.now() - 14 * 86400000;
  for (const [k, v] of Object.entries(st.sessions)) if (v.last < cutoff) delete st.sessions[k];
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(st));
}

async function main() {
  let h = {};
  try { h = JSON.parse(input || '{}'); } catch { return; }
  const folder = path.basename(h.cwd || process.cwd());
  if (!process.env.ACRES_PROJECT && SKIP.has(folder.toLowerCase())) return;
  const project = process.env.ACRES_PROJECT || PRETTY[folder.toLowerCase()] || folder;
  const sid = String(h.session_id || 'none');

  const st = loadState();
  const sess = st.sessions[sid] || (st.sessions[sid] = { prompts: 0, name: '', project, last: Date.now() });
  sess.last = Date.now();
  if (h.hook_event_name === 'UserPromptSubmit') {
    sess.prompts++;
    if (!sess.name) sess.name = threadName(humanText(h.prompt));
  }
  saveState(st);

  // Every Claude thread (session) is its own worker in its project's room.
  const agent = slug('thread-' + sid.slice(0, 8)) || 'thread';
  const hello = { type: 'agent.hello', agent, name: botName(sid), project, business: sess.name ? 'Thread: ' + sess.name : 'Claude thread on ' + project, script: 'claude' };

  const events = [];
  switch (h.hook_event_name) {
    case 'SessionStart':
      events.push(hello);
      break;
    case 'UserPromptSubmit':
      events.push(hello, { type: 'task.start', agent, task: sid, title: clip(humanText(h.prompt), 120) || 'New request' });
      break;
    case 'Notification':
      events.push({ type: 'task.progress', agent, task: sid, note: clip(h.message, 120) || 'Waiting for you' });
      break;
    case 'Stop':
      events.push({ type: 'task.done', agent, task: sid, result: 'Finished, waiting for your next message' });
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
