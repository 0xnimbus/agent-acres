// Hosted (Vercel) version of the server's state: events, ratings and the sprite
// pool live in Redis instead of memory and files. Used by the functions in api/.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('../shared/reducer');
const redis = require('./redis');

const KEEP = 5000;
const K = { seq: 'acres:seq', events: 'acres:events', ratings: 'acres:ratings', pool: 'acres:pool' };
const DEFAULT_POOL = { denied: ['robot', 'bug', 'turret-a', 'turret-b'] };

function roster() {
  for (const f of ['agents.json', 'agents.example.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
      return (j.agents || []).map((a) => ({
        id: 'roster-' + a.id, ts: 0, type: 'agent.hello', agent: a.id, name: a.name, business: a.business,
        project: a.project, model: a.model, role: a.role, look: a.look, color: a.color,
      }));
    } catch { /* try the next file */ }
  }
  return [];
}

async function readAll() {
  const [events, ratings, pool, seq] = await redis.pipeline([
    ['LRANGE', K.events, '0', '-1'], ['HGETALL', K.ratings], ['GET', K.pool], ['GET', K.seq],
  ]);
  const ratingObj = {};
  for (let i = 0; i < (ratings || []).length; i += 2) ratingObj[ratings[i]] = Number(ratings[i + 1]);
  return {
    events: (events || []).map((e) => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean),
    ratings: ratingObj,
    pool: pool ? JSON.parse(pool) : DEFAULT_POOL,
    seq: Number(seq || 0),
  };
}

async function snapshot() {
  const all = await readAll();
  const s = R.emptyState();
  for (const ev of roster().concat(all.events)) R.apply(s, ev);
  s.demo = false;
  s.ratings = all.ratings;
  s.pool = all.pool;
  s.serverTime = Date.now();
  s.cursor = all.seq;
  s.transport = 'poll';
  return s;
}

async function since(cursor) {
  const raw = await redis.cmd('LRANGE', K.events, '-300', '-1');
  const events = (raw || []).map((e) => JSON.parse(e)).filter((e) => e.seq > cursor);
  const seq = Number((await redis.cmd('GET', K.seq)) || 0);
  return { events, cursor: seq, serverTime: Date.now() };
}

async function ingest(list) {
  const results = [];
  const good = [];
  for (const raw of list) {
    const ev = Object.assign({}, raw);
    delete ev.demo;
    ev.ts = typeof ev.ts === 'number' ? ev.ts : Date.now();
    ev.id = ev.id || crypto.randomUUID();
    const err = R.validate(ev);
    if (err) { results.push({ ok: false, error: err }); continue; }
    good.push(ev);
    results.push({ ok: true, id: ev.id });
  }
  if (good.length) {
    const end = Number(await redis.cmd('INCRBY', K.seq, String(good.length)));
    good.forEach((ev, i) => { ev.seq = end - good.length + 1 + i; });
    await redis.pipeline([['RPUSH', K.events, ...good.map((e) => JSON.stringify(e))], ['LTRIM', K.events, String(-KEEP), '-1']]);
  }
  return results;
}

async function rate(id, stars) {
  if (stars === 0) await redis.cmd('HDEL', K.ratings, id);
  else await redis.cmd('HSET', K.ratings, id, String(Math.round(stars)));
}

async function setPool(key, denied) {
  const cur = JSON.parse((await redis.cmd('GET', K.pool)) || JSON.stringify(DEFAULT_POOL));
  const set = new Set(cur.denied);
  if (denied) set.add(key); else set.delete(key);
  const pool = { denied: [...set] };
  await redis.cmd('SET', K.pool, JSON.stringify(pool));
  return pool;
}

// Requests to the API need either the browser's sign-in (checked by middleware)
// or, for agents and hooks, the AGENT_ACRES_TOKEN as a bearer token.
function tokenOk(req) {
  const t = process.env.AGENT_ACRES_TOKEN || '';
  const h = req.headers.authorization || '';
  return !!t && (h === 'Bearer ' + t || req.headers['x-acres-token'] === t);
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let s = '';
  for await (const c of req) s += c;
  return JSON.parse(s || '{}');
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) { send(res, 500, { ok: false, error: e.message }); }
  };
}

module.exports = { snapshot, since, ingest, rate, setPool, tokenOk, body, send, handle };
