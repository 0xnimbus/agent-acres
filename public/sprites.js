// Sprite loading. Every role resolves to { img, frames: [{sx, sy, w, h}], fps }
// whether it comes from an art pack manifest or from the procedural placeholder
// art below, so the world renderer never cares which one is in use.
'use strict';

const Sprites = (() => {
  const ROLES = ['floor', 'floorAccent', 'floorVent', 'wall', 'wallTrim', 'deskWork', 'deskIdle', 'screenWork', 'screenIdle',
    'wallMonitor', 'wallMonitorOff', 'wallBottom', 'railLeft', 'railRight', 'hazard', 'console', 'floorGrate', 'floorPanel', 'stripeBlue', 'stripeYellow', 'stripeRed', 'pillar', 'wallLight', 'wallLightGreen', 'tank', 'crate', 'crateOpen', 'capsule'];

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not load ' + src));
      img.src = src;
    });
  }

  function fromManifestSprite(sheets, def) {
    const img = sheets[def.sheet];
    if (!img) throw new Error('manifest sprite uses unknown sheet "' + def.sheet + '"');
    const [w, h] = def.cell;
    return { img, fps: def.fps || 0, frames: def.frames.map(([c, r]) => ({ sx: c * w, sy: r * h, w, h })) };
  }

  async function fromManifest(m) {
    const sheets = {};
    await Promise.all(Object.entries(m.sheets).map(async ([key, file]) => {
      sheets[key] = await loadImage('/assets/' + file.split('/').map(encodeURIComponent).join('/'));
    }));
    const placeholder = buildPlaceholder();
    const roles = {};
    for (const role of ROLES) {
      roles[role] = m.sprites && m.sprites[role] ? fromManifestSprite(sheets, m.sprites[role]) : placeholder.roles[role];
    }
    const fps = Object.assign({ idle: 2, work: 6, walk: 8 }, m.characterFps || {});
    const looks = (m.characters || []).filter((c) => sheets[c.sheet]).map((c, i) => ({
      key: c.key || 'look-' + i, name: c.name || c.key || 'Look ' + (i + 1),
      idle: fromManifestSprite(sheets, { sheet: c.sheet, cell: c.cell, frames: c.idle, fps: fps.idle }),
      work: fromManifestSprite(sheets, { sheet: c.sheet, cell: c.cell, frames: c.work, fps: fps.work }),
      walk: fromManifestSprite(sheets, { sheet: c.sheet, cell: c.cell, frames: c.walk, fps: fps.walk }),
    }));
    const b = m.boss;
    const boss = b ? {
      idle: fromManifestSprite(sheets, { sheet: b.sheet, cell: b.cell, frames: b.idle, fps: fps.idle * 2 }),
      work: fromManifestSprite(sheets, { sheet: b.sheet, cell: b.cell, frames: b.work, fps: fps.work }),
      walk: fromManifestSprite(sheets, { sheet: b.sheet, cell: b.cell, frames: b.walk, fps: fps.walk }),
    } : placeholder.boss;
    return { roles, looks: looks.length ? looks : placeholder.looks, boss, name: m.name, credit: m.credit, url: m.url, placeholder: false };
  }

  // ---- placeholder art (original, procedural, free to redistribute) --------
  function sheet(w, h, n, draw) {
    const c = document.createElement('canvas');
    c.width = w * n; c.height = h;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) { g.save(); g.translate(i * w, 0); draw(g, i); g.restore(); }
    return { img: c, fps: 0, frames: Array.from({ length: n }, (_, i) => ({ sx: i * w, sy: 0, w, h })) };
  }
  const px = (g, color, x, y, w, h) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

  function buildPlaceholder() {
    const roles = {};
    roles.floor = sheet(32, 32, 1, (g) => { px(g, '#262b44', 0, 0, 32, 32); px(g, '#2d3352', 1, 1, 30, 30); });
    roles.floorAccent = sheet(32, 32, 1, (g) => { px(g, '#262b44', 0, 0, 32, 32); px(g, '#323a5e', 1, 1, 30, 30); px(g, '#262b44', 15, 0, 2, 32); px(g, '#262b44', 0, 15, 32, 2); });
    roles.floorVent = sheet(32, 32, 1, (g) => { px(g, '#262b44', 0, 0, 32, 32); px(g, '#2d3352', 1, 1, 30, 30); for (let y = 6; y < 28; y += 4) px(g, '#1b1f33', 6, y, 20, 2); });
    roles.wall = sheet(32, 32, 1, (g) => { px(g, '#3e4a68', 0, 0, 32, 32); px(g, '#56658a', 2, 2, 28, 26); px(g, '#2b3350', 0, 30, 32, 2); });
    roles.wallTrim = sheet(32, 32, 1, (g) => { px(g, '#8fa3c0', 0, 20, 32, 6); px(g, '#56658a', 0, 26, 32, 6); });
    const desk = (g, on, i) => {
      px(g, '#4b5675', 2, 18, 28, 12); px(g, '#6b7899', 2, 18, 28, 3); px(g, '#1b1f33', 4, 30, 4, 2); px(g, '#1b1f33', 24, 30, 4, 2);
      px(g, '#2b3350', 8, 4, 16, 13); px(g, on ? ['#5fd38d', '#7ee0a5', '#5fd38d', '#9cf0c0'][i] : '#1b1f33', 10, 6, 12, 9);
      if (on) { px(g, '#1b1f33', 11, 8 + (i % 2) * 2, 6 + i, 1); px(g, '#1b1f33', 11, 12, 8 - i, 1); }
      px(g, '#2b3350', 14, 17, 4, 2); px(g, '#c7cfe0', 9, 21, 10, 3);
    };
    roles.deskWork = Object.assign(sheet(32, 32, 4, (g, i) => desk(g, true, i)), { fps: 5 });
    roles.deskIdle = sheet(32, 32, 1, (g) => desk(g, false, 0));
    const screen = (g, on, i) => {
      px(g, '#8fa3c0', 2, 4, 60, 24); px(g, on ? '#3a8ee6' : '#1b1f33', 4, 6, 56, 18);
      if (on) for (let b = 0; b < 8; b++) { const h = 3 + ((b * 7 + i * 5) % 11); px(g, '#9fd3ff', 8 + b * 6, 22 - h, 4, h); }
      px(g, '#2b3350', 4, 28, 56, 2);
    };
    roles.screenWork = Object.assign(sheet(64, 32, 4, (g, i) => screen(g, true, i)), { fps: 3 });
    roles.screenIdle = sheet(64, 32, 1, (g) => screen(g, false, 0));
    roles.wallMonitor = Object.assign(sheet(32, 32, 2, (g, i) => { px(g, '#8fa3c0', 3, 8, 26, 16); px(g, i ? '#7ed37e' : '#5cb85c', 5, 10, 22, 12); }), { fps: 1 });
    roles.wallMonitorOff = sheet(32, 32, 1, (g) => { px(g, '#8fa3c0', 3, 8, 26, 16); px(g, '#1b1f33', 5, 10, 22, 12); });
    roles.wallBottom = sheet(32, 32, 1, (g) => { px(g, '#3e4a68', 0, 0, 32, 24); px(g, '#56658a', 2, 2, 28, 18); px(g, '#8fa3c0', 0, 22, 32, 3); });
    roles.railLeft = sheet(32, 32, 1, (g) => { px(g, '#8fa3c0', 2, 0, 4, 32); px(g, '#56658a', 6, 0, 1, 32); });
    roles.railRight = sheet(32, 32, 1, (g) => { px(g, '#8fa3c0', 26, 0, 4, 32); px(g, '#56658a', 25, 0, 1, 32); });
    roles.hazard = sheet(32, 32, 1, (g) => { for (let x = 0; x < 32; x += 8) { px(g, '#f5c542', x, 26, 4, 4); px(g, '#1b1f33', x + 4, 26, 4, 4); } });
    const stripe = (c) => sheet(32, 32, 1, (g) => { px(g, '#262b44', 0, 0, 32, 32); px(g, '#2d3352', 1, 1, 30, 30); for (let x = 0; x < 32; x += 8) { px(g, c, x, 2, 4, 3); px(g, c, x + 2, 27, 4, 3); } });
    roles.stripeBlue = stripe('#3a62d8'); roles.stripeYellow = stripe('#f5c542'); roles.stripeRed = stripe('#d84a5a');
    roles.floorGrate = sheet(32, 32, 1, (g) => { px(g, '#1b1f33', 0, 0, 32, 32); for (let y = 3; y < 30; y += 4) px(g, '#2d3352', 3, y, 26, 2); });
    roles.floorPanel = sheet(32, 32, 1, (g) => { px(g, '#262b44', 0, 0, 32, 32); px(g, '#323a5e', 2, 2, 28, 28); for (let y = 6; y < 28; y += 6) px(g, '#7ee0a5', 6, y, 20, 1); });
    roles.pillar = sheet(32, 32, 1, (g) => { px(g, '#8fa3c0', 2, 0, 28, 30); px(g, '#56658a', 5, 4, 22, 24); px(g, '#2b3350', 2, 30, 28, 2); });
    roles.wallLight = sheet(32, 32, 1, (g) => { px(g, '#2b3350', 12, 10, 8, 8); px(g, '#9fd3ff', 13, 11, 6, 6); });
    roles.wallLightGreen = sheet(32, 32, 1, (g) => { px(g, '#2b3350', 12, 10, 8, 8); px(g, '#9cf0c0', 13, 11, 6, 6); });
    roles.console = Object.assign(sheet(32, 32, 2, (g, i) => { px(g, '#2b3350', 2, 8, 28, 22); px(g, i ? '#5fb3f0' : '#3a8ee6', 5, 11, 14, 8); px(g, '#7ee0a5', 22, 11, 5, 8); }), { fps: 2 });
    roles.tank = Object.assign(sheet(32, 64, 2, (g, i) => {
      px(g, '#8fa3c0', 5, 4, 22, 8); px(g, '#6fcf6f', 6, 12, 20, 40); px(g, '#4caf50', 6, 44 - i * 2, 20, 8 + i * 2); px(g, '#8fa3c0', 5, 52, 22, 8);
      px(g, '#b5f5b5', 9, 16 + i * 3, 3, 3);
    }), { fps: 2 });
    roles.crate = sheet(32, 32, 1, (g) => { px(g, '#5b6b8c', 3, 10, 26, 18); px(g, '#7d8db0', 3, 10, 26, 4); px(g, '#3e4a68', 14, 14, 4, 14); });
    roles.crateOpen = sheet(32, 32, 1, (g) => { px(g, '#5b6b8c', 3, 12, 26, 16); px(g, '#2b3350', 5, 12, 22, 5); px(g, '#f5c542', 9, 13, 4, 3); px(g, '#f5c542', 18, 14, 3, 3); });
    roles.capsule = sheet(32, 32, 1, (g) => { px(g, '#5b6b8c', 11, 6, 10, 22); px(g, '#e8eef8', 13, 18, 6, 6); });

    const LOOK_COLORS = ['#3a8ee6', '#e2483d', '#4caf50', '#9aa5b8', '#f5a623', '#bd10e0', '#50e3c2', '#e94e77'];
    const looks = LOOK_COLORS.map((body, li) => {
      const person = (g, arm, leg, bob) => {
        const y = 6 + bob;
        px(g, '#1b1f33', 12, y + 22, 8, 2); // shadow-ish feet base
        px(g, '#2b2b3a', 12 + leg, y + 18, 3, 5); px(g, '#2b2b3a', 17 - leg, y + 18, 3, 5); // legs
        px(g, body, 11, y + 8, 10, 11); // torso
        px(g, '#ffffff', 11, y + 8, 10, 2);
        px(g, body, 8, y + 9 + arm, 3, 7); px(g, body, 21, y + 9 - arm, 3, 7); // arms
        px(g, '#f2c79a', 12, y, 8, 8); px(g, '#3b2a1f', 12, y, 8, 3); // head + hair
        px(g, '#1b1f33', 14, y + 4, 1, 2); px(g, '#1b1f33', 17, y + 4, 1, 2); // eyes
      };
      return {
        key: 'placeholder-' + li, name: 'Placeholder ' + (li + 1),
        idle: Object.assign(sheet(32, 32, 2, (g, i) => person(g, 0, 0, i)), { fps: 2 }),
        work: Object.assign(sheet(32, 32, 2, (g, i) => person(g, i ? -2 : 1, 0, 0)), { fps: 6 }),
        walk: Object.assign(sheet(32, 32, 4, (g, i) => person(g, [1, 0, -1, 0][i], [1, 0, -1, 0][i] + 1, i % 2)), { fps: 8 }),
      };
    });
    // The boss: a chunky 64x64 mech with a glowing visor.
    const mech = (g, arm, leg, bob, glow) => {
      const y = 6 + bob;
      px(g, '#2b3350', 18 + leg, y + 38, 8, 18); px(g, '#2b3350', 38 - leg, y + 38, 8, 18); // legs
      px(g, '#1b1f33', 16 + leg, y + 54, 12, 4); px(g, '#1b1f33', 36 - leg, y + 54, 12, 4);
      px(g, '#3e4a68', 12, y + 12, 40, 28); px(g, '#56658a', 14, y + 14, 36, 6); // body
      px(g, glow, 20, y + 24, 24, 4); // chest light
      px(g, '#3e4a68', 4, y + 16 + arm, 8, 18); px(g, '#3e4a68', 52, y + 16 - arm, 8, 18); // arms
      px(g, glow, 6, y + 32 + arm, 4, 3); px(g, glow, 54, y + 32 - arm, 4, 3);
      px(g, '#56658a', 22, y, 20, 13); px(g, '#1b1f33', 24, y + 4, 16, 5); px(g, glow, 26, y + 5, 12, 3); // head + visor
    };
    const boss = {
      idle: Object.assign(sheet(64, 64, 2, (g, i) => mech(g, 0, 0, i, '#f5c542')), { fps: 2 }),
      work: Object.assign(sheet(64, 64, 4, (g, i) => mech(g, [0, 2, 0, -2][i], 0, 0, ['#f5c542', '#ffe08a', '#f5c542', '#ffd060'][i])), { fps: 6 }),
      walk: Object.assign(sheet(64, 64, 4, (g, i) => mech(g, [2, 0, -2, 0][i], [2, 0, -2, 0][i], i % 2, '#f5c542')), { fps: 8 }),
    };
    return { roles, looks, boss, name: 'Placeholder art', placeholder: true };
  }

  // Recolor a look so agents beyond the pack's looks stay distinguishable.
  function tintLook(look, color) {
    const tint = (spr) => {
      const c = document.createElement('canvas');
      c.width = spr.img.width; c.height = spr.img.height;
      const g = c.getContext('2d');
      g.drawImage(spr.img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.45;
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      return Object.assign({}, spr, { img: c });
    };
    return { key: look.key, name: look.name, idle: tint(look.idle), work: tint(look.work), walk: tint(look.walk) };
  }

  async function load() {
    let m = { placeholder: true };
    try { m = await (await fetch('/api/manifest')).json(); } catch { /* offline: placeholder */ }
    if (!m.placeholder) {
      try { return await fromManifest(m); } catch (e) { console.warn('[acres] art pack failed to load, using placeholders:', e); }
    }
    return buildPlaceholder();
  }

  return { load, tintLook };
})();
