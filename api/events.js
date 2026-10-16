// GET  /api/events?after=<cursor>  new events since the cursor (browsers poll this)
// POST /api/events                 one event or an array; needs Authorization: Bearer <AGENT_ACRES_TOKEN>
'use strict';
const H = require('../lib/hosted');
module.exports = H.handle(async (req, res) => {
  if (req.method === 'GET') {
    const after = Number(new URL(req.url, 'http://x').searchParams.get('after') || 0);
    return H.send(res, 200, await H.since(after));
  }
  if (req.method !== 'POST') return H.send(res, 405, { ok: false, error: 'GET or POST' });
  if (!H.tokenOk(req)) return H.send(res, 401, { ok: false, error: 'missing or wrong token' });
  let parsed;
  try { parsed = await H.body(req); } catch { return H.send(res, 400, { ok: false, error: 'body is not JSON' }); }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const results = await H.ingest(list);
  const bad = results.filter((r) => !r.ok);
  H.send(res, bad.length ? 400 : 200, Array.isArray(parsed) ? { ok: !bad.length, results } : results[0]);
});
