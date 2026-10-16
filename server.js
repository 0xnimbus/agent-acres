#!/usr/bin/env node
// Agent Acres server: Node core modules only, no install step.
//   node server.js            live mode (real agent events only)
//   node server.js --demo     also run the built-in simulator
// Agents report work by POSTing JSON to /api/events or by appending JSON lines
// to data/inbox.ndjson. Browsers get a snapshot plus live events over SSE.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./shared/reducer');
const demo = require('./lib/demo');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');
const DATA = path.join(ROOT, 'data');
const LOG_FILE = path.join(DATA, 'events.ndjson');
const INBOX_FILE = path.join(DATA, 'inbox.ndjson');
const ROSTER_FILE = fs.existsSync(path.join(ROOT, 'agents.json')) ? path.join(ROOT, 'agents.json') : path.join(ROOT, 'agents.example.json');

const args = process.argv.slice(2);
const PORT = Number(process.env.PORT || argValue('--port') || 8790);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.AGENT_ACRES_TOKEN || '';
let demoOn = args.includes('--demo') || process.env.DEMO === '1';

function argValue(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

fs.mkdirSync(DATA, { recursive: true });

// ---- event store -----------------------------------------------------------
// Real events persist to disk; demo events live in memory only, so turning the
// demo off leaves exactly what real agents reported.
let realEvents = [];
let demoEvents = [];
const REAL_KEEP = 5000;
const DEMO_KEEP = 2000;

function rosterEvents() {
  try {
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
    return (roster.agents || []).map((a, i) => ({
      id: 'roster-' + a.id, ts: 0, type: 'agent.hello', agent: a.id,
      name: a.name, business: a.business, project: a.project, model: a.model, role: a.role, script: a.script,
      look: a.look, color: a.color,
    }));
  } catch (e) {
    console.warn('[acres] could not read roster ' + ROSTER_FILE + ': ' + e.message);
    return [];
  }
}

function loadLog() {
  if (!fs.existsSync(LOG_FILE)) return;
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const ev = JSON.parse(line); if (!R.validate(ev)) realEvents.push(ev); } catch { /* skip torn line */ }
  }
  realEvents = realEvents.slice(-REAL_KEEP);
}

// Ratings the commander gives finished work ("rate it"), kept apart from events.
const RATINGS_FILE = path.join(DATA, 'ratings.json');
let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8')); } catch { /* none yet */ }

// Which character looks workers may use. Denied keys come from the sprite approval page.
const POOL_FILE = path.join(DATA, 'pool.json');
let pool = { denied: ['bug', 'turret-a', 'turret-b', 'turret-c', 'turret-d', 'soldier-red', 'soldier-green', 'soldier-grey', 'heavy-red', 'heavy-green', 'heavy-grey'] }; // Derrick: no color swaps, one color per design
try { pool = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch { /* keep the default */ }

function buildState() {
  const s = R.emptyState();
  const evs = rosterEvents().concat(demoOn ? mergeByTs(realEvents, demoEvents) : realEvents);
  for (const ev of evs) R.apply(s, ev);
  s.demo = demoOn;
  if (demoOn) s.commanderLevel = demo.DEMO_COMMANDER_LEVEL;
  s.ratings = ratings;
  s.pool = pool;
  s.serverTime = Date.now();
  return s;
}

function mergeByTs(a, b) { return a.concat(b).sort((x, y) => x.ts - y.ts); }

function ingest(raw, source) {
  const ev = Object.assign({}, raw);
  ev.ts = typeof ev.ts === 'number' ? ev.ts : Date.now();
  ev.id = ev.id || crypto.randomUUID();
  const err = R.validate(ev);
  if (err) return { ok: false, error: err };
  if (source === 'demo') {
    ev.demo = true;
    demoEvents.push(ev);
    if (demoEvents.length > DEMO_KEEP) demoEvents = demoEvents.slice(-DEMO_KEEP);
  } else {
    delete ev.demo;
    realEvents.push(ev);
    if (realEvents.length > REAL_KEEP) realEvents = realEvents.slice(-REAL_KEEP);
    fs.appendFile(LOG_FILE, JSON.stringify(ev) + '\n', () => {});
  }
  if (source !== 'demo' || demoOn) broadcast('event', ev);
  return { ok: true, id: ev.id };
}

// ---- inbox file tail -------------------------------------------------------
// Agents that cannot make HTTP calls append one JSON event per line here.
let inboxPos = 0;
let inboxBuf = '';
function initInbox() {
  if (!fs.existsSync(INBOX_FILE)) fs.writeFileSync(INBOX_FILE, '');
  inboxPos = fs.statSync(INBOX_FILE).size; // only new lines count
  fs.watchFile(INBOX_FILE, { interval: 500 }, (cur) => {
    if (cur.size < inboxPos) inboxPos = 0; // file was truncated
    if (cur.size === inboxPos) return;
    const stream = fs.createReadStream(INBOX_FILE, { start: inboxPos, end: cur.size - 1, encoding: 'utf8' });
    inboxPos = cur.size;
    stream.on('data', (chunk) => { inboxBuf += chunk; });
    stream.on('end', () => {
      const lines = inboxBuf.split('\n');
      inboxBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const r = ingest(JSON.parse(line), 'inbox');
          if (!r.ok) console.warn('[acres] inbox line rejected: ' + r.error);
        } catch (e) { console.warn('[acres] inbox line is not JSON: ' + line.slice(0, 80)); }
      }
    });
  });
}

// ---- SSE -------------------------------------------------------------------
const clients = new Set();
function broadcast(name, data) {
  const msg = 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000).unref();

// ---- demo ------------------------------------------------------------------
const sim = demo.createSimulator((ev) => ingest(ev, 'demo'));
function startDemo() {
  demoEvents = demo.seedToday(buildState(), Date.now()).map((ev, i) => Object.assign(ev, { id: 'day-' + i, demo: true }));
  sim.start(buildState());
}
function setDemo(on) {
  demoOn = !!on;
  if (demoOn) startDemo(); else { sim.stop(); demoEvents = []; }
  broadcast('snapshot', buildState());
}

// ---- assets ----------------------------------------------------------------
// The art pack is never committed. If assets/manifest.json exists, the page uses
// it; otherwise it falls back to the procedural placeholder art.
function manifest() {
  const file = path.join(ASSETS, 'manifest.json');
  if (!fs.existsSync(file)) return { placeholder: true };
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const missing = Object.values(m.sheets || {}).filter((f) => !fs.existsSync(path.join(ASSETS, f)));
    if (missing.length) {
      console.warn('[acres] manifest lists missing sheets, using placeholders: ' + missing.join(', '));
      return { placeholder: true, warning: 'missing sheets: ' + missing.join(', ') };
    }
    return m;
  } catch (e) {
    return { placeholder: true, warning: 'assets/manifest.json is not valid JSON: ' + e.message };
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function send(res, code, body, type) {
  const isObj = typeof body === 'object';
  res.writeHead(code, { 'Content-Type': type || (isObj ? 'application/json' : 'text/plain; charset=utf-8'), 'Access-Control-Allow-Origin': '*' });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => cb(body));
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === 'Bearer ' + TOKEN || req.headers['x-acres-token'] === TOKEN;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Acres-Token' });
    return res.end();
  }

  if (p === '/api/events' && req.method === 'POST') {
    if (!authorized(req)) return send(res, 401, { ok: false, error: 'missing or wrong token' });
    return readBody(req, (body) => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'body is not JSON' }); }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const results = list.map((ev) => ingest(ev, 'http'));
      const bad = results.filter((r) => !r.ok);
      send(res, bad.length ? 400 : 200, Array.isArray(parsed) ? { ok: !bad.length, results } : results[0]);
    });
  }

  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n');
    res.write('event: snapshot\ndata: ' + JSON.stringify(buildState()) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/rate' && req.method === 'POST') {
    return readBody(req, (body) => {
      let j;
      try { j = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'body is not JSON' }); }
      const stars = Number(j.stars);
      if (typeof j.id !== 'string' || !(stars >= 0 && stars <= 5)) return send(res, 400, { ok: false, error: 'need { id, stars: 0-5 }' });
      if (stars === 0) delete ratings[j.id]; else ratings[j.id] = Math.round(stars);
      fs.writeFile(RATINGS_FILE, JSON.stringify(ratings), () => {});
      broadcast('rating', { id: j.id, stars: ratings[j.id] || 0 });
      send(res, 200, { ok: true });
    });
  }
  if (p === '/api/pool' && req.method === 'POST') {
    return readBody(req, (body) => {
      let j;
      try { j = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'body is not JSON' }); }
      if (typeof j.key !== 'string' || typeof j.denied !== 'boolean') return send(res, 400, { ok: false, error: 'need { key, denied: true|false }' });
      const set = new Set(pool.denied);
      if (j.denied) set.add(j.key); else set.delete(j.key);
      pool = { denied: [...set] };
      fs.writeFile(POOL_FILE, JSON.stringify(pool, null, 2), () => {});
      broadcast('pool', pool);
      send(res, 200, { ok: true, pool });
    });
  }
  if (p === '/api/state') return send(res, 200, buildState());
  if (p === '/api/manifest') return send(res, 200, manifest());
  if (p === '/api/demo' && req.method === 'POST') {
    return readBody(req, (body) => {
      let on = !demoOn;
      try { const j = JSON.parse(body || '{}'); if (typeof j.on === 'boolean') on = j.on; } catch { /* toggle */ }
      setDemo(on);
      send(res, 200, { ok: true, demo: demoOn });
    });
  }

  if (p.startsWith('/assets/')) return serveFile(res, ASSETS, decodeURIComponent(p.slice('/assets/'.length)));
  if (p === '/shared/reducer.js') return serveFile(res, path.join(ROOT, 'shared'), 'reducer.js');
  if (p === '/lib/demo.js' || p === '/lib/tasks.js') return serveFile(res, path.join(ROOT, 'lib'), p.slice(5));
  return serveFile(res, PUBLIC, p === '/' ? 'index.html' : decodeURIComponent(p.slice(1)));
});

loadLog();
initInbox();
server.listen(PORT, HOST, () => {
  console.log('[acres] Agent Acres on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + (demoOn ? '  (demo mode on)' : ''));
  console.log('[acres] POST events to /api/events or append JSON lines to ' + path.relative(process.cwd(), INBOX_FILE));
  console.log('[acres] art: ' + (manifest().placeholder ? 'placeholder (run "npm run art -- <path to pack>" to use your pack)' : 'assets/manifest.json'));
  if (demoOn) startDemo();
});
