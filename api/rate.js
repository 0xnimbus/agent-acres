// POST /api/rate { id, stars: 0-5 }: the "rate it" button on finished work.
'use strict';
const H = require('../lib/hosted');
module.exports = H.handle(async (req, res) => {
  if (req.method !== 'POST') return H.send(res, 405, { ok: false });
  const j = await H.body(req);
  const stars = Number(j.stars);
  if (typeof j.id !== 'string' || !(stars >= 0 && stars <= 5)) return H.send(res, 400, { ok: false, error: 'need { id, stars: 0-5 }' });
  await H.rate(j.id, stars);
  H.send(res, 200, { ok: true });
});
