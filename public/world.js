// The farm floor: lays out one pod (desk, rug, name plate, wall screen) per
// agent plus a lounge where idle agents hang out, and animates characters
// walking between them as their status changes.
'use strict';

const World = (() => {
  const T = 32;          // tile size in world pixels
  const POD_W = 4, POD_H = 3, WALL_H = 2, LOUNGE_W = 4;
  const WALK_SPEED = 70; // world px per second

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

  // ---- layout ---------------------------------------------------------------
  function buildLayout(order) {
    const n = Math.max(order.length, 1);
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const wT = 1 + cols * POD_W + LOUNGE_W + 1;
    const hT = WALL_H + rows * POD_H + 1;
    const pods = {};
    order.forEach((id, i) => {
      const px0 = 1 + (i % cols) * POD_W;
      const py0 = WALL_H + Math.floor(i / cols) * POD_H;
      pods[id] = {
        index: i, px0, py0,
        desk: { x: Math.round((px0 + 0.55) * T), y: Math.round((py0 + 0.45) * T) },
        work: { x: Math.round((px0 + 1.55) * T + 10), y: Math.round((py0 + 0.45) * T + 30) },
        plate: { x: Math.round((px0 + 1.5) * T), y: (py0 + 2) * T + 3 },
        gapY: (py0 + 2) * T + 26,
      };
    });
    const lx0 = 1 + cols * POD_W;
    const lounge = order.map((id, i) => ({
      x: (lx0 + 0.6 + (i % 3) * 1.3) * T,
      y: (WALL_H + 3.2 + Math.floor(i / 3) * 1.4) * T,
    }));
    // One wall screen per agent: over the pods if they fit, else across the whole wall.
    let span = cols * POD_W, start = 1;
    const wide = span / n < 2.15;
    if (wide) { span = wT - 1; start = 0.5; }
    const slot = span / n;
    const screens = slot >= 2.05 ? order.map((id, i) => ({ id, x: Math.round((start + slot * (i + 0.5)) * T - 32), y: 14 })) : [];
    return { key: order.join('|'), cols, rows, wT, hT, w: wT * T, h: hT * T, pods, lx0, lounge, screens, wide };
  }

  function targetFor(a) {
    const pod = layout.pods[a.id];
    if (a.status === 'idle') return Object.assign({ kind: 'lounge' }, layout.lounge[pod.index]);
    return Object.assign({ kind: 'desk' }, pod.work);
  }

  function sync(state) {
    if (!layout || layout.key !== state.order.join('|')) {
      layout = buildLayout(state.order);
      for (const id of [...ents.keys()]) if (!layout.pods[id]) ents.delete(id);
    }
    for (const id of state.order) {
      const a = state.agents[id];
      const tgt = targetFor(a);
      let e = ents.get(id);
      if (!e) {
        e = { id, x: tgt.x, y: tgt.y, path: [], facing: 1, at: tgt.kind, t: Math.random() * 10, bubble: null };
        ents.set(id, e);
      }
      const last = e.path.length ? e.path[e.path.length - 1] : { x: e.x, y: e.y };
      if (Math.abs(last.x - tgt.x) > 1 || Math.abs(last.y - tgt.y) > 1) {
        const gy = tgt.kind === 'desk' ? layout.pods[id].gapY : tgt.y;
        e.path = [{ x: e.x, y: gy }, { x: tgt.x, y: gy }, { x: tgt.x, y: tgt.y }];
        e.at = null;
        e.goal = tgt.kind;
      }
    }
  }

  // ---- events -> effects ------------------------------------------------------
  function onEvent(ev, a) {
    const e = ents.get(ev.agent);
    if (!e) return;
    if (ev.type === 'task.progress' && ev.note) e.bubble = { text: ev.note, until: performance.now() + 4500 };
    if (ev.type === 'task.start') e.bubble = { text: ev.title, until: performance.now() + 4000 };
    if (ev.type === 'task.done') addEffect(e, ev.value ? '+' + String(ev.value).replace(/^\+/, '') : 'done!', '#7ee08a');
    if (ev.type === 'task.fail') addEffect(e, 'failed', '#ff6b6b');
  }

  function addEffect(e, text, color) {
    effects.push({ x: e.x, y: e.y - 34, text, color, t0: performance.now(), dur: 2200 });
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
      step(dt, state);
      draw(t / 1000, state);
    }
    requestAnimationFrame(frame);
  }

  function step(dt, state) {
    for (const e of ents.values()) {
      e.t += dt;
      if (!e.path.length) continue;
      const p = e.path[0];
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      const move = WALK_SPEED * dt;
      if (Math.abs(dx) > 0.5) e.facing = dx < 0 ? -1 : 1;
      if (d <= move) { e.x = p.x; e.y = p.y; e.path.shift(); if (!e.path.length) { e.at = e.goal; e.facing = e.at === 'desk' ? -1 : e.facing; } }
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

  function draw(time, state) {
    resize();
    const { zoom, ox, oy, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1220';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, ox * dpr, oy * dpr);
    ctx.imageSmoothingEnabled = false;
    const R = art.roles;

    // floor
    for (let ty = WALL_H; ty < layout.hT; ty++) {
      for (let tx = 0; tx < layout.wT; tx++) {
        const vent = (tx * 7 + ty * 13) % 23 === 0;
        blit(vent ? R.floorVent : R.floor, time, tx * T, ty * T);
      }
    }
    // pod rugs
    for (const id of state.order) {
      const p = layout.pods[id];
      for (let y = 0; y < POD_H - 1; y++) for (let x = 0; x < POD_W - 1; x++) blit(R.floorAccent, time, (p.px0 + x) * T, (p.py0 + y) * T);
    }
    // wall
    for (let ty = 0; ty < WALL_H; ty++) for (let tx = 0; tx < layout.wT; tx++) blit(R.wall, time, tx * T, ty * T);
    for (let tx = 0; tx < layout.wT; tx++) blit(R.wallTrim, time, tx * T, (WALL_H - 1) * T + 8);
    // wall screens: lit while their agent works
    ctx.font = '600 6px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    for (const s of layout.screens) {
      const a = state.agents[s.id];
      blit(a.status === 'working' ? R.screenWork : R.screenIdle, time, s.x, s.y, { offset: layout.pods[s.id].index * 0.37 });
      label(a.name.toUpperCase(), s.x + 32, s.y + 38, a.color || '#9fb0d0', 'rgba(15,18,32,.85)');
    }
    // lounge decor
    const lx = layout.lx0 * T;
    if (!layout.wide) {
      blit(R.wallMonitor, time, lx + T * 0.5, T * 0.4);
      blit(R.wallMonitor, time + 0.6, lx + T * 2.3, T * 0.4);
    }
    blit(R.tank, time, lx + T * 0.2, WALL_H * T - 6);
    blit(R.tank, time + 0.3, lx + T * 2.9, WALL_H * T - 6);
    blit(R.console, time, lx + T * 1.55, WALL_H * T + 2);
    const bottom = layout.hT * T - T - 6;
    blit(R.crate, time, lx + T * 0.2, bottom);
    blit(R.crateOpen, time, lx + T * 1.2, bottom);
    blit(R.capsule, time, lx + T * 2.9, bottom);

    // name plates
    for (const id of state.order) {
      const a = state.agents[id], p = layout.pods[id];
      plate(a, p.plate.x, p.plate.y, id === selectedId || id === hoverId);
    }

    // desks and characters, back to front
    const drawables = [];
    for (const id of state.order) {
      const a = state.agents[id], p = layout.pods[id];
      drawables.push({ y: p.desk.y + T - 1, draw: () => blit(a.status === 'working' ? R.deskWork : R.deskIdle, time, p.desk.x, p.desk.y, { offset: p.index * 0.21 }) });
      const e = ents.get(id);
      if (e) drawables.push({ y: e.y, draw: () => character(a, e, p.index, time) });
    }
    drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw());

    // overhead tags and bubbles on top of everything
    for (const id of state.order) {
      const e = ents.get(id);
      if (e) overhead(state.agents[id], e);
    }
    drawEffects();
  }

  function character(a, e, index, time) {
    const look = lookFor(a, index);
    const walking = e.path.length > 0;
    const spr = walking ? look.walk : (a.status === 'working' && e.at === 'desk') ? look.work : look.idle;
    const sel = a.id === selectedId || a.id === hoverId;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    if (sel) {
      ctx.strokeStyle = a.color || '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, 11, 4.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const bob = !walking && spr.frames.length < 2 ? Math.round(Math.sin(e.t * 2.4) * 0.6) : 0;
    blit(spr, e.t, Math.round(e.x - 16), Math.round(e.y - 31 + bob), { flip: e.facing < 0 });
  }

  function overhead(a, e) {
    const x = Math.round(e.x), y = Math.round(e.y - 34);
    ctx.font = '600 6px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    let text, color;
    if (a.status === 'working') { text = '▶ ' + fmtDur(now() - (a.task ? a.task.startedAt : a.since)); color = '#7ee08a'; }
    else if (a.status === 'error') { text = '! error'; color = '#ff6b6b'; }
    else { text = 'zz ' + fmtDur(now() - a.since); color = '#9fb0d0'; }
    label(text, x, y, color, 'rgba(15,18,32,.8)');
    if (e.bubble && performance.now() < e.bubble.until) {
      const t = e.bubble.text.length > 34 ? e.bubble.text.slice(0, 33) + '…' : e.bubble.text;
      ctx.font = '500 6px system-ui, sans-serif';
      const w = ctx.measureText(t).width + 8;
      const bx = Math.round(Math.max(4, Math.min(layout.w - w - 4, x - w / 2))), by = y - 18;
      ctx.fillStyle = '#f4f6fb';
      roundRect(bx, by, w, 10, 3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 2, by + 10); ctx.lineTo(x + 2, by + 10); ctx.lineTo(x, by + 13); ctx.fill();
      ctx.fillStyle = '#1b1f33';
      ctx.textAlign = 'left';
      ctx.fillText(t, bx + 4, by + 7.3);
      ctx.textAlign = 'center';
    }
  }

  function plate(a, x, y, highlight) {
    ctx.font = '700 7px system-ui, sans-serif';
    const name = a.name;
    ctx.font = '500 5px system-ui, sans-serif';
    const biz = a.business.length > 30 ? a.business.slice(0, 29) + '…' : a.business;
    const w = Math.max(48, ctx.measureText(biz).width + 10);
    const bx = Math.round(x - w / 2);
    ctx.fillStyle = highlight ? 'rgba(40,46,78,.95)' : 'rgba(20,24,42,.88)';
    roundRect(bx, y, w, 18, 3); ctx.fill();
    ctx.fillStyle = a.color || '#9fb0d0';
    ctx.fillRect(bx, y + 2, 2, 14);
    const dot = a.status === 'working' ? '#7ee08a' : a.status === 'error' ? '#ff6b6b' : '#6b7899';
    ctx.fillStyle = dot;
    ctx.beginPath(); ctx.arc(bx + w - 5, y + 5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4f6fb';
    ctx.font = '700 7px system-ui, sans-serif';
    ctx.fillText(name, x, y + 8);
    ctx.fillStyle = '#9fb0d0';
    ctx.font = '500 5px system-ui, sans-serif';
    ctx.fillText(biz, x, y + 15);
  }

  function label(text, x, y, color, bg) {
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = bg;
    roundRect(Math.round(x - w / 2), y - 6, w, 8.5, 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.5);
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
    for (const e of ents.values()) if (Math.abs(wx - e.x) < 10 && wy > e.y - 30 && wy < e.y + 2) return e.id;
    for (const [id, p] of Object.entries(layout.pods)) {
      if (wx >= p.px0 * T && wx < (p.px0 + POD_W - 1) * T && wy >= p.py0 * T && wy < (p.py0 + POD_H - 0.4) * T) return id;
    }
    return null;
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
  }

  return { init, onEvent, setSelected, fmtDur };
})();
