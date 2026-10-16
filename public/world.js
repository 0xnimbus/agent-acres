// The station: rooms floating in space, linked by hallways. HQ (the boss) sits
// in the middle; every project gets its own room around it. Inside a room each
// agent has a pod (name tag, run timer, desk); characters walk between the desk
// and an idle spot as their status changes.
'use strict';

const World = (() => {
  const T = 32;          // tile size in world pixels
  const POD_W = 4, POD_H = 3;
  const GAP_X = 5, GAP_Y = 5, MARGIN = 4;
  const WALK_SPEED = 70; // world px per second
  const HQ = 'HQ';
  // Room slots in a 3-wide grid, filled around the middle (1,1) which is HQ.
  const RING = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [1, 2], [0, 2], [2, 2]];

  let art = null;
  let canvas, ctx;
  let layout = null;
  const ents = new Map(); // agent id -> entity
  const effects = [];
  const tinted = new Map();
  let hoverId = null;
  let selectedId = null;
  let onSelect = () => {};
  let getState = () => null;
  let now = () => Date.now();

  function init(opts) {
    art = opts.art;
    canvas = opts.canvas;
    ctx = canvas.getContext('2d');
    onSelect = opts.onSelect || onSelect;
    getState = opts.getState;
    now = opts.now || now;
    // wheel to zoom around the cursor, drag to pan, double-click to fit the whole station
    let drag = null;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      director.auto = false;
      const r = canvas.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => { director.auto = false; drag = { x: e.clientX, y: e.clientY, px: cam.px, py: cam.py, moved: false }; });
    window.addEventListener('mouseup', () => { setTimeout(() => { drag = null; }, 0); });
    canvas.addEventListener('mousemove', (e) => {
      if (drag && (e.buttons & 1)) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        cam.px = drag.px + dx; cam.py = drag.py + dy;
        canvas.style.cursor = 'grabbing';
        return;
      }
      hoverId = hit(e); canvas.style.cursor = hoverId ? 'pointer' : 'grab';
    });
    canvas.addEventListener('mouseleave', () => { hoverId = null; });
    canvas.addEventListener('click', (e) => { if (drag && drag.moved) return; const id = hit(e); onSelect(id); });
    canvas.addEventListener('dblclick', () => { director.auto = false; cam.z = 1; cam.px = 0; cam.py = 0; });
    requestAnimationFrame(frame);
  }

  function setSelected(id) { selectedId = id; }

  const isBoss = (a) => a.role === 'boss';
  const projectOf = (a) => (isBoss(a) ? HQ : a.project || a.business || 'Other');
  const layoutKey = (state) => state.order.map((id) => id + ':' + projectOf(state.agents[id])).join('|');

  // ---- layout ---------------------------------------------------------------
  function buildLayout(state) {
    const groups = new Map();
    const bosses = [];
    for (const id of state.order) {
      const a = state.agents[id];
      if (isBoss(a)) { bosses.push(id); continue; }
      const p = projectOf(a);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(id);
    }
    const maxN = Math.max(1, ...[...groups.values()].map((g) => g.length));
    const podCols = 2;                                     // rooms always have desks in pairs; spares stay empty
    const podRows = Math.ceil(maxN / podCols);
    const RW = podCols * POD_W + 3;                        // room interior, tiles
    const RH = podRows * POD_H + 2;

    const projects = [...groups.keys()];
    const slots = RING.slice();
    for (let r = 3; slots.length < projects.length; r++) for (let c = 0; c < 3; c++) slots.push([c, r]);
    const gridRows = Math.max(3, ...slots.slice(0, projects.length).map((s) => s[1] + 1));

    const wT = MARGIN * 2 + 3 * RW + 2 * GAP_X;
    const hT = MARGIN * 2 + 2 + gridRows * RH + (gridRows - 1) * GAP_Y + 1;
    const floor = Array.from({ length: hT }, () => new Uint8Array(wT));
    const tiles = Array.from({ length: hT }, () => new Array(wT).fill('floor'));
    // kind: 1 room, 2 hallway, 3 alcove
    const fill = (x0, y0, w, h, kind) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (floor[y] && x >= 0 && x < wT && !floor[y][x]) floor[y][x] = kind || 1; };
    const cut = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (floor[y] && x >= 0 && x < wT) floor[y][x] = 0; };
    const roomAt = (c, r) => ({ x: MARGIN + c * (RW + GAP_X), y: MARGIN + 2 + r * (RH + GAP_Y), w: RW, h: RH, c, r });

    const rooms = [];
    const pods = {};
    const hq = Object.assign(roomAt(1, 1), { name: 'HQ', boss: true, agents: bosses });
    rooms.push(hq);
    bosses.forEach((id, i) => {
      const cx = (hq.x + RW / 2) * T + (i - (bosses.length - 1) / 2) * 80;
      const feet = (hq.y + 1) * T + 82;
      pods[id] = { boss: true, room: hq, work: { x: cx, y: feet }, idle: { x: cx, y: feet }, tag: { x: cx, y: (hq.y + 0.3) * T }, gapY: feet };
    });

    const byCell = new Map([['1,1', hq]]);
    projects.forEach((name, pi) => {
      const [c, r] = slots[pi];
      const room = Object.assign(roomAt(c, r), { name, boss: false, agents: groups.get(name) });
      rooms.push(room);
      byCell.set(c + ',' + r, room);
      const ids = groups.get(name);
      room.spares = [];
      for (let k = ids.length; k < podCols * podRows; k++) {
        const px0 = room.x + (RW - podCols * POD_W) / 2 + (k % podCols) * POD_W;
        const py0 = room.y + 0.6 + Math.floor(k / podCols) * POD_H;
        room.spares.push({ x: Math.round((px0 + 0.6) * T), y: Math.round((py0 + 0.9) * T) });
      }
      ids.forEach((id, k) => {
        const row = Math.floor(k / podCols), col = k % podCols;
        const px0 = room.x + (RW - podCols * POD_W) / 2 + col * POD_W;
        const py0 = room.y + 0.6 + row * POD_H;
        const desk = { x: Math.round((px0 + 0.6) * T), y: Math.round((py0 + 0.9) * T) };
        pods[id] = {
          room, px0, py0, desk,
          work: { x: desk.x + T + 10, y: desk.y + 30 },
          idle: { x: Math.round(px0 * T + 12), y: desk.y + T + 26 },
          tag: { x: desk.x + 16, y: desk.y - 6 },
          gapY: desk.y + T + 22,
        };
      });
    });

    // floors: rooms plus 2-wide hallways linking every room back to HQ
    for (const rm of rooms) { rm.sides = new Set(); rm.decor = []; fill(rm.x, rm.y, rm.w, rm.h, 1); }
    const halls = [];
    const linkH = (a, b) => { const y = a.y + Math.floor(a.h / 2) - 1; a.sides.add('right'); b.sides.add('left'); fill(a.x + a.w, y, b.x - a.x - a.w, 2, 2); halls.push({ x: a.x + a.w, y, w: b.x - a.x - a.w, h: 2 }); };
    const linkV = (a, b) => { const x = a.x + Math.floor(a.w / 2) - 1; a.sides.add('bottom'); b.sides.add('top'); fill(x, a.y + a.h, 2, b.y - a.y - a.h, 2); halls.push({ x, y: a.y + a.h, w: 2, h: b.y - a.y - a.h }); };
    for (const rm of rooms) {
      if (rm.boss) continue;
      const { c, r } = rm;
      if (r === 1) { if (c === 0) linkH(rm, hq); else linkH(hq, rm); continue; }
      if (c === 1) { if (r < 1) linkV(rm, hq); else if (r === 2) linkV(hq, rm); else { const up = byCell.get('1,' + (r - 1)); if (up) linkV(up, rm); } continue; }
      // corner rooms connect sideways to the middle column room of their row (or HQ's column via it)
      const mid = byCell.get('1,' + r);
      if (mid) { if (c === 0) linkH(rm, mid); else linkH(mid, rm); }
      else { const side = byCell.get(c + ',1'); if (side) { if (r < 1) linkV(rm, side); else linkV(side, rm); } }
    }

    // ---- shape and texture: every room gets its own cut corners, an alcove on
    // an outer wall, pillars and floor panels, seeded by its name so it is stable.
    const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
    for (const rm of rooms) {
      let rs = hash(rm.name) || 1;
      const rr = () => { rs = Math.imul(rs ^ (rs >>> 15), 2246822507) >>> 0; rs = (rs ^ (rs >>> 13)) >>> 0; return rs / 4294967296; };
      const { x, y, w, h } = rm;
      const decor = (role, tx, ty) => rm.decor.push({ role, x: Math.round(tx * T), y: Math.round(ty * T) });
      if (rm.boss) {
        cut(x, y, 2, 1); cut(x + w - 2, y, 2, 1); cut(x, y + h - 1, 2, 1); cut(x + w - 2, y + h - 1, 2, 1);
      } else {
        if (rr() < 0.6) cut(x, y, 1, 1);
        if (rr() < 0.6) cut(x + w - 1, y, 1, 1);
        if (rr() < 0.5) cut(x, y + h - 1, 1, 1); else decor('pillar', x, y + h - 1);
        if (rr() < 0.5) cut(x + w - 1, y + h - 1, 1, 1); else decor('pillar', x + w - 1, y + h - 1);
      }
      // an alcove on an outer side that has no hallway
      const below = rooms.some((o) => o !== rm && o.c === rm.c && o.r === rm.r + 1);
      const sides = [];
      if (rm.c === 0 && !rm.sides.has('left')) sides.push('left');
      if (rm.c === 2 && !rm.sides.has('right')) sides.push('right');
      if (!below && !rm.sides.has('bottom')) sides.push('bottom');
      if (!rm.boss && sides.length) {
        const side = sides[Math.floor(rr() * sides.length)];
        if (side === 'left' || side === 'right') {
          const ay = y + 1;
          const ax = side === 'left' ? x - 2 : x + w;
          fill(ax, ay, 2, Math.min(3, h - 1), 3);
          decor('tank', ax + 0.5, ay - 0.7);
          if (h - 1 >= 3) decor('console', ax + 0.5, ay + 1.8);
        } else {
          const ax = x + 2 + Math.floor(rr() * (w - 7));
          fill(ax, y + h, 4, 2, 3);
          decor('crate', ax, y + h + 0.8); decor('crateOpen', ax + 1, y + h + 0.8); decor('capsule', ax + 3, y + h + 0.8);
        }
      }
      // floor texture: desk platforms, a walkway stripe per pod row, vents and grates
      rm.walk = [];
      const platforms = rm.agents.map((id) => pods[id]).filter((p) => p && !p.boss).map((p) => p.desk).concat(rm.spares || []);
      for (const d of platforms) {
        const tx = Math.floor(d.x / T), ty = Math.floor(d.y / T);
        for (let yy = ty; yy < ty + 2; yy++) for (let xx = tx; xx < tx + 3; xx++) if (floor[yy] && floor[yy][xx] === 1) tiles[yy][xx] = 'floorAccent';
      }
      if (!rm.boss) {
        for (let row = 0; row < podRows; row++) {
          const wy = y + 3 + row * POD_H;
          for (let xx = x + 1; xx < x + w - 1; xx++) if (floor[wy] && floor[wy][xx] === 1) rm.walk.push({ x: xx, y: wy });
        }
      } else {
        for (let yy = y + 1; yy < y + h - 1; yy++) for (let xx = x + 2; xx < x + w - 2; xx++) tiles[yy][xx] = (xx + yy) % 2 ? 'floorAccent' : 'floor';
        for (let xx = x + 2; xx < x + w - 2; xx++) rm.walk.push({ x: xx, y: y + h - 1 });
      }
      for (let i = 0; i < 3; i++) {
        const vx = x + 1 + Math.floor(rr() * (w - 2)), vy = y + h - 1;
        if (floor[vy] && floor[vy][vx] === 1 && tiles[vy][vx] === 'floor') tiles[vy][vx] = rr() < 0.5 ? 'floorVent' : 'floorGrate';
      }
      rm.lights = [{ x: (x + 0.5) * T, c: rm.boss ? 'gold' : 'blue' }, { x: (x + w - 1.5) * T, c: rm.boss ? 'gold' : 'green' }];
    }
    for (let yy = 0; yy < hT; yy++) for (let xx = 0; xx < wT; xx++) {
      if (floor[yy][xx] === 3) tiles[yy][xx] = 'floorPanel';
      else if (floor[yy][xx] === 2) tiles[yy][xx] = (xx + yy) % 3 === 0 ? 'floorGrate' : 'floorAccent';
    }

    const stars = [];
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (wT * hT) / 3; i++) stars.push({ x: rnd() * wT * T, y: rnd() * hT * T, s: rnd() < 0.12 ? 2 : 1, tw: rnd() * 6.28, b: 0.35 + rnd() * 0.65 });

    return { key: layoutKey(state), RW, RH, wT, hT, w: wT * T, h: hT * T, rooms, halls, pods, floor, tiles, stars };
  }

  function targetFor(a) {
    const pod = layout.pods[a.id];
    if (a.status === 'idle') return Object.assign({ kind: 'idle' }, pod.idle);
    return Object.assign({ kind: 'desk' }, pod.work);
  }

  function sync(state) {
    assignLooks(state);
    if (!layout || layout.key !== layoutKey(state)) {
      layout = buildLayout(state);
      ents.clear(); // rooms moved: respawn everyone at their spot
    }
    for (const id of state.order) {
      const a = state.agents[id];
      const tgt = targetFor(a);
      let e = ents.get(id);
      if (!e) {
        e = { id, x: tgt.x, y: tgt.y, path: [], facing: tgt.kind === 'desk' ? -1 : 1, at: tgt.kind, t: Math.random() * 10, bubble: null };
        ents.set(id, e);
      }
      const last = e.path.length ? e.path[e.path.length - 1] : { x: e.x, y: e.y };
      if (Math.abs(last.x - tgt.x) > 1 || Math.abs(last.y - tgt.y) > 1) {
        const gy = layout.pods[id].gapY;
        e.path = [{ x: e.x, y: gy }, { x: tgt.x, y: gy }, { x: tgt.x, y: tgt.y }];
        e.at = null;
        e.goal = tgt.kind;
      }
    }
  }

  // ---- events -> effects ------------------------------------------------------
  function onEvent(ev) {
    const e = ents.get(ev.agent);
    if (!e) return;
    if (ev.type === 'task.progress' && ev.note) e.bubble = { text: ev.note, until: performance.now() + 4500 };
    if (ev.type === 'task.start') e.bubble = { text: ev.title, until: performance.now() + 4000 };
    const p = layout && layout.pods[ev.agent];
    const big = p && p.boss;
    const headY = e.y - (big ? 60 : 30);
    if (ev.type === 'task.start') {
      rings.push({ x: e.x, y: e.y - 2, t0: performance.now(), dur: 700, color: '122,162,255' });
      burst(e.x, headY + 10, 8, ['#9cc7ff', '#ffffff'], 60);
      focus(ev.agent, 4200);
    }
    if (ev.type === 'task.done') {
      const money = moneyOf(ev.value);
      addEffect(e, money ? '+$' + money.toLocaleString() : 'DONE!', money ? '#ffd65a' : '#7ee08a', true);
      rings.push({ x: e.x, y: e.y - 2, t0: performance.now(), dur: 900, color: money ? '255,214,90' : '126,224,138' });
      burst(e.x, headY, money ? 26 : 14, money ? ['#ffd65a', '#fff3b0', '#f5a623'] : ['#7ee08a', '#c8ffd0'], money ? 120 : 90, money ? 'coin' : 'spark');
      if (money) shake(2.2, 260);
      focus(ev.agent, 5200, true);
    }
    if (ev.type === 'task.fail') {
      addEffect(e, 'FAILED', '#ff6b6b', true);
      rings.push({ x: e.x, y: e.y - 2, t0: performance.now(), dur: 800, color: '255,107,107' });
      burst(e.x, headY, 12, ['#ff6b6b', '#ffb0b0'], 80);
      shake(3, 320);
      focus(ev.agent, 5000, true);
    }
  }

  // ---- juice: particles, rings, screen shake ---------------------------------
  const particles = [];
  const rings = [];
  const shakeState = { mag: 0, until: 0, dur: 1 };
  function moneyOf(v) {
    const m = String(v == null ? '' : v).replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m && /\$/.test(String(v)) ? Math.round(Number(m[1])) : 0;
  }
  function burst(x, y, n, colors, speed, kind) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const v = speed * (0.45 + Math.random() * 0.75);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.7 + Math.random() * 0.6,
        color: colors[i % colors.length], size: kind === 'coin' ? 3 : 2, kind: kind || 'spark' });
    }
  }
  function shake(mag, ms) { shakeState.mag = mag; shakeState.dur = ms; shakeState.until = performance.now() + ms; }
  function stepJuice(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life += dt;
      if (q.life >= q.max) { particles.splice(i, 1); continue; }
      q.vy += 260 * dt; q.vx *= 0.985;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  }
  function drawJuice() {
    const t = performance.now();
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const k = (t - r.t0) / r.dur;
      if (k >= 1) { rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - k, 3);
      ctx.strokeStyle = 'rgba(' + r.color + ',' + (1 - k) * 0.9 + ')';
      ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, 6 + e * 26, (6 + e * 26) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const q of particles) {
      const a = 1 - q.life / q.max;
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.fillStyle = q.color;
      if (q.kind === 'coin') {
        const w = Math.max(1, Math.abs(Math.cos(q.life * 14)) * q.size); // spinning coin
        ctx.fillRect(Math.round(q.x - w / 2), Math.round(q.y), Math.ceil(w), q.size);
      } else ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- director camera: glides to whoever just did something, then pulls back ----
  // focusTiles / tourTiles: how many tiles fit across the screen in a close-up / room shot
  const director = { auto: false, tour: false, target: null, until: 0, lastSwitch: 0, queue: null, focusTiles: 16, tourTiles: 22, centerY: 0.5 };
  function focus(id, ms, important) {
    if (!director.auto) return;
    const t = performance.now();
    if (director.target && t - director.lastSwitch < 2500 && !important) { director.queue = { id, ms }; return; }
    director.target = id; director.until = t + ms; director.lastSwitch = t;
  }
  function stepDirector(dt) {
    if (!director.auto || !layout || !view.w) return;
    const t = performance.now();
    if (director.target && t > director.until) {
      director.target = null;
      if (director.queue) { const q = director.queue; director.queue = null; focus(q.id, q.ms); }
    }
    const fit = fitZoom();
    let tz = 1, cx = layout.w / 2, cy = layout.h / 2;
    const e = director.target && ents.get(director.target);
    const across = (tiles) => Math.max(1, view.w / (tiles * T) / fit);
    if (e) { tz = across(director.focusTiles); cx = e.x; cy = e.y - 20; }
    else if (director.tour && layout.rooms.length) {
      // between events, drift from room to room instead of sitting on the overview
      const rm = layout.rooms[Math.floor(t / 6500) % layout.rooms.length];
      tz = across(director.tourTiles); cx = (rm.x + rm.w / 2) * T; cy = (rm.y + rm.h / 2 - 0.5) * T;
    }
    const k = 1 - Math.pow(0.04, dt); // smooth ease toward the shot
    cam.z += (tz - cam.z) * k;
    const z = fit * cam.z;
    const tpx = view.w / 2 - cx * z - (view.w - layout.w * z) / 2;
    const tpy = view.h * director.centerY - cy * z - (view.h - layout.h * z) / 2;
    // keep the station on screen
    const maxX = Math.max(0, (layout.w * z - view.w) / 2), maxY = Math.max(0, (layout.h * z - view.h) / 2);
    cam.px += (Math.max(-maxX, Math.min(maxX, tpx)) - cam.px) * k;
    cam.py += (Math.max(-maxY, Math.min(maxY, tpy)) - cam.py) * k;
  }
  function setAuto(on, opts) {
    director.auto = !!on;
    if (!on) director.target = null;
    if (opts) Object.assign(director, opts);
  }
  function getAuto() { return director.auto; }

  function addEffect(e, text, color, big) {
    const p = layout && layout.pods[e.id];
    effects.push({ x: e.x, y: e.y - (p && p.boss ? 68 : 38), text, color, big, t0: performance.now(), dur: big ? 2400 : 2200 });
  }

  // ---- render ----------------------------------------------------------------
  let lastT = performance.now();
  let view = { zoom: 1, ox: 0, oy: 0 };
  const cam = { z: 1, px: 0, py: 0 }; // user zoom and pan on top of fit-to-screen

  function zoomAt(sx, sy, k) {
    const nz = Math.max(1, Math.min(6, cam.z * k));
    // keep the world point under the cursor in place
    const wx = (sx - view.ox) / view.zoom, wy = (sy - view.oy) / view.zoom;
    cam.z = nz;
    const fit = fitZoom();
    const z = fit * cam.z;
    const baseOx = Math.floor((view.w - layout.w * z) / 2), baseOy = Math.floor((view.h - layout.h * z) / 2);
    cam.px = sx - wx * z - baseOx;
    cam.py = sy - wy * z - baseOy;
  }
  function fitZoom() {
    let zoom = Math.min(view.w / layout.w, view.h / layout.h);
    return zoom >= 1 ? Math.floor(zoom * 4) / 4 : zoom;
  }

  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    const state = getState();
    if (state && art) {
      sync(state);
      step(dt);
      stepJuice(dt);
      stepDirector(dt);
      draw(t / 1000, state);
    }
    requestAnimationFrame(frame);
  }

  function step(dt) {
    for (const e of ents.values()) {
      e.t += dt;
      if (!e.path.length) continue;
      const p = e.path[0];
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      const move = WALK_SPEED * dt;
      if (Math.abs(dx) > 0.5) e.facing = dx < 0 ? -1 : 1;
      if (d <= move) { e.x = p.x; e.y = p.y; e.path.shift(); if (!e.path.length) { e.at = e.goal; e.facing = e.at === 'desk' ? -1 : 1; } }
      else { e.x += (dx / d) * move; e.y += (dy / d) * move; }
    }
  }

  function frameOf(spr, time, offset) {
    if (!spr.fps || spr.frames.length < 2) return spr.frames[0];
    return spr.frames[Math.floor((time + (offset || 0)) * spr.fps) % spr.frames.length];
  }

  function blit(spr, time, x, y, opts) {
    const f = frameOf(spr, time, opts && opts.offset);
    if (opts && opts.flip) {
      ctx.save();
      ctx.translate(x + f.w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(spr.img, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
      ctx.restore();
    } else {
      ctx.drawImage(spr.img, f.sx, f.sy, f.w, f.h, x, y, f.w, f.h);
    }
  }

  // Every worker gets its own sprite: explicit looks are kept, everyone else takes the
  // next look nobody uses yet. Only once all looks are taken do repeats start (tinted).
  // Only looks approved on the sprite page (/gallery.html) are in the pool.
  let lookMap = new Map(), lookKey = '', pool = [];
  function assignLooks(state) {
    const denied = (state.pool && state.pool.denied) || [];
    const workers = state.order.filter((id) => state.agents[id].role !== 'boss');
    const key = denied.join(',') + '#' + workers.map((id) => id + ':' + state.agents[id].look).join('|');
    if (key === lookKey) return;
    lookKey = key;
    pool = art.looks.filter((l) => !denied.includes(l.key));
    if (!pool.length) pool = art.looks.slice();
    tinted.clear();
    lookMap = new Map();
    const n = pool.length;
    const used = new Set();
    for (const id of workers) {
      const want = state.agents[id].look;
      // look can be a sprite key ("crawler") or a number into the approved pool
      const l = typeof want === 'string' ? pool.findIndex((x) => x.key === want) : want;
      if (Number.isInteger(l) && l >= 0 && l < n && !used.has(l)) { lookMap.set(id, l); used.add(l); }
    }
    let next = 0, extra = 0;
    for (const id of workers) {
      if (lookMap.has(id)) continue;
      while (next < n && used.has(next)) next++;
      // past the end: numbers above the last look wrap around, and lookFor tints them
      const l = next < n ? next++ : n + extra++;
      lookMap.set(id, l); used.add(l);
    }
  }
  function lookIndex(a) { return lookMap.has(a.id) ? lookMap.get(a.id) : (Number.isInteger(a.look) ? a.look : 0); }

  function lookFor(a) {
    const looks = pool.length ? pool : art.looks;
    const li = lookIndex(a);
    const base = looks[((li % looks.length) + looks.length) % looks.length];
    if (li < looks.length) return base;
    const key = li + ':' + (a.color || '');
    if (!tinted.has(key)) tinted.set(key, Sprites.tintLook(base, a.color || ['#ff8a65', '#ba68c8', '#4dd0e1', '#fff176'][li % 4]));
    return tinted.get(key);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width)), h = Math.max(200, Math.floor(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    let fit = Math.min(w / layout.w, h / layout.h);
    fit = fit >= 1 ? Math.floor(fit * 4) / 4 : fit;
    const zoom = fit * cam.z;
    if (cam.z === 1 && !director.auto) { cam.px = 0; cam.py = 0; }
    view = { zoom, ox: Math.floor((w - layout.w * zoom) / 2 + cam.px), oy: Math.floor((h - layout.h * zoom) / 2 + cam.py), dpr, w, h };
  }

  const isFloor = (x, y) => y >= 0 && y < layout.hT && x >= 0 && x < layout.wT && layout.floor[y][x] > 0;

  function draw(time, state) {
    resize();
    const { zoom, ox, oy, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, view.w, view.h);
    let sx = 0, sy = 0;
    const st = performance.now();
    if (st < shakeState.until) {
      const m = shakeState.mag * ((shakeState.until - st) / shakeState.dur);
      sx = (Math.random() - 0.5) * 2 * m; sy = (Math.random() - 0.5) * 2 * m;
    }
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (ox + sx) * dpr, (oy + sy) * dpr);
    ctx.imageSmoothingEnabled = false;
    const R = art.roles;

    // space
    for (const s of layout.stars) {
      ctx.globalAlpha = s.b * (0.6 + 0.4 * Math.sin(time * 1.5 + s.tw));
      ctx.fillStyle = s.s > 1 ? '#bcd3ff' : '#ffffff';
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // floors, then walls derived from the floor shape
    for (let y = 0; y < layout.hT; y++) for (let x = 0; x < layout.wT; x++) {
      if (!isFloor(x, y)) continue;
      blit(R[layout.tiles[y][x]] || R.floor, time, x * T, y * T);
    }
    // walkway stripes: blue in project rooms, gold in HQ, red while someone in the room has an error
    for (const rm of layout.rooms) {
      const err = rm.agents.some((id) => state.agents[id] && state.agents[id].status === 'error');
      const stripe = err ? R.stripeRed : rm.boss ? R.stripeYellow : R.stripeBlue;
      for (const c of rm.walk) blit(stripe, time, c.x * T, c.y * T);
    }
    // soft shadow along the walls gives the rooms depth
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    for (let y = 0; y < layout.hT; y++) for (let x = 0; x < layout.wT; x++) {
      if (!isFloor(x, y)) continue;
      if (!isFloor(x, y - 1)) ctx.fillRect(x * T, y * T, T, 7);
      if (!isFloor(x - 1, y)) ctx.fillRect(x * T, y * T, 5, T);
      if (!isFloor(x + 1, y)) ctx.fillRect(x * T + T - 5, y * T, 5, T);
    }
    for (let y = 0; y < layout.hT; y++) for (let x = 0; x < layout.wT; x++) {
      if (!isFloor(x, y)) continue;
      if (!isFloor(x, y - 1)) { blit(R.wall, time, x * T, (y - 1) * T); blit(R.wallTrim, time, x * T, (y - 2) * T + 8); }
      if (!isFloor(x, y + 1)) blit(R.wallBottom, time, x * T, (y + 1) * T - 8);
    }
    for (let y = 0; y < layout.hT; y++) for (let x = 0; x < layout.wT; x++) {
      if (!isFloor(x, y)) continue;
      if (!isFloor(x - 1, y)) blit(R.railLeft, time, x * T - 4, y * T);
      if (!isFloor(x + 1, y)) blit(R.railRight, time, x * T + 4, y * T);
      if (!isFloor(x - 1, y) && !isFloor(x, y - 1)) blit(R.railLeft, time, x * T - 4, (y - 1) * T);
      if (!isFloor(x + 1, y) && !isFloor(x, y - 1)) blit(R.railRight, time, x * T + 4, (y - 1) * T);
    }
    // hazard stripes at hallway mouths
    for (const h of layout.halls) {
      if (h.w === 2) { blit(R.hazard, time, h.x * T, h.y * T - 6); blit(R.hazard, time, (h.x + 1) * T, h.y * T - 6); }
    }

    for (const rm of layout.rooms) drawRoom(rm, time, state);

    // desks and characters, back to front
    const drawables = [];
    for (const rm of layout.rooms) for (const d of rm.decor) {
      const spr = R[d.role];
      if (!spr) continue;
      drawables.push({ y: d.y + spr.frames[0].h - 2, draw: () => {
        if (d.role === 'pillar') { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(d.x + 2, d.y + T - 4, T - 4, 6); }
        blit(spr, time + (d.x % 7) * 0.3, d.x, d.y);
      } });
    }
    for (const id of state.order) {
      const a = state.agents[id], p = layout.pods[id];
      if (!p) continue;
      if (p.room.spares && !p.room.sparesQueued) {
        p.room.sparesQueued = true;
        for (const d of p.room.spares) drawables.push({ y: d.y + T - 1, draw: () => blit(R.deskIdle, time, d.x, d.y) });
      }
      if (!p.boss) drawables.push({ y: p.desk.y + T - 1, draw: () => blit(a.status === 'working' ? R.deskWork : R.deskIdle, time, p.desk.x, p.desk.y, { offset: (p.px0 % 7) * 0.21 }) });
      const e = ents.get(id);
      if (e) drawables.push({ y: e.y, draw: () => character(a, e, state.order.indexOf(id), time) });
    }
    drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw());
    for (const rm of layout.rooms) rm.sparesQueued = false;

    for (const id of state.order) {
      const p = layout.pods[id];
      if (p) tags(state.agents[id], p, id === selectedId || id === hoverId);
    }
    for (const id of state.order) {
      const e = ents.get(id);
      if (e) bubble(e);
    }
    drawJuice();
    drawEffects();
    postFx();
  }

  // Screen-space finish: vignette to pull the eye to the middle, faint scanlines for a monitor feel.
  let scan = null;
  const fx = { scanlines: true, vignette: true };
  function postFx() {
    const { dpr, w, h } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fx.vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,10,.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.scanlines) {
      if (!scan) {
        const c = document.createElement('canvas'); c.width = 4; c.height = 3;
        const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, 2, 4, 1);
        scan = ctx.createPattern(c, 'repeat');
      }
      ctx.fillStyle = scan;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawRoom(rm, time, state) {
    const R = art.roles;
    const x = rm.x * T, y = rm.y * T, w = rm.w * T, h = rm.h * T;
    const anyWorking = rm.agents.some((id) => state.agents[id] && state.agents[id].status === 'working');
    // warm light over pods that are working, like a desk lamp on the floor
    for (const id of rm.agents) {
      const a = state.agents[id], p = layout.pods[id];
      if (a.status !== 'working') continue;
      const cx = p.boss ? p.work.x : p.desk.x + 30, cy = p.boss ? p.work.y - 24 : p.desk.y + 22;
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, p.boss ? 90 : 56);
      g.addColorStop(0, 'rgba(255,214,120,.30)');
      g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 100, cy - 100, 200, 200);
    }
    if (rm.boss) {
      blit(anyWorking ? R.screenWork : R.screenIdle, time, x + T * 0.6, y - T + 2);
      blit(anyWorking ? R.screenWork : R.screenIdle, time + 0.4, x + w - T * 0.6 - 64, y - T + 2);
      blit(R.tank, time, x + 8, y + 6);
      blit(R.tank, time + 0.5, x + w - T - 8, y + 6);
      blit(R.console, time, x + 8, y + h - T - 4);
      blit(R.console, time + 0.3, x + w - T - 8, y + h - T - 4);
    } else {
      for (const id of rm.agents) {
        const a = state.agents[id], p = layout.pods[id];
        blit(a.status === 'working' ? R.wallMonitor : R.wallMonitorOff, time, p.desk.x + 16, y - T + 2, { offset: (p.px0 % 5) * 0.37 });
      }
    }
    // wall lights with a pool of light below
    for (const l of rm.lights || []) {
      const col = l.c === 'gold' ? '255,214,120' : l.c === 'green' ? '120,255,170' : '120,170,255';
      const g = ctx.createRadialGradient(l.x + 16, y + 4, 2, l.x + 16, y + 4, 46);
      g.addColorStop(0, 'rgba(' + col + ',.22)');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(l.x - 32, y - 20, 96, 70);
      blit(l.c === 'green' ? R.wallLightGreen : R.wallLight, time, l.x, y - T - 6);
    }
    // room sign on the wall
    ctx.font = '700 7px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    label(rm.boss ? '★ HQ' : rm.name.toUpperCase(), x + w / 2, y - T - 14, rm.boss ? '#f5c542' : '#9cc7ff', 'rgba(8,12,30,.9)');
  }

  function character(a, e, index, time) {
    const p = layout.pods[a.id];
    const look = p.boss ? art.boss : lookFor(a, index);
    const size = p.boss ? 64 : 32;
    const walking = e.path.length > 0;
    const spr = walking ? look.walk : (a.status === 'working' && e.at === 'desk') ? look.work : look.idle;
    const sel = a.id === selectedId || a.id === hoverId;
    const rx = p.boss ? 20 : 8;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, rx, rx * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    if (sel) {
      ctx.strokeStyle = a.color || '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, rx + 3, rx * 0.38 + 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const bob = !walking && spr.frames.length < 2 ? Math.round(Math.sin(e.t * 2.4) * 0.6) : 0;
    blit(spr, e.t, Math.round(e.x - size / 2), Math.round(e.y - size + 1 + bob), { flip: !p.boss && e.facing < 0 });
  }

  // Name tag and run timer, like the station's desk placards.
  function tags(a, p, highlight) {
    const x = Math.round(p.tag.x), y = Math.round(p.tag.y);
    ctx.font = '700 7px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    const name = a.name.toUpperCase();
    const nw = ctx.measureText(name).width + 8;
    ctx.fillStyle = highlight ? 'rgba(30,44,90,.97)' : 'rgba(8,12,30,.92)';
    roundRect(x - nw / 2, y - 7, nw, 10, 2); ctx.fill();
    ctx.strokeStyle = a.color || '#5a78c8'; ctx.lineWidth = 0.75; ctx.stroke();
    ctx.fillStyle = '#e8f0ff';
    ctx.fillText(name, x, y + 0.6);
    let text, color;
    if (a.status === 'working') { text = 'RUN ' + fmtShort(now() - (a.task ? a.task.startedAt : a.since)); color = '#7ee08a'; }
    else if (a.status === 'error') { text = 'ERROR'; color = '#ff6b6b'; }
    else { text = 'IDLE ' + fmtShort(now() - a.since); color = '#8ea0c8'; }
    ctx.font = '700 6px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    const tx = Math.round(x + nw / 2 + 3);
    const tw = ctx.measureText(text).width + 6;
    ctx.fillStyle = 'rgba(8,12,30,.8)';
    roundRect(tx, y - 6, tw, 8.5, 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, tx + 3, y + 0.5);
    if (a.model) {
      ctx.textAlign = 'center';
      ctx.font = '600 6px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#f5c542';
      ctx.fillText(a.model, x, y + 10);
    }
  }

  function bubble(e) {
    if (!e.bubble || performance.now() >= e.bubble.until) return;
    const p = layout.pods[e.id];
    const x = Math.round(e.x), y = Math.round(e.y - (p.boss ? 62 : 34));
    const t = e.bubble.text.length > 34 ? e.bubble.text.slice(0, 33) + '…' : e.bubble.text;
    ctx.font = '500 6px system-ui, sans-serif';
    const w = ctx.measureText(t).width + 8;
    const bx = Math.round(Math.max(4, Math.min(layout.w - w - 4, x - w / 2))), by = y - 12;
    ctx.fillStyle = '#f4f6fb';
    roundRect(bx, by, w, 10, 3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 2, by + 10); ctx.lineTo(x + 2, by + 10); ctx.lineTo(x, by + 13); ctx.fill();
    ctx.fillStyle = '#1b1f33';
    ctx.textAlign = 'left';
    ctx.fillText(t, bx + 4, by + 7.3);
  }

  function label(text, x, y, color, bg) {
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg;
    roundRect(Math.round(x - w / 2), y - 7, w, 10, 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.6);
  }

  function drawEffects() {
    const t = performance.now();
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      const k = (t - f.t0) / f.dur;
      if (k >= 1) { effects.splice(i, 1); continue; }
      // pop in with a little overshoot, drift up, fade out
      const pin = Math.min(1, k / 0.18);
      const c1 = 1.70158, c3 = c1 + 1;
      const pop = 1 + c3 * Math.pow(pin - 1, 3) + c1 * Math.pow(pin - 1, 2);
      const sc = (f.big ? 1.6 : 1) * Math.max(0.01, pop);
      const yy = f.y - k * 20;
      ctx.save();
      ctx.translate(f.x, yy);
      ctx.scale(sc, sc);
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.font = '700 8px ui-monospace, Menlo, Consolas, monospace';
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#0b0d1c'; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hit(ev) {
    if (!layout) return null;
    const r = canvas.getBoundingClientRect();
    const wx = (ev.clientX - r.left - view.ox) / view.zoom;
    const wy = (ev.clientY - r.top - view.oy) / view.zoom;
    for (const e of ents.values()) {
      const big = layout.pods[e.id] && layout.pods[e.id].boss;
      if (Math.abs(wx - e.x) < (big ? 26 : 10) && wy > e.y - (big ? 62 : 30) && wy < e.y + 2) return e.id;
    }
    for (const [id, p] of Object.entries(layout.pods)) {
      if (p.boss) continue;
      if (wx >= p.px0 * T && wx < (p.px0 + POD_W) * T && wy >= p.py0 * T && wy < (p.py0 + POD_H) * T) return id;
    }
    return null;
  }

  function fmtShort(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0') : m + ':' + String(ss).padStart(2, '0');
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
  }

  return { init, onEvent, setSelected, fmtDur, frameCanvas, zoomAt, setAuto, getAuto, fx, moneyOf, assignLooks, lookOf: (a) => (pool[lookIndex(a)] ? pool[lookIndex(a)].key : '') + ':' + lookIndex(a) };

  // Draw a sprite frame into a small canvas, used for crew portraits.
  function frameCanvas(a, index, size) {
    if (!art) return null;
    const look = a.role === 'boss' ? art.boss : lookFor(a, index);
    const f = look.idle.frames[0];
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const s = size / f.w;
    g.drawImage(look.idle.img, f.sx, f.sy, f.w, f.h, 0, 0, f.w * s, f.h * s);
    return c;
  }
})();
