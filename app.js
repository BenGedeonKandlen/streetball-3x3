'use strict';
/* Streetball 3x3 – Anschreibe-App (Punkte, Spieluhr, Shotclock, Teamfouls). */
(() => {
  const STORE_KEY = 'sb3x3.games.v1';
  const PREF_KEY = 'sb3x3.prefs.v1';
  const COLORS = ['#f26b1d', '#2f7bff', '#e63946', '#2ec27e', '#f5c211', '#a06cf0', '#ffffff', '#ff4fa3'];
  const PRESETS = {
    fiba: { clockEnabled: true, clockMinutes: 10, pointLimit: 21, shotEnabled: true, shotSeconds: 12, checkUp: false },
    hobby: { clockEnabled: false, clockMinutes: 10, pointLimit: 21, shotEnabled: false, shotSeconds: 12, checkUp: false },
  };
  const PRESET_LABEL = { fiba: 'FIBA 3x3', hobby: 'Hobby', custom: 'Eigene' };

  const app = document.getElementById('app');

  /* ---------- Hilfsfunktionen ---------- */
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  const btn = (label, onclick, cls = '') => el('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => Date.now();
  const clampInt = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  function onColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#111111' : '#ffffff';
  }
  const fmtDate = (ts) => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  function fmtGame(ms) {
    if (ms >= 60000) {
      const s = Math.ceil(ms / 1000);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    return (Math.floor(ms / 100) / 10).toFixed(1);
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- Speicher ---------- */
  function loadJSON(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; }
  }
  let games = loadJSON(STORE_KEY, []);
  if (!Array.isArray(games)) games = [];
  const prefs = Object.assign({ sound: true }, loadJSON(PREF_KEY, {}));
  function saveGames() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(games)); }
    catch { toast('Speichern fehlgeschlagen'); }
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* egal */ } }
  const getGame = (id) => games.find((g) => g.id === id);
  function touch(g) { g.updatedAt = now(); saveGames(); }

  /* ---------- Ton ---------- */
  let actx = null;
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  function buzz() {
    if (navigator.vibrate) navigator.vibrate(400);
    if (!prefs.sound || !actx) return;
    const t = actx.currentTime;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    gain.gain.setValueAtTime(0.5, t + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    gain.connect(actx.destination);
    for (const [type, freq] of [['sawtooth', 196], ['square', 294]]) {
      const o = actx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(gain);
      o.start(t);
      o.stop(t + 1.15);
    }
  }

  /* ---------- Bildschirm anlassen ---------- */
  let wake = null;
  async function requestWake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch { wake = null; }
  }
  function releaseWake() { try { wake && wake.release(); } catch { /* egal */ } wake = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current) requestWake();
  });

  /* ---------- Dialoge ---------- */
  function ask({ title, text, body, buttons, wide }) {
    return new Promise((resolve) => {
      const d = el('dialog', { class: wide ? 'wide' : '' });
      let done = false;
      const finishWith = (v) => {
        if (done) return;
        done = true;
        if (d.open) d.close();
        d.remove();
        resolve(v);
      };
      const form = el('form', { class: 'dlg-inner', onsubmit: (e) => { e.preventDefault(); finishWith(buttons[buttons.length - 1].value); } },
        el('h2', { text: title }),
        text ? el('p', { text }) : null,
        body || null,
        el('div', { class: 'dlg-btns' },
          buttons.map((b) => el('button', { class: 'btn ' + (b.kind || ''), type: 'button', onclick: () => finishWith(b.value) }, b.label))));
      d.append(form);
      document.body.append(d);
      d.addEventListener('cancel', (e) => { e.preventDefault(); finishWith(null); });
      d.addEventListener('close', () => finishWith(null));
      d.showModal();
    });
  }
  async function confirmDlg(title, text, okLabel = 'OK', kind = 'primary') {
    return (await ask({ title, text, buttons: [{ label: 'Abbrechen', value: 'no' }, { label: okLabel, value: 'yes', kind }] })) === 'yes';
  }

  /* ---------- Spiellogik ---------- */
  function totals(g) {
    const s = [0, 0], f = [0, 0];
    for (const e of g.events) {
      if (e.type === 'pts' || e.type === 'adjPts') s[e.team] += e.value;
      else if (e.type === 'foul' || e.type === 'adjFoul') f[e.team] += e.value;
    }
    return { s: s.map((x) => Math.max(0, x)), f: f.map((x) => Math.max(0, x)) };
  }
  const teamName = (g, i) => g.teams[i].name;

  function times(g) {
    const c = g.clock;
    if (!c.running) return { game: c.gameMs, shot: c.shotMs };
    const d = now() - c.anchor;
    return { game: Math.max(0, c.gameMs - d), shot: Math.max(0, c.shotMs - d) };
  }
  function freeze(g) {
    const t = times(g);
    g.clock.gameMs = t.game;
    g.clock.shotMs = t.shot;
    if (g.clock.running) g.clock.anchor = now();
  }
  function stopClock(g) {
    if (!g.clock.running) return;
    freeze(g);
    g.clock.running = false;
    g.clock.anchor = null;
  }
  const shotActive = (g) => g.settings.shotEnabled && !g.clock.shotOff;
  const gameClockActive = (g) => g.settings.clockEnabled && !g.tieBreak;
  function canRun(g) {
    if (g.status !== 'running') return false;
    if (gameClockActive(g)) return g.clock.gameMs > 0;
    return shotActive(g);
  }
  function startClock(g) {
    if (g.status !== 'running') return;
    if (gameClockActive(g) && g.clock.gameMs <= 0) { toast('Die Spielzeit ist abgelaufen'); return; }
    if (shotActive(g) && g.clock.shotMs <= 0) resetShot(g);
    if (!canRun(g)) return;
    g.awaitCheck = false;
    g.clock.running = true;
    g.clock.anchor = now();
  }
  function resetShot(g) {
    const s = g.settings;
    if (!s.shotEnabled) return;
    freeze(g);
    const full = s.shotSeconds * 1000;
    // FIBA: Shotclock aus, wenn weniger Spielzeit als Shotclock-Zeit übrig ist.
    if (gameClockActive(g) && g.clock.gameMs < full) {
      g.clock.shotOff = true;
      if (g.clock.running && !canRun(g)) stopClock(g);
    } else {
      g.clock.shotOff = false;
      g.clock.shotMs = full;
    }
  }

  function describe(g, e) {
    const sign = (v) => (v > 0 ? '+' : '') + v;
    switch (e.type) {
      case 'pts': return `+${e.value} ${e.value === 1 ? 'Punkt' : 'Punkte'}`;
      case 'foul': return 'Foul';
      case 'adjPts': return `Korrektur Punkte ${sign(e.value)}`;
      case 'adjFoul': return `Korrektur Fouls ${sign(e.value)}`;
      default: return e.type;
    }
  }
  function pushEvent(g, type, team, value) {
    g.events.push({
      id: uid(), type, team, value, at: now(),
      gt: g.settings.clockEnabled ? times(g).game : null,
    });
  }

  async function addPoints(g, team, v) {
    if (g.status !== 'running') return;
    pushEvent(g, 'pts', team, v);
    // Check-Ball nach Korb: Uhren anhalten, weiter erst mit „Weiterspielen“.
    if (g.settings.checkUp && g.clock.running) {
      stopClock(g);
      g.awaitCheck = true;
    }
    resetShot(g);
    touch(g);
    render();
    await checkScoreEnd(g, team);
  }
  function addFoul(g, team) {
    if (g.status !== 'running') return;
    pushEvent(g, 'foul', team, 1);
    stopClock(g);
    resetShot(g);
    touch(g);
    render();
  }

  async function checkScoreEnd(g, scorer) {
    if (g.status !== 'running') return;
    const { s } = totals(g);
    if (s[0] === s[1]) return;
    const w = s[0] > s[1] ? 0 : 1;
    if (g.tieBreak) {
      stopClock(g); touch(g); render();
      if (await confirmDlg('Entscheidender Punkt', `${teamName(g, w)} gewinnt ${s[0]}:${s[1]}. Spiel beenden?`, 'Spiel beenden')) finish(g);
      return;
    }
    const lim = g.settings.pointLimit;
    // Nur fragen, wenn das Team, das gerade gepunktet hat, führt und das Limit erreicht hat.
    if (lim > 0 && s[w] >= lim && (scorer == null || scorer === w)) {
      const key = s.join(':');
      if (g.limitPrompted === key) return;
      g.limitPrompted = key;
      stopClock(g); touch(g); render();
      if (await confirmDlg(`${lim} Punkte erreicht`, `${teamName(g, w)} führt ${s[0]}:${s[1]}. Spiel beenden?`, 'Spiel beenden')) finish(g);
    }
  }

  async function onTimeUp(g) {
    const { s } = totals(g);
    if (s[0] !== s[1]) {
      const w = s[0] > s[1] ? 0 : 1;
      if (await confirmDlg('Spielzeit abgelaufen', `${teamName(g, w)} führt ${s[0]}:${s[1]}. Spiel beenden?`, 'Spiel beenden')) finish(g);
      return;
    }
    const v = await ask({
      title: 'Gleichstand bei 0:00',
      text: `Stand ${s[0]}:${s[1]}. Wie geht es weiter?`,
      buttons: [{ label: 'Unentschieden', value: 'draw' }, { label: 'Nächster Punkt entscheidet', value: 'tb', kind: 'primary' }],
    });
    if (v === 'draw') finish(g);
    else if (v === 'tb') {
      g.tieBreak = true;
      g.clock.shotOff = false;
      g.clock.shotMs = g.settings.shotSeconds * 1000;
      touch(g);
      render();
    }
  }

  function finish(g) {
    stopClock(g);
    const { s } = totals(g);
    g.status = 'finished';
    g.tieBreak = false;
    g.result = { winner: s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : null, score: s, endedAt: now() };
    touch(g);
    render();
  }
  async function endManually(g) {
    const { s } = totals(g);
    const txt = s[0] === s[1] ? `Stand ${s[0]}:${s[1]}, das Spiel endet unentschieden.` : `${teamName(g, s[0] > s[1] ? 0 : 1)} gewinnt ${s[0]}:${s[1]}.`;
    if (await confirmDlg('Spiel jetzt beenden?', txt, 'Spiel beenden', 'danger')) finish(g);
  }
  function resume(g) {
    g.status = 'running';
    g.result = null;
    touch(g);
    render();
  }

  function undo(g) {
    const e = g.events.pop();
    if (!e) { toast('Nichts zum Rückgängigmachen'); return; }
    touch(g);
    render();
    toast(`Rückgängig: ${teamName(g, e.team)} ${describe(g, e)}`);
  }

  async function openHistory(g) {
    const list = el('ul', { class: 'history' });
    const fill = () => {
      list.replaceChildren();
      if (!g.events.length) { list.append(el('p', { class: 'empty', text: 'Noch keine Einträge.' })); return; }
      for (const e of [...g.events].reverse()) {
        const t = e.gt != null ? fmtGame(e.gt) : new Date(e.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        list.append(el('li', {},
          el('span', { class: 't', text: t }),
          el('span', { class: 'd' }, el('span', { class: 'dot', style: `--c:${g.teams[e.team].color}` }), `${teamName(g, e.team)}: ${describe(g, e)}`),
          el('button', {
            class: 'x', type: 'button', 'aria-label': 'Eintrag löschen',
            onclick: async () => {
              if (!(await confirmDlg('Eintrag löschen?', `${teamName(g, e.team)}: ${describe(g, e)} (${t})`, 'Löschen', 'danger'))) return;
              g.events = g.events.filter((x) => x.id !== e.id);
              touch(g); render(); fill();
            },
          }, '✕')));
      }
    };
    fill();
    await ask({ title: 'Spielverlauf', body: list, wide: true, buttons: [{ label: 'Schließen', value: 'close' }] });
  }

  async function openEdit(g) {
    stopClock(g);
    touch(g);
    render();
    const { s, f } = totals(g);
    const num = (v, min, max) => el('input', { class: 'num-input', type: 'number', inputmode: 'numeric', min: String(min), max: String(max), value: String(v) });
    const sc = [num(s[0], 0, 999), num(s[1], 0, 999)];
    const fo = [num(f[0], 0, 99), num(f[1], 0, 99)];
    const grid = el('div', { class: 'edit-grid' },
      el('span'), el('span', { class: 'h', text: teamName(g, 0) }), el('span', { class: 'h', text: teamName(g, 1) }),
      el('span', { class: 'label', text: 'Punkte' }), sc[0], sc[1],
      el('span', { class: 'label', text: 'Fouls' }), fo[0], fo[1]);
    const body = el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, grid);
    let mm, ss, sh;
    if (g.settings.clockEnabled) {
      const ms = Math.ceil(g.clock.gameMs / 1000);
      mm = num(Math.floor(ms / 60), 0, 99);
      ss = num(ms % 60, 0, 59);
      body.append(el('div', { class: 'row' }, el('span', { class: 'label', text: 'Spielzeit' }),
        el('div', { class: 'edit-time' }, mm, ':', ss)));
    }
    if (g.settings.shotEnabled) {
      sh = num(Math.ceil(g.clock.shotMs / 1000), 0, 99);
      body.append(el('div', { class: 'row' }, el('span', { class: 'label', text: 'Shotclock' }), sh, el('span', { class: 'unit', text: 's' })));
    }
    const v = await ask({ title: 'Stand bearbeiten', body, buttons: [{ label: 'Abbrechen', value: 'no' }, { label: 'Übernehmen', value: 'save', kind: 'primary' }] });
    if (v !== 'save') return;
    for (const i of [0, 1]) {
      const dp = clampInt(sc[i].value, 0, 999, s[i]) - s[i];
      if (dp) pushEvent(g, 'adjPts', i, dp);
      const df = clampInt(fo[i].value, 0, 99, f[i]) - f[i];
      if (df) pushEvent(g, 'adjFoul', i, df);
    }
    if (mm) {
      const newMs = (clampInt(mm.value, 0, 99, 0) * 60 + clampInt(ss.value, 0, 59, 0)) * 1000;
      if (newMs !== Math.ceil(g.clock.gameMs / 1000) * 1000) g.clock.gameMs = newMs;
    }
    if (sh) {
      const newShot = clampInt(sh.value, 0, 99, 0) * 1000;
      if (newShot !== Math.ceil(g.clock.shotMs / 1000) * 1000) { g.clock.shotMs = newShot; g.clock.shotOff = false; }
    }
    if (g.tieBreak && g.settings.clockEnabled && g.clock.gameMs > 0) g.tieBreak = false;
    g.limitPrompted = null;
    touch(g);
    render();
  }

  /* ---------- Einstellungen, Export, Import ---------- */
  async function openSettings() {
    const sound = el('input', { class: 'switch', type: 'checkbox', checked: !!prefs.sound, onchange: (e) => { prefs.sound = e.target.checked; savePrefs(); if (prefs.sound) { unlockAudio(); buzz(); } } });
    const file = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: (e) => importGames(e.target.files[0]) });
    const body = el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      el('label', { class: 'row' }, el('span', { class: 'label' }, 'Buzzer-Ton', el('span', { class: 'hint', text: 'Bei Ablauf von Shotclock und Spielzeit. Der Stummschalter am iPhone kann ihn unterdrücken.' })), sound),
      el('div', { class: 'section-title', text: 'Daten' }),
      el('p', { text: 'Spiele werden nur auf diesem Gerät gespeichert. Mit Export und Import kannst du sie sichern oder auf ein anderes Gerät übertragen.' }),
      btn('Spiele exportieren', exportGames, 'ghost'),
      btn('Spiele importieren', () => file.click(), 'ghost'),
      file);
    await ask({ title: 'Einstellungen', body, buttons: [{ label: 'Fertig', value: 'ok', kind: 'primary' }] });
  }

  async function exportGames() {
    const data = JSON.stringify({ app: 'streetball-3x3', version: 1, exportedAt: new Date().toISOString(), games }, null, 2);
    const name = `streetball-3x3-${new Date().toISOString().slice(0, 10)}.json`;
    const fileObj = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
      try { await navigator.share({ files: [fileObj], title: 'Streetball 3x3 – Spiele' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(fileObj);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function importGames(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.games;
      if (!Array.isArray(list)) throw new Error('format');
      let added = 0, updated = 0;
      for (const g of list) {
        if (!g || !g.id || !Array.isArray(g.teams) || !Array.isArray(g.events) || !g.settings || !g.clock) continue;
        g.clock.running = false;
        g.clock.anchor = null;
        const existing = getGame(g.id);
        if (!existing) { games.push(g); added++; }
        else if ((g.updatedAt || 0) > (existing.updatedAt || 0)) { games[games.indexOf(existing)] = g; updated++; }
      }
      saveGames();
      toast(`${added} neu, ${updated} aktualisiert`);
      if (!current) renderHome();
    } catch {
      toast('Die Datei konnte nicht gelesen werden');
    }
  }

  /* ---------- Ansicht: Hauptmenü ---------- */
  function renderHome() {
    const list = games.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const card = (g) => {
      const { s } = totals(g);
      const live = g.status === 'running';
      return el('li', { class: 'game-item' },
        el('button', { class: 'card', type: 'button', onclick: () => { location.hash = '#/spiel/' + g.id; } },
          el('span', { class: 'meta' }, fmtDate(g.createdAt), el('span', { class: 'chip' + (live ? ' live' : ''), text: live ? 'läuft' : 'beendet' }), el('span', { text: PRESET_LABEL[g.preset] || '' })),
          el('span', { class: 'teams' },
            el('span', { class: 'dot', style: `--c:${g.teams[0].color}` }), g.teams[0].name, ' – ',
            el('span', { class: 'dot', style: `--c:${g.teams[1].color}` }), g.teams[1].name),
          el('span', { class: 'result', text: `${s[0]}:${s[1]}` })),
        el('button', {
          class: 'del-btn', type: 'button', 'aria-label': 'Spiel löschen',
          onclick: async () => {
            if (!(await confirmDlg('Spiel löschen?', `${g.teams[0].name} – ${g.teams[1].name} (${s[0]}:${s[1]}) wird endgültig gelöscht.`, 'Löschen', 'danger'))) return;
            games = games.filter((x) => x.id !== g.id);
            saveGames();
            renderHome();
          },
        }, '🗑'));
    };
    app.className = '';
    app.replaceChildren(
      el('header', { class: 'topbar' },
        el('h1', { text: 'Streetball 3x3' }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Einstellungen', onclick: openSettings }, '⚙︎')),
      el('main', { class: 'home' },
        btn('+ Neues Spiel', () => { location.hash = '#/neu'; }, 'primary big'),
        list.length
          ? [el('div', { class: 'section-title', text: 'Spiele' }), el('ul', { class: 'game-list' }, list.map(card))]
          : el('p', { class: 'empty', text: 'Noch keine Spiele. Leg dein erstes Spiel an.' })));
  }

  /* ---------- Ansicht: Neues Spiel ---------- */
  function renderNew() {
    const cfg = { preset: 'fiba', ...PRESETS.fiba };
    const teams = [{ name: '', color: COLORS[0] }, { name: '', color: COLORS[1] }];

    const teamBox = (i) => {
      const swatches = el('div', { class: 'swatches' });
      const drawSw = () => swatches.replaceChildren(...COLORS.map((c) => el('button', {
        class: 'swatch' + (teams[i].color === c ? ' on' : ''), type: 'button', style: `--c:${c}`, 'aria-label': 'Farbe ' + c,
        onclick: () => { teams[i].color = c; drawSw(); },
      })));
      drawSw();
      return el('div', { class: 'box' },
        el('input', { class: 'text-input', type: 'text', maxlength: '24', placeholder: i ? 'Team B' : 'Team A', autocomplete: 'off', oninput: (e) => { teams[i].name = e.target.value; } }),
        swatches);
    };

    const seg = el('div', { class: 'segmented' });
    const inputs = {};
    const rows = {};
    const numIn = (key, min, max) => {
      inputs[key] = el('input', { class: 'num-input', type: 'number', inputmode: 'numeric', min: String(min), max: String(max), oninput: (e) => { cfg[key] = e.target.value; markCustom(); } });
      return inputs[key];
    };
    const sw = (key) => {
      inputs[key] = el('input', { class: 'switch', type: 'checkbox', onchange: (e) => { cfg[key] = e.target.checked; markCustom(); sync(); } });
      return inputs[key];
    };
    const markCustom = () => { cfg.preset = 'custom'; drawSeg(); };
    const drawSeg = () => seg.replaceChildren(...['fiba', 'hobby', 'custom'].map((p) => el('button', {
      type: 'button', class: cfg.preset === p ? 'on' : '',
      onclick: () => { if (p !== 'custom') Object.assign(cfg, PRESETS[p]); cfg.preset = p; drawSeg(); sync(); },
    }, PRESET_LABEL[p])));
    const sync = () => {
      inputs.clockEnabled.checked = !!cfg.clockEnabled;
      inputs.shotEnabled.checked = !!cfg.shotEnabled;
      inputs.clockMinutes.value = cfg.clockMinutes;
      inputs.pointLimit.value = cfg.pointLimit;
      inputs.shotSeconds.value = cfg.shotSeconds;
      inputs.checkUp.checked = !!cfg.checkUp;
      rows.clock.classList.toggle('off', !cfg.clockEnabled);
      rows.shot.classList.toggle('off', !cfg.shotEnabled);
    };

    rows.clock = el('div', { class: 'row' }, el('span', { class: 'label', text: 'Spieluhr' }), numIn('clockMinutes', 1, 60), el('span', { class: 'unit', text: 'min' }), sw('clockEnabled'));
    rows.limit = el('div', { class: 'row' }, el('span', { class: 'label' }, 'Punktelimit', el('span', { class: 'hint', text: '0 = ohne Limit' })), numIn('pointLimit', 0, 200), el('span', { class: 'unit', text: 'Pkt' }), el('span', { style: 'width:54px;flex:none' }));
    rows.shot = el('div', { class: 'row' }, el('span', { class: 'label', text: 'Shotclock' }), numIn('shotSeconds', 5, 60), el('span', { class: 'unit', text: 's' }), sw('shotEnabled'));
    rows.check = el('div', { class: 'row' }, el('span', { class: 'label' }, 'Check-Ball nach Korb', el('span', { class: 'hint', text: 'Nach Punkten stoppen die Uhren. Weiter geht es mit „Weiterspielen“.' })), sw('checkUp'));
    drawSeg();
    sync();

    const start = () => {
      const settings = {
        clockEnabled: !!cfg.clockEnabled,
        clockMinutes: clampInt(cfg.clockMinutes, 1, 60, 10),
        pointLimit: clampInt(cfg.pointLimit, 0, 200, 21),
        shotEnabled: !!cfg.shotEnabled,
        shotSeconds: clampInt(cfg.shotSeconds, 5, 60, 12),
        checkUp: !!cfg.checkUp,
      };
      const g = {
        id: uid(), createdAt: now(), updatedAt: now(), status: 'running', preset: cfg.preset,
        teams: teams.map((t, i) => ({ name: t.name.trim() || (i ? 'Team B' : 'Team A'), color: t.color })),
        settings, events: [], tieBreak: false, result: null, limitPrompted: null,
        clock: { gameMs: settings.clockMinutes * 60000, shotMs: settings.shotSeconds * 1000, shotOff: false, running: false, anchor: null },
      };
      games.push(g);
      saveGames();
      location.hash = '#/spiel/' + g.id;
    };

    app.className = '';
    app.replaceChildren(
      el('header', { class: 'topbar' },
        el('button', { class: 'icon-btn', type: 'button', onclick: () => { location.hash = ''; } }, '‹ Zurück'),
        el('h1', { text: 'Neues Spiel' })),
      el('main', { class: 'newgame' },
        el('div', { class: 'section-title', text: 'Teams' }),
        teamBox(0), teamBox(1),
        el('div', { class: 'section-title', text: 'Regeln' }),
        el('div', { class: 'box' }, seg, rows.clock, rows.limit, rows.shot, rows.check),
        btn('Spiel starten', start, 'primary big')));
  }

  /* ---------- Ansicht: Spiel ---------- */
  let current = null;
  let ui = null;
  let ticker = null;

  function renderGame(g) {
    current = g;
    const s = g.settings;
    ui = { score: [], fouls: [] };

    const team = (i) => {
      const t = g.teams[i];
      return el('section', { class: 'team ' + (i ? 'b' : 'a'), style: `--team:${t.color};--on-team:${onColor(t.color)}` },
        el('div', { class: 'team-name', text: t.name }),
        ui.score[i] = el('div', { class: 'score' }),
        el('div', { class: 'pts-btns' }, btn('+1', () => addPoints(g, i, 1)), btn('+2', () => addPoints(g, i, 2))),
        el('div', { class: 'foul-row' },
          el('div', { class: 'fouls' }, el('span', { class: 'lbl', text: 'Fouls' }), ui.fouls[i] = el('span', { class: 'foul-num' })),
          btn('Foul +1', () => addFoul(g, i), 'foul-btn')));
    };

    const nClocks = (s.clockEnabled ? 1 : 0) + (s.shotEnabled ? 1 : 0);
    const clocks = el('section', { class: 'clocks' + (nClocks === 1 ? ' one' : nClocks === 0 ? ' none' : '') });
    if (s.clockEnabled) clocks.append(el('div', { class: 'clock-box' }, el('span', { class: 'lbl', text: 'Spielzeit' }), ui.game = el('div', { class: 'game-clock' })));
    if (s.shotEnabled) clocks.append(el('div', { class: 'clock-box' }, el('span', { class: 'lbl', text: 'Shotclock' }), ui.shot = el('div', { class: 'shot-clock' })));
    if (nClocks) {
      ui.start = btn('Start', () => {
        if (g.clock.running) stopClock(g); else startClock(g);
        touch(g); render();
      }, 'start-btn');
      clocks.append(el('div', { class: 'clock-ctrl' + (s.shotEnabled ? '' : ' solo') }, ui.start,
        s.shotEnabled ? btn(String(s.shotSeconds), () => {
          resetShot(g); touch(g); render();
          if (g.clock.shotOff) toast(`Shotclock aus: weniger als ${s.shotSeconds} s Spielzeit`);
        }, 'reset-btn') : null));
    } else {
      clocks.append(el('div', { text: s.pointLimit > 0 ? `Ohne Uhr · Spiel bis ${s.pointLimit} Punkte` : 'Ohne Uhr und Punktelimit' }));
    }

    ui.banner = el('div', { class: 'banner' });
    ui.root = el('div', { class: 'game' },
      el('div', { class: 'game-top' },
        el('button', { class: 'icon-btn', type: 'button', onclick: () => { location.hash = ''; } }, '‹ Spiele'),
        el('div', { class: 'title', text: s.pointLimit > 0 ? `Spiel bis ${s.pointLimit}` : 'Ohne Punktelimit' }),
        el('span', { style: 'width:44px' })),
      ui.banner,
      team(0), clocks, team(1),
      el('div', { class: 'bar' },
        btn('Rückgängig', () => undo(g), 'act'),
        btn('Verlauf', () => openHistory(g)),
        btn('Bearbeiten', () => openEdit(g), 'act'),
        ui.endBtn = btn('Beenden', () => endManually(g), 'act')));

    app.className = 'in-game';
    app.replaceChildren(ui.root);
    render();
    ticker = setInterval(tick, 100);
    requestWake();
  }

  function render() {
    const g = current;
    if (!g || !ui) return;
    const { s, f } = totals(g);
    for (const i of [0, 1]) {
      ui.score[i].textContent = s[i];
      ui.fouls[i].textContent = f[i];
    }
    ui.root.classList.toggle('finished', g.status === 'finished');
    if (ui.start) {
      ui.start.textContent = g.clock.running ? 'Stopp' : g.awaitCheck && g.status === 'running' ? 'Weiterspielen' : 'Start';
      ui.start.classList.toggle('running', g.clock.running);
    }
    ui.banner.replaceChildren();
    if (g.status === 'finished') {
      const r = g.result || { winner: null, score: s };
      ui.banner.append(el('span', { text: r.winner == null ? `Beendet · Unentschieden ${r.score[0]}:${r.score[1]}` : `Beendet · ${teamName(g, r.winner)} gewinnt ${r.score[0]}:${r.score[1]}` }),
        btn('Wieder aufnehmen', () => resume(g)));
    } else if (g.tieBreak) {
      ui.banner.append(el('span', { text: 'Gleichstand · Der nächste Punkt entscheidet' }));
    }
    ui.banner.classList.toggle('show', ui.banner.childNodes.length > 0);
    renderClocks();
  }

  function renderClocks() {
    const g = current;
    const t = times(g);
    if (ui.game) {
      ui.game.textContent = g.tieBreak ? '–' : fmtGame(t.game);
      ui.game.classList.toggle('zero', !g.tieBreak && t.game <= 0);
    }
    if (ui.shot) {
      const off = g.clock.shotOff;
      ui.shot.textContent = off ? 'aus' : String(Math.ceil(t.shot / 1000));
      ui.shot.classList.toggle('off', off);
      ui.shot.classList.toggle('warn', !off && t.shot <= 5000);
    }
  }

  function tick() {
    const g = current;
    if (!g) return;
    const c = g.clock;
    if (c.running) {
      const overdue = (ms) => ms < -2000; // nach Neuladen kein verspäteter Buzzer
      const t = times(g);
      const rawGame = c.gameMs - (now() - c.anchor);
      const rawShot = c.shotMs - (now() - c.anchor);
      if (gameClockActive(g) && t.game <= 0) {
        stopClock(g);
        c.gameMs = 0;
        touch(g);
        if (!overdue(rawGame)) buzz();
        render();
        onTimeUp(g);
        return;
      }
      if (shotActive(g) && t.shot <= 0) {
        stopClock(g);
        c.shotMs = 0;
        touch(g);
        if (!overdue(rawShot)) buzz();
        render();
        toast('Shotclock abgelaufen');
        return;
      }
    }
    renderClocks();
  }

  /* ---------- Router ---------- */
  function route() {
    clearInterval(ticker);
    ticker = null;
    current = null;
    ui = null;
    releaseWake();
    document.querySelectorAll('dialog').forEach((d) => d.close());
    const h = location.hash;
    const m = h.match(/^#\/spiel\/(.+)$/);
    if (h === '#/neu') renderNew();
    else if (m && getGame(m[1])) renderGame(getGame(m[1]));
    else renderHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
