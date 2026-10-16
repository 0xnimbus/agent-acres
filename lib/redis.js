// Tiny Upstash Redis REST client (fetch only, no dependencies) used by the
// Vercel functions in api/. Reads the env vars the Vercel Upstash integration
// sets: KV_REST_API_URL / KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / _TOKEN.
'use strict';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

function configured() { return !!(URL_ && TOKEN); }

async function pipeline(commands) {
  if (!configured()) throw new Error('Redis is not configured: add the Upstash integration in Vercel (Storage tab)');
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('Redis error ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const out = await r.json();
  return out.map((x) => { if (x.error) throw new Error('Redis: ' + x.error); return x.result; });
}

async function cmd(...args) { return (await pipeline([args]))[0]; }

module.exports = { configured, pipeline, cmd };
