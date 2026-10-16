// POST /api/pool { key, denied }: approve or deny a character sprite.
'use strict';
const H = require('../lib/hosted');
module.exports = H.handle(async (req, res) => {
  if (req.method !== 'POST') return H.send(res, 405, { ok: false });
  const j = await H.body(req);
  if (typeof j.key !== 'string' || typeof j.denied !== 'boolean') return H.send(res, 400, { ok: false, error: 'need { key, denied: true|false }' });
  H.send(res, 200, { ok: true, pool: await H.setPool(j.key, j.denied) });
});
