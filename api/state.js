// GET /api/state: full snapshot (roster + stored events, ratings, sprite pool).
'use strict';
const H = require('../lib/hosted');
module.exports = H.handle(async (req, res) => H.send(res, 200, await H.snapshot()));
