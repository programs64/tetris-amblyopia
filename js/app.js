/*
 * App layer: settings (persisted to localStorage), colors, rendering,
 * keyboard input with DAS/ARR, custom key bindings and the settings dialog.
 */
(function () {
  'use strict';

  const E = window.BlockEngine;
  const STORAGE_KEY = 'dichoptic-drop-settings-v1';
  const BEST_KEY = 'dichoptic-drop-best-v1';

  const ACTIONS = [
    ['moveLeft', 'Move left'],
    ['moveRight', 'Move right'],
    ['softDrop', 'Soft drop'],
    ['hardDrop', 'Hard drop'],
    ['rotateCW', 'Rotate clockwise'],
    ['rotateCCW', 'Rotate counter-clockwise'],
    ['rotate180', 'Rotate 180°'],
    ['hold', 'Hold'],
    ['pause', 'Pause / resume'],
    ['restart', 'Restart'],
  ];

  const DEFAULT_KEYS = {
    moveLeft: ['ArrowLeft', null],
    moveRight: ['ArrowRight', null],
    softDrop: ['ArrowDown', null],
    hardDrop: ['Space', null],
    rotateCW: ['ArrowUp', 'KeyX'],
    rotateCCW: ['KeyZ', 'ControlLeft'],
    rotate180: ['KeyA', null],
    hold: ['KeyC', 'ShiftLeft'],
    pause: ['Escape', 'KeyP'],
    restart: ['KeyR', null],
  };

  const DEFAULT_COLORS = {
    fallingColor: '#ff0000',
    lockedColor: '#00ffff',
    gameBg: '#000000',
    pageBgDark: '#121212',
    pageBgLight: '#f2f2f2',
  };

  const DEFAULTS = Object.assign({}, DEFAULT_COLORS, {
    linkColors: false,
    theme: 'dark',
    ghost: true,
    grid: true,
    nextCount: 5,
    startLevel: 1,
    das: 167,
    arr: 33,
    sdf: 20,
    keys: DEFAULT_KEYS,
  });

  const COLOR_KEYS = Object.keys(DEFAULT_COLORS);

  // ---------- Settings persistence ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadSettings() {
    const s = clone(DEFAULTS);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const k of Object.keys(DEFAULTS)) {
          if (k === 'keys') continue;
          if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
        }
        if (saved.keys && typeof saved.keys === 'object') {
          for (const [action] of ACTIONS) {
            const v = saved.keys[action];
            if (Array.isArray(v)) s.keys[action] = [v[0] || null, v[1] || null];
          }
        }
      }
    } catch (e) { /* storage unavailable or corrupt: use defaults */ }
    for (const k of COLOR_KEYS) if (!normalizeHex(s[k])) s[k] = DEFAULT_COLORS[k];
    return s;
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  // ---------- Color helpers ----------

  // Accepts "#abc", "abc", "#aabbcc" or "aabbcc"; returns "#aabbcc" or null.
  function normalizeHex(v) {
    if (typeof v !== 'string') return null;
    let h = v.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return '#' + h.toLowerCase();
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function isLight(hex) { return luminance(hex) > 0.18; }

  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function fallingColor() { return settings.fallingColor; }
  function lockedColor() { return settings.linkColors ? settings.fallingColor : settings.lockedColor; }
  function pageBg() { return settings.theme === 'dark' ? settings.pageBgDark : settings.pageBgLight; }

  function applyColors() {
    const bg = pageBg();
    const light = isLight(bg);
    const fg = light ? '#161616' : '#ececec';
    const root = document.documentElement.style;
    root.setProperty('--page-bg', bg);
    root.setProperty('--fg', fg);
    root.setProperty('--muted', rgba(fg, 0.65));
    root.setProperty('--panel', rgba(fg, 0.06));
    root.setProperty('--border', rgba(fg, 0.2));
    root.setProperty('--dialog-bg', mix(bg, fg, 0.06));
    root.setProperty('--game-bg', settings.gameBg);
    root.setProperty('color-scheme', light ? 'light' : 'dark');

    const btn = $('themeToggle');
    const dark = settings.theme === 'dark';
    btn.textContent = dark ? '☾ Dark mode' : '☀ Light mode';
    btn.setAttribute('aria-pressed', String(dark));
    btn.title = 'Switch to ' + (dark ? 'light' : 'dark') + ' mode (only changes the website background)';
    render();
  }

  // ---------- DOM refs ----------

  function $(id) { return document.getElementById(id); }

  const boardCanvas = $('board');
  const holdCanvas = $('holdCanvas');
  const nextCanvas = $('nextCanvas');
  const bctx = boardCanvas.getContext('2d');
  const hctx = holdCanvas.getContext('2d');
  const nctx = nextCanvas.getContext('2d');
  const overlay = $('overlay');
  const dialog = $('settingsDialog');

  let settings = loadSettings();
  let best = loadBest();
  let state = 'title'; // title | playing | paused | over
  let cell = 30;
  let previewCell = 20;
  let actionTimer = null;

  const game = new E.Game(onGameEvent);

  // ---------- Sizing ----------

  function setupCanvas(canvas, ctx, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    const header = document.querySelector('.topbar').offsetHeight;
    const narrow = window.innerWidth <= 700;
    const byHeight = (window.innerHeight - header - 48) / E.VISIBLE_ROWS;
    const byWidth = narrow ? (window.innerWidth - 40) / E.COLS : (window.innerWidth - 120) / (E.COLS + 10);
    cell = Math.max(14, Math.min(40, Math.floor(Math.min(byHeight, byWidth))));
    document.documentElement.style.setProperty('--cell', cell + 'px');

    setupCanvas(boardCanvas, bctx, cell * E.COLS, cell * E.VISIBLE_ROWS);

    const pw = holdCanvas.parentElement.clientWidth - 20;
    previewCell = Math.max(8, Math.min(Math.floor(pw / 5), Math.round(cell * 0.8)));
    const previewW = Math.max(previewCell * 5, pw);
    setupCanvas(holdCanvas, hctx, previewW, previewCell * 3);
    const count = Math.max(1, settings.nextCount);
    setupCanvas(nextCanvas, nctx, previewW, previewCell * 3 * count);
    nextCanvas.parentElement.hidden = settings.nextCount === 0;
    render();
  }

  // ---------- Rendering ----------

  function drawCell(ctx, x, y, size, color) {
    const inset = size >= 20 ? 1 : 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  }

  function drawGhostCell(ctx, x, y, size, color) {
    const lw = Math.max(1.5, size * 0.08);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(x + 1 + lw / 2, y + 1 + lw / 2, size - 2 - lw, size - 2 - lw);
  }

  function render() {
    renderBoard();
    renderPreviews();
    renderStats();
  }

  function renderBoard() {
    const w = cell * E.COLS, h = cell * E.VISIBLE_ROWS;
    const ctx = bctx;
    ctx.fillStyle = settings.gameBg;
    ctx.fillRect(0, 0, w, h);

    if (settings.grid) {
      ctx.strokeStyle = isLight(settings.gameBg) ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < E.COLS; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, h); }
      for (let y = 1; y < E.VISIBLE_ROWS; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(w, y * cell + 0.5); }
      ctx.stroke();
    }

    // The field is hidden while paused, as in standard play.
    if (state === 'paused' || state === 'title') return;

    const top = E.BUFFER_ROWS;
    const locked = lockedColor();
    for (let y = top; y < E.ROWS; y++) {
      const row = game.board[y];
      for (let x = 0; x < E.COLS; x++) {
        if (row[x]) drawCell(ctx, x * cell, (y - top) * cell, cell, locked);
      }
    }

    const p = game.active;
    if (p) {
      const cells = E.ROTATIONS[p.type][p.rot];
      if (settings.ghost) {
        const gy = game.ghostY();
        if (gy !== p.y) {
          for (const [cx, cy] of cells) {
            const y = gy + cy - top;
            if (y >= 0) drawGhostCell(ctx, (p.x + cx) * cell, y * cell, cell, fallingColor());
          }
        }
      }
      for (const [cx, cy] of cells) {
        const y = p.y + cy - top;
        if (y >= 0) drawCell(ctx, (p.x + cx) * cell, y * cell, cell, fallingColor());
      }
    }
  }

  function drawPreviewPiece(ctx, type, centerX, centerY, size, color) {
    const cells = E.ROTATIONS[type][0];
    let minX = 9, maxX = -1, minY = 9, maxY = -1;
    for (const [x, y] of cells) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pw = (maxX - minX + 1) * size;
    const ph = (maxY - minY + 1) * size;
    const ox = Math.round(centerX - pw / 2);
    const oy = Math.round(centerY - ph / 2);
    for (const [x, y] of cells) drawCell(ctx, ox + (x - minX) * size, oy + (y - minY) * size, size, color);
  }

  function clearPreview(ctx, canvas) {
    const w = parseFloat(canvas.style.width), h = parseFloat(canvas.style.height);
    ctx.fillStyle = settings.gameBg;
    ctx.fillRect(0, 0, w, h);
    return [w, h];
  }

  function renderPreviews() {
    const showPieces = state === 'playing' || state === 'over';
    const [hw, hh] = clearPreview(hctx, holdCanvas);
    if (showPieces && game.hold) {
      hctx.globalAlpha = game.holdUsed ? 0.35 : 1;
      drawPreviewPiece(hctx, game.hold, hw / 2, hh / 2, previewCell, fallingColor());
      hctx.globalAlpha = 1;
    }

    const [nw] = clearPreview(nctx, nextCanvas);
    if (showPieces) {
      const n = Math.min(settings.nextCount, game.queue.length);
      for (let i = 0; i < n; i++) {
        drawPreviewPiece(nctx, game.queue[i], nw / 2, previewCell * 3 * i + previewCell * 1.5, previewCell, fallingColor());
      }
    }
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  const statEls = {
    score: $('statScore'), best: $('statBest'), level: $('statLevel'),
    lines: $('statLines'), time: $('statTime'),
  };
  function renderStats() {
    statEls.score.textContent = game.score.toLocaleString();
    statEls.best.textContent = Math.max(best, game.score).toLocaleString();
    statEls.level.textContent = game.level;
    statEls.lines.textContent = game.lines;
    statEls.time.textContent = formatTime(game.elapsed);
  }

  // ---------- Game state & overlay ----------

  function showOverlay(title, text, primaryLabel, showRestart) {
    $('overlayTitle').textContent = title;
    $('overlayText').innerHTML = text;
    $('overlayPrimary').textContent = primaryLabel;
    $('overlaySecondary').hidden = !showRestart;
    overlay.hidden = false;
  }

  function keyLabelFor(action) {
    const k = settings.keys[action].filter(Boolean);
    return k.length ? '<kbd>' + escapeHtml(keyName(k[0])) + '</kbd>' : '(unbound)';
  }

  function startGame() {
    game.reset(settings.startLevel);
    state = 'playing';
    overlay.hidden = true;
    blurFocus();
    resetInput();
    render();
  }

  // Keep focus off buttons during play so Space/Enter never "click" them.
  function blurFocus() {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    resetInput();
    showOverlay('Paused', 'Press ' + keyLabelFor('pause') + ' or click Resume.', 'Resume', true);
    render();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    overlay.hidden = true;
    blurFocus();
    resetInput();
    lastFrame = performance.now();
    render();
  }

  function onGameEvent(ev) {
    if (ev.type === 'gameover') {
      state = 'over';
      if (game.score > best) { best = game.score; saveBest(best); }
      showOverlay('Game over', 'Score: <strong>' + game.score.toLocaleString() + '</strong><br>Press ' +
        keyLabelFor('restart') + ' or Enter to play again.', 'Play again', false);
    } else if (ev.type === 'clear') {
      const parts = [];
      if (ev.b2b) parts.push('Back-to-Back');
      if (ev.label) parts.push(ev.label);
      if (ev.combo > 0) parts.push('Combo ×' + ev.combo);
      if (ev.perfect) parts.push('Perfect Clear!');
      if (ev.leveledUp) parts.push('Level ' + ev.level);
      if (parts.length) showActionText(parts.join('\n'));
    }
  }

  function showActionText(text) {
    const el = $('actionText');
    el.textContent = text;
    el.style.color = isLight(settings.gameBg) ? '#111' : '#eee';
    el.classList.add('show');
    clearTimeout(actionTimer);
    actionTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  // ---------- Input ----------

  let codeToAction = new Map();
  const held = { left: false, right: false };
  let dasDir = 0;     // -1, 0, 1 : direction currently auto-repeating
  let dasTimer = 0;
  let arrTimer = 0;

  function rebuildKeyMap() {
    codeToAction = new Map();
    for (const [action] of ACTIONS) {
      for (const code of settings.keys[action]) if (code) codeToAction.set(code, action);
    }
    renderKeysHelp();
  }

  function resetInput() {
    held.left = held.right = false;
    dasDir = 0;
    dasTimer = arrTimer = 0;
    game.softDropping = false;
  }

  function startShift(dir) {
    dasDir = dir;
    dasTimer = 0;
    arrTimer = 0;
    game.move(dir);
  }

  function onKeyDown(e) {
    if (capturing) return; // handled by the capture listener
    if (dialog.open) return;
    const action = codeToAction.get(e.code);

    if (!action) {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
        if (state === 'title' || state === 'over') { e.preventDefault(); startGame(); }
        else if (state === 'paused') { e.preventDefault(); resumeGame(); }
      }
      return;
    }
    e.preventDefault();
    if (e.repeat) return;

    if (action === 'pause') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      return;
    }
    if (action === 'restart') {
      if (state !== 'title') startGame();
      return;
    }
    if (state !== 'playing') return;

    switch (action) {
      case 'moveLeft': held.left = true; startShift(-1); break;
      case 'moveRight': held.right = true; startShift(1); break;
      case 'softDrop': game.softDropping = true; break;
      case 'hardDrop': game.hardDrop(); break;
      case 'rotateCW': game.rotate(1); break;
      case 'rotateCCW': game.rotate(-1); break;
      case 'rotate180': game.rotate(2); break;
      case 'hold': game.holdPiece(); break;
    }
    render();
  }

  function onKeyUp(e) {
    const action = codeToAction.get(e.code);
    if (!action) return;
    if (action === 'moveLeft') {
      held.left = false;
      if (dasDir === -1) { dasDir = held.right ? 1 : 0; dasTimer = arrTimer = 0; }
    } else if (action === 'moveRight') {
      held.right = false;
      if (dasDir === 1) { dasDir = held.left ? -1 : 0; dasTimer = arrTimer = 0; }
    } else if (action === 'softDrop') {
      game.softDropping = false;
    }
  }

  function updateAutoShift(dt) {
    if (!dasDir) return;
    dasTimer += dt;
    if (dasTimer < settings.das) return;
    if (settings.arr <= 0) {
      while (game.move(dasDir)) { /* slide to the wall */ }
      return;
    }
    arrTimer += dt;
    while (arrTimer >= settings.arr) {
      arrTimer -= settings.arr;
      if (!game.move(dasDir)) { arrTimer = 0; break; }
    }
  }

  // ---------- Main loop ----------

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(now - lastFrame, 100);
    lastFrame = now;
    if (state === 'playing') {
      updateAutoShift(dt);
      if (state === 'playing') {
        const sdf = settings.sdf >= 41 ? Infinity : settings.sdf;
        game.update(dt, sdf);
      }
      render();
    }
    requestAnimationFrame(frame);
  }

  // ---------- Key names ----------

  const KEY_NAMES = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt', AltRight: 'Right Alt',
    MetaLeft: 'Left Meta', MetaRight: 'Right Meta',
    CapsLock: 'Caps Lock', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/',
    NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
    NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  };
  function keyName(code) {
    if (!code) return '';
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    let m;
    if ((m = code.match(/^Key([A-Z])$/))) return m[1];
    if ((m = code.match(/^Digit(\d)$/))) return m[1];
    if ((m = code.match(/^Numpad(\d)$/))) return 'Num ' + m[1];
    return code;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderKeysHelp() {
    const ul = $('keysHelp');
    ul.innerHTML = '';
    for (const [action, label] of ACTIONS) {
      const keys = settings.keys[action].filter(Boolean).map(keyName);
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = label.replace('counter-clockwise', 'CCW').replace('clockwise', 'CW');
      const b = document.createElement('span');
      b.textContent = keys.length ? keys.join(' / ') : '—';
      li.append(a, b);
      ul.append(li);
    }
  }

  // ---------- Settings dialog ----------

  let capturing = null; // { action, slot, button }

  function openSettings() {
    if (state === 'playing') pauseGame();
    syncSettingsForm();
    dialog.showModal();
  }

  function syncSettingsForm() {
    for (const row of document.querySelectorAll('.color-row')) {
      const key = row.dataset.key;
      const value = settings[key];
      row.querySelector('input[type="color"]').value = value;
      const hex = row.querySelector('.hex');
      hex.value = value;
      hex.classList.remove('invalid');
    }
    $('linkColors').checked = settings.linkColors;
    setLockedRowDisabled();
    for (const id of ['startLevel', 'das', 'arr', 'sdf', 'nextCount']) $(id).value = settings[id];
    $('ghost').checked = settings.ghost;
    $('grid').checked = settings.grid;
    renderBindings();
  }

  function setLockedRowDisabled() {
    const row = document.querySelector('.color-row[data-key="lockedColor"]');
    for (const input of row.querySelectorAll('input')) input.disabled = settings.linkColors;
    row.style.opacity = settings.linkColors ? 0.5 : 1;
  }

  function setColor(key, value) {
    settings[key] = value;
    saveSettings();
    applyColors();
  }

  function wireColorRows() {
    for (const row of document.querySelectorAll('.color-row')) {
      const key = row.dataset.key;
      const picker = row.querySelector('input[type="color"]');
      const hex = row.querySelector('.hex');
      picker.addEventListener('input', () => {
        hex.value = picker.value;
        hex.classList.remove('invalid');
        setColor(key, picker.value);
      });
      hex.addEventListener('input', () => {
        const v = normalizeHex(hex.value);
        hex.classList.toggle('invalid', !v);
        if (v) { picker.value = v; setColor(key, v); }
      });
      hex.addEventListener('blur', () => {
        hex.value = settings[key];
        hex.classList.remove('invalid');
      });
    }

    $('linkColors').addEventListener('change', e => {
      settings.linkColors = e.target.checked;
      setLockedRowDisabled();
      saveSettings();
      render();
    });

    for (const btn of document.querySelectorAll('[data-preset]')) {
      btn.addEventListener('click', () => {
        const [f, l] = btn.dataset.preset.split(',');
        settings.fallingColor = f;
        settings.lockedColor = l;
        settings.linkColors = false;
        saveSettings();
        syncSettingsForm();
        applyColors();
      });
    }

    $('swapColors').addEventListener('click', () => {
      const f = settings.fallingColor;
      settings.fallingColor = settings.lockedColor;
      settings.lockedColor = f;
      saveSettings();
      syncSettingsForm();
      applyColors();
    });

    $('resetColors').addEventListener('click', () => {
      Object.assign(settings, DEFAULT_COLORS, { linkColors: false });
      saveSettings();
      syncSettingsForm();
      applyColors();
    });
  }

  function wireGameplayInputs() {
    const ranges = { startLevel: [1, 20], das: [0, 500], arr: [0, 200], sdf: [1, 41], nextCount: [0, 6] };
    for (const [id, [min, max]] of Object.entries(ranges)) {
      $(id).addEventListener('change', e => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v)) v = DEFAULTS[id];
        v = Math.max(min, Math.min(max, v));
        e.target.value = v;
        settings[id] = v;
        saveSettings();
        if (id === 'nextCount') resize();
      });
    }
    for (const id of ['ghost', 'grid']) {
      $(id).addEventListener('change', e => {
        settings[id] = e.target.checked;
        saveSettings();
        render();
      });
    }
  }

  function renderBindings() {
    const body = $('bindingsBody');
    body.innerHTML = '';
    for (const [action, label] of ACTIONS) {
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      th.textContent = label;
      tr.append(th);
      for (let slot = 0; slot < 2; slot++) {
        const td = document.createElement('td');
        const wrap = document.createElement('div');
        wrap.className = 'slot-wrap';
        const code = settings.keys[action][slot];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'key-slot' + (code ? '' : ' empty');
        btn.textContent = code ? keyName(code) : 'none';
        btn.setAttribute('aria-label', label + (slot ? ' alternate key' : ' key') + ': ' + (code ? keyName(code) : 'none'));
        btn.addEventListener('click', () => {
          if (capturing && capturing.button === btn) { stopCapture(); return; }
          stopCapture();
          capturing = { action, slot, button: btn };
          btn.classList.add('capturing');
          btn.classList.remove('empty');
          btn.textContent = 'press a key…';
        });
        const clr = document.createElement('button');
        clr.type = 'button';
        clr.className = 'slot-clear';
        clr.textContent = '×';
        clr.title = 'Clear';
        clr.setAttribute('aria-label', 'Clear ' + label + (slot ? ' alternate key' : ' key'));
        clr.addEventListener('click', () => {
          stopCapture();
          settings.keys[action][slot] = null;
          saveSettings();
          rebuildKeyMap();
          renderBindings();
        });
        wrap.append(btn, clr);
        td.append(wrap);
        tr.append(td);
      }
      body.append(tr);
    }
  }

  function stopCapture() {
    if (!capturing) return;
    capturing = null;
    renderBindings();
  }

  function onCaptureKey(e) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, slot } = capturing;
    const code = e.code;
    if (!code) return;
    // A key can only belong to one action/slot.
    let movedFrom = null;
    for (const [a, label] of ACTIONS) {
      for (let s = 0; s < 2; s++) {
        if (settings.keys[a][s] === code && !(a === action && s === slot)) {
          settings.keys[a][s] = null;
          movedFrom = label;
        }
      }
    }
    settings.keys[action][slot] = code;
    capturing = null;
    saveSettings();
    rebuildKeyMap();
    renderBindings();
    if (movedFrom) toast(keyName(code) + ' was removed from "' + movedFrom + '".');
  }

  function resetKeys() {
    stopCapture();
    settings.keys = clone(DEFAULT_KEYS);
    saveSettings();
    rebuildKeyMap();
    renderBindings();
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      dialog.append(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
  }

  function wireTabs() {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        stopCapture();
        for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
        for (const p of document.querySelectorAll('.tab-panel')) p.hidden = p.dataset.panel !== tab.dataset.tab;
      });
    }
  }

  // ---------- Wiring ----------

  function init() {
    wireColorRows();
    wireGameplayInputs();
    wireTabs();

    $('settingsBtn').addEventListener('click', openSettings);
    $('themeToggle').addEventListener('click', () => {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      saveSettings();
      applyColors();
    });
    $('resetKeys').addEventListener('click', resetKeys);

    $('overlayPrimary').addEventListener('click', () => {
      if (state === 'paused') resumeGame();
      else if (state === 'title' || state === 'over') startGame();
    });
    $('overlaySecondary').addEventListener('click', () => {
      if (state !== 'playing') startGame();
    });

    dialog.addEventListener('cancel', e => {
      // Escape while waiting for a key binds Escape instead of closing the dialog.
      if (capturing) e.preventDefault();
    });
    dialog.addEventListener('close', () => {
      stopCapture();
      $('overlayPrimary').focus();
    });

    window.addEventListener('keydown', onCaptureKey, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { resetInput(); pauseGame(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
    window.addEventListener('resize', resize);

    rebuildKeyMap();
    $('statBest').textContent = best.toLocaleString();
    applyColors();
    resize();
    showOverlay('Dichoptic Drop', 'Press <kbd>Enter</kbd> or click Start to play.', 'Start', false);
    requestAnimationFrame(frame);
  }

  init();
})();
