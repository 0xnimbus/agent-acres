// The station: rooms floating in space, linked by hallways. HQ (the boss) sits
// in the middle; every project gets its own room around it. Inside a room each
// agent has a pod (name tag, run timer, desk); characters walk between the desk
// and an idle spot as their status changes.
'use strict';

const World = (() => {
  const T = 32;          // tile size in world pixels
  const POD_W = 4, POD_H = 3;
  const GAP_X = 4, GAP_Y = 5, MARGIN = 2;
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
    canvas.addEventListener('mousemove', (e) => { hoverId = hit(e); canvas.style.cursor = hoverId ? 'pointer' : 'default'; });
    canvas.addEventListener('mouseleave', () => { hoverId = null; });
    canvas.addEventListener('click', (e) => { const id = hit(e); onSelect(id); });
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
    const RW = Math.max(7, podCols * POD_W + 1);          // room interior, tiles
    const RH = Math.max(4, podRows * POD_H + 1);

    const projects = [...groups.keys()];
    const slots = RING.slice();
    for (let r = 3; slots.length < projects.length; r++) for (let c = 0; c < 3; c++) slots.push([c, r]);
    const gridRows = Math.max(3, ...slots.slice(0, projects.length).map((s) => s[1] + 1));

    const wT = MARGIN * 2 + 3 * RW + 2 * GAP_X;
    const hT = MARGIN * 2 + 2 + gridRows * RH + (gridRows - 1) * GAP_Y + 1;
    const floor = Array.from({ length: hT }, () => new Uint8Array(wT));
    const fill = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (floor[y] && x >= 0 && x < wT) floor[y][x] = 1; };
    const roomAt = (c, r) => ({ x: MARGIN + c * (RW + GAP_X), y: MARGIN + 2 + r * (RH + GAP_Y), w: RW, h: RH, c, r });

    const rooms = [];
    const pods = {};
    const hq = Object.assign(roomAt(1, 1), { name: 'HQ', boss: true, agents: bosses });
    rooms.push(hq);
    bosses.forEach((id, i) => {
      const cx = (hq.x + RW / 2) * T + (i - (bosses.length - 1) / 2) * 80;
      const feet = (hq.y + 1) * T + 70;
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
        const py0 = room.y + 0.5 + Math.floor(k / podCols) * POD_H;
        room.spares.push({ x: Math.round((px0 + 0.6) * T), y: Math.round((py0 + 0.9) * T) });
      }
      ids.forEach((id, k) => {
        const row = Math.floor(k / podCols), col = k % podCols;
        const px0 = room.x + (RW - podCols * POD_W) / 2 + col * POD_W;
        const py0 = room.y + 0.5 + row * POD_H;
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
    for (const rm of rooms) fill(rm.x, rm.y, rm.w, rm.h);
    const halls = [];
    const linkH = (a, b) => { const y = a.y + Math.floor(a.h / 2) - 1; fill(a.x + a.w, y, b.x - a.x - a.w, 2); halls.push({ x: a.x + a.w, y, w: b.x - a.x - a.w, h: 2 }); };
    const linkV = (a, b) => { const x = a.x + Math.floor(a.w / 2) - 1; fill(x, a.y + a.h, 2, b.y - a.y - a.h); halls.push({ x, y: a.y + a.h, w: 2, h: b.y - a.y - a.h }); };
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

    const stars = [];
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (wT * hT) / 3; i++) stars.push({ x: rnd() * wT * T, y: rnd() * hT * T, s: rnd() < 0.12 ? 2 : 1, tw: rnd() * 6.28, b: 0.35 + rnd() * 0.65 });

    return { key: layoutKey(state), RW, RH, wT, hT, w: wT * T, h: hT * T, rooms, halls, pods, floor, stars };
  }

  function targetFor(a) {
    const pod = layout.pods[a.id];
    if (a.status === 'idle') return Object.assign({ kind: 'idle' }, pod.idle);
    return Object.assign({ kind: 'desk' }, pod.work);
  }

  function sync(state) {
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
    if (ev.type === 'task.done') addEffect(e, ev.value ? '+' + String(ev.value).replace(/^\+/, '') : 'done!', '#7ee08a');
    if (ev.type === 'task.fail') addEffect(e, 'failed', '#ff6b6b');
  }

  function addEffect(e, text, color) {
    const p = layout && layout.pods[e.id];
    effects.push({ x: e.x, y: e.y - (p && p.boss ? 68 : 34), text, color, t0: performance.now(), dur: 2200 });
  }

  // ---- render ----------------------------------------------------------------
  let lastT = performance.now();
  let view = { zoom: 1, ox: 0, oy: 0 };

  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    const state = getState();
    if (state && art) {
      sync(state);
      step(dt);
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

  function lookFor(a, index) {
    const looks = art.looks;
    const li = Number.isInteger(a.look) ? a.look : index;
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
    let zoom = Math.min(w / layout.w, h / layout.h);
    zoom = zoom >= 1 ? Math.floor(zoom * 4) / 4 : zoom;
    view = { zoom, ox: Math.floor((w - layout.w * zoom) / 2), oy: Math.floor((h - layout.h * zoom) / 2), dpr, w, h };
  }

  const isFloor = (x, y) => y >= 0 && y < layout.hT && x >= 0 && x < layout.wT && layout.floor[y][x] === 1;

  function draw(time, state) {
    resize();
    const { zoom, ox, oy, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, ox * dpr, oy * dpr);
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
      blit((x * 7 + y * 13) % 29 === 0 ? R.floorVent : R.floor, time, x * T, y * T);
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
    drawEffects();
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
      blit(R.crate, time, x + 2, y + h - T + 4);
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
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = '#0f1220';
      ctx.fillText(f.text, f.x + 0.6, f.y - k * 18 + 0.6);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - k * 18);
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

  return { init, onEvent, setSelected, fmtDur, frameCanvas };

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
