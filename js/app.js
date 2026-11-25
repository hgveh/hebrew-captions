import { DEFAULT_STYLE, ANIMS_IN, ANIMS_OUT, WORD_ANIMS, renderFrame, drawCaption, frameGeom, captionBounds, fontString } from './renderer.js';
import { PROVIDERS, getSettings, saveSettings, transcribe, segment, spreadWords, newId, FILLERS } from './transcribe.js';
import { exportVideo, planStatusParts, statusBitrate, supportsExport } from './exporter.js';
import * as store from './storage.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };
const fmtS = t => (Math.round(t * 100) / 100).toFixed(2);
const toast = (msg, ms = 2600) => { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms); };
const clone = o => JSON.parse(JSON.stringify(o));

// ================== STATE ==================
const P = {
  captions: [],
  style: { ...DEFAULT_STYLE },
  frame: { aspect: '9:16', fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5, bgBlur: true, bgColor: '#000000' },
  extras: { progressBar: false, pbColor: '#25d366', pbTop: false, logo: null, watermark: '' },
  exp: { target: 'status', quality: 1080, maxLen: 60, sizeCap: true, fps: 30, rangeS: 0, rangeE: 0, fileRes: 1080, fileFps: 30, fileQ: 'high', parts: null },
  duration: 0,
};
let file = null, projectKey = null, selId = null, dragMode = 'captions', logoImg = null;
const video = $('#video');
const cv = $('#preview'), ctx = cv.getContext('2d');
let needDraw = true;

// ---------- undo ----------
const hist = [], redo = [];
const snap = () => JSON.stringify({ captions: P.captions, style: P.style, frame: P.frame, extras: P.extras });
let lastSnap = null, commitT;
function commit(immediate) {
  needDraw = true;
  clearTimeout(commitT);
  const run = () => {
    const s = snap(); if (s === lastSnap) return;
    if (lastSnap) { hist.push(lastSnap); if (hist.length > 150) hist.shift(); redo.length = 0; }
    lastSnap = s; autosave();
  };
  immediate ? run() : (commitT = setTimeout(run, 350));
}
function restore(s) { const o = JSON.parse(s); Object.assign(P, { captions: o.captions, style: o.style, frame: o.frame, extras: o.extras }); lastSnap = s; refreshAll(); autosave(); }
$('#btnUndo').onclick = () => { if (!hist.length) return toast('אין מה לבטל'); redo.push(snap()); restore(hist.pop()); };
$('#btnRedo').onclick = () => { if (!redo.length) return; hist.push(snap()); restore(redo.pop()); };

let saveT;
function autosave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { if (projectKey) store.putProject({ key: projectKey, data: snap(), exp: P.exp, at: Date.now() }).catch(() => {}); }, 600);
}

// ================== LOAD VIDEO ==================
$('#fileInput').onchange = e => e.target.files[0] && loadFile(e.target.files[0]);
const dz = $('#dropzone');
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = [...(e.dataTransfer?.files || [])]; const v = f.find(x => x.type.startsWith('video/')); if (v) loadFile(v); const fonts = f.filter(x => /\.(ttf|otf|woff2?)$/i.test(x.name)); if (fonts.length) addFonts(fonts); });
$('#btnNew').onclick = () => { if (file && !confirm('לפתוח סרטון חדש? הפרויקט הנוכחי שמור במכשיר.')) return; $('#fileInput').value = ''; $('#fileInput').click(); };

async function loadFile(f) {
  file = f;
  projectKey = f.name + '_' + f.size;
  video.src = URL.createObjectURL(f);
  video.muted = false;
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('לא ניתן לנגן את הקובץ')); }).catch(e => toast(e.message));
  P.duration = video.duration || 0;
  $('#welcome').classList.add('hidden'); $('#editor').classList.remove('hidden');
  // שחזור פרויקט קודם של אותו קובץ
  const saved = await store.getProject(projectKey).catch(() => null);
  if (saved) {
    const o = JSON.parse(saved.data);
    Object.assign(P, { captions: o.captions || [], style: { ...DEFAULT_STYLE, ...o.style }, frame: { ...P.frame, ...o.frame }, extras: { ...P.extras, ...o.extras } });
    if (saved.exp) Object.assign(P.exp, saved.exp);
    toast('שוחזר הפרויקט הקודם של הסרטון הזה ✔');
  } else {
    P.captions = [];
    // ברירת מחדל: סגנון אחרון שהשתמשת בו
    const last = localStorage.getItem('kt_last_style'); if (last) try { P.style = { ...DEFAULT_STYLE, ...JSON.parse(last) }; } catch {}
    // סרטון אנכי → 9:16, אחרת מציעים מסגור
    P.frame.aspect = '9:16';
  }
  P.exp.rangeS = 0; P.exp.rangeE = P.duration; P.exp.parts = null;
  if (P.extras.logo?.src) { logoImg = new Image(); logoImg.src = P.extras.logo.src; logoImg.onload = () => needDraw = true; }
  hist.length = 0; redo.length = 0; lastSnap = snap();
  video.currentTime = 0.01;
  refreshAll();
  ensureFont();
}

// ================== PREVIEW ==================
function outDims(short = 540) {
  const a = P.frame.aspect;
  let rw, rh;
  if (a === 'orig') { rw = video.videoWidth || 9; rh = video.videoHeight || 16; }
  else [rw, rh] = a.split(':').map(Number);
  const r = rw / rh;
  return r < 1 ? [short, Math.round(short / r)] : [Math.round(short * r), short];
}
function sizeCanvas() {
  const [w, hh] = outDims(540);
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  needDraw = true;
}
function draw() {
  const t = video.currentTime;
  renderFrame(ctx, cv.width, cv.height, t, P, video.readyState >= 2 ? video : null, video.videoWidth, video.videoHeight, logoImg);
  // מסגרת בחירה
  const sel = P.captions.find(c => c.id === selId);
  if (sel && video.paused && t >= sel.s && t < sel.e) {
    const b = captionBounds(ctx, cv.width, cv.height, sel, P);
    ctx.save(); ctx.strokeStyle = '#7c5cff'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.strokeRect(b.x - 8, b.y - 6, b.w + 16, b.h + 12); ctx.restore();
  }
  if (dragging && snapX) { ctx.save(); ctx.strokeStyle = '#25d366aa'; ctx.beginPath(); ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height); ctx.stroke(); ctx.restore(); }
}
let lastActive = null;
function loop() {
  if (!video.paused || needDraw) {
    needDraw = false; draw(); drawTimeline();
    $('#timeLabel').textContent = `${fmt(video.currentTime)} / ${fmt(P.duration)}`;
    const act = P.captions.find(c => video.currentTime >= c.s && video.currentTime < c.e);
    const id = act?.id || null;
    if (id !== lastActive) {
      $$('.cap.active').forEach(e => e.classList.remove('active'));
      if (id) { const el = document.querySelector(`.cap[data-id="${id}"]`); if (el) { el.classList.add('active'); if (!video.paused && !el.contains(document.activeElement)) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
      lastActive = id;
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
video.addEventListener('seeked', () => needDraw = true);
video.addEventListener('loadeddata', () => needDraw = true);
video.addEventListener('play', () => $('#btnPlay').textContent = '❚❚');
video.addEventListener('pause', () => { $('#btnPlay').textContent = '▶'; needDraw = true; });
document.fonts.addEventListener?.('loadingdone', () => { needDraw = true; drawPresets(); });
$('#btnPlay').onclick = togglePlay;
function togglePlay() { if (video.paused) { if (video.currentTime >= P.duration - 0.05) video.currentTime = 0; video.play(); } else video.pause(); }
$('#btnMute').onclick = () => { video.muted = !video.muted; $('#btnMute').textContent = video.muted ? '🔇' : '🔊'; };
function seek(t) { video.currentTime = Math.max(0, Math.min(P.duration, t)); needDraw = true; }

// גרירה על התצוגה
$$('.drag-mode .chip').forEach(b => b.onclick = () => { dragMode = b.dataset.drag; $$('.drag-mode .chip').forEach(x => x.classList.toggle('active', x === b)); });
let dragging = null, snapX = false;
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * cv.width, y = (e.clientY - r.top) / r.height * cv.height;
  cv.setPointerCapture(e.pointerId);
  const t = video.currentTime;
  const act = P.captions.find(c => t >= c.s && t < c.e);
  if (dragMode === 'captions') {
    if (act) { selId = act.id; highlightSel(); }
    const target = act && act.o && act.o.posY != null && act.o.posY !== '' ? act.o : P.style;
    dragging = { mode: 'cap', x, y, target, px: target.posX ?? P.style.posX, py: target.posY ?? P.style.posY };
  } else {
    const g = frameGeom(video.videoWidth, video.videoHeight, cv.width, cv.height, P.frame);
    dragging = { mode: 'frame', x, y, cx: P.frame.cx, cy: P.frame.cy, g };
  }
});
cv.addEventListener('pointermove', e => {
  if (!dragging) return;
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * cv.width, y = (e.clientY - r.top) / r.height * cv.height;
  const dx = x - dragging.x, dy = y - dragging.y;
  if (dragging.mode === 'cap') {
    let nx = dragging.px + dx / cv.width, ny = dragging.py + dy / cv.height;
    snapX = Math.abs(nx - 0.5) < 0.025; if (snapX) nx = 0.5;
    dragging.target.posX = Math.max(0.05, Math.min(0.95, nx));
    dragging.target.posY = Math.max(0.04, Math.min(0.96, ny));
  } else {
    const { dw, dh } = dragging.g;
    if (Math.abs(cv.width - dw) > 1) P.frame.cx = Math.max(0, Math.min(1, dragging.cx + dx / (cv.width - dw)));
    if (Math.abs(cv.height - dh) > 1) P.frame.cy = Math.max(0, Math.min(1, dragging.cy + dy / (cv.height - dh)));
  }
  needDraw = true;
});
const endDrag = () => { if (dragging) { dragging = null; snapX = false; commit(); syncControls(); } };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('dblclick', () => togglePlay());

// ================== TIMELINE ==================
const tl = $('#timelineCanvas'), tctx = tl.getContext('2d');
function drawTimeline() {
  const r = tl.getBoundingClientRect(); const dpr = devicePixelRatio || 1;
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (!W) return;
  if (tl.width !== W || tl.height !== H) { tl.width = W; tl.height = H; }
  const D = P.duration || 1, X = t => t / D * W;
  tctx.clearRect(0, 0, W, H);
  // סימני זמן
  tctx.fillStyle = '#ffffff22'; const step = D > 120 ? 10 : D > 40 ? 5 : 1;
  for (let t = 0; t < D; t += step) tctx.fillRect(X(t), 0, 1, H * 0.18);
  // טווח ייצוא
  if (P.exp.rangeS > 0 || P.exp.rangeE < D - 0.01) {
    tctx.fillStyle = '#00000088'; tctx.fillRect(0, 0, X(P.exp.rangeS), H); tctx.fillRect(X(P.exp.rangeE), 0, W - X(P.exp.rangeE), H);
  }
  // כתוביות
  const y = H * 0.28, bh = H * 0.44;
  for (const c of P.captions) {
    tctx.fillStyle = c.id === selId ? '#7c5cff' : '#25d36699';
    const x0 = X(c.s), w = Math.max(2, X(c.e) - X(c.s) - 1);
    tctx.beginPath(); tctx.roundRect ? tctx.roundRect(x0, y, w, bh, 3 * dpr) : tctx.rect(x0, y, w, bh); tctx.fill();
  }
  // חיתוכי סטטוס
  if (P.exp.target === 'status') {
    const parts = currentParts();
    tctx.fillStyle = '#ff5c6c'; tctx.font = `${10 * dpr}px Heebo`;
    parts.forEach(([s], i) => { if (i === 0) return; tctx.fillRect(X(s) - dpr, 0, 2 * dpr, H); tctx.fillText(String(i + 1), X(s) + 3 * dpr, H - 3 * dpr); });
  }
  // סמן
  tctx.fillStyle = '#fff'; tctx.fillRect(X(video.currentTime) - dpr, 0, 2 * dpr, H);
}
let tlDrag = false;
const tlSeek = e => { const r = tl.getBoundingClientRect(); const t = (e.clientX - r.left) / r.width * P.duration; seek(t); return t; };
tl.addEventListener('pointerdown', e => {
  tl.setPointerCapture(e.pointerId); tlDrag = true; const t = tlSeek(e);
  const c = P.captions.find(c => t >= c.s && t < c.e);
  if (c) { selId = c.id; highlightSel(true); }
});
tl.addEventListener('pointermove', e => tlDrag && tlSeek(e));
tl.addEventListener('pointerup', () => tlDrag = false);
window.addEventListener('resize', () => needDraw = true);

// ================== TABS ==================
$$('#tabs button').forEach(b => b.onclick = () => {
  $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  if (b.dataset.tab === 'export') renderExport();
  if (b.dataset.tab === 'style') drawPresets();
  needDraw = true;
});

// ================== TRANSCRIPTION ==================
function fillProviderSelect(sel, val) {
  sel.innerHTML = ''; for (const [k, p] of Object.entries(PROVIDERS)) sel.append(h('option', { value: k }, p.name));
  sel.value = val;
}
fillProviderSelect($('#providerQuick'), getSettings().provider);
$('#providerQuick').onchange = e => { const s = getSettings(); s.provider = e.target.value; saveSettings(s); };

$('#btnTranscribe').onclick = async () => {
  if (!file) return;
  const s = getSettings();
  if (!s.keys[s.provider] && s.provider !== 'custom') { openSettings(); return toast('הכנס מפתח API לשירות התמלול'); }
  if (P.captions.length && !confirm('להחליף את הכתוביות הקיימות בתמלול חדש?')) return;
  const btn = $('#btnTranscribe'), st = $('#transcribeStatus');
  btn.disabled = true; st.classList.remove('err');
  try {
    const words = await transcribe(file, s, m => st.textContent = m);
    P.captions = segment(words, segOpts());
    if (P.style.autoEmoji) autoEmoji(true);
    st.textContent = `✔ ${words.length} מילים · ${P.captions.length} כתוביות. עבור על הטקסט ותקן במידת הצורך.`;
    commit(true); renderCaps(); needDraw = true;
  } catch (e) {
    console.error(e); st.classList.add('err');
    st.textContent = '✖ ' + (e.message || e) + (String(e).includes('Failed to fetch') ? ' – בדוק חיבור אינטרנט / מפתח.' : '');
  } finally { btn.disabled = false; }
};
const segOpts = () => ({ maxWords: +$('#segMaxWords').value || 4, maxChars: +$('#segMaxChars').value || 24, punct: $('#segPunct').checked });
['segMaxWords', 'segMaxChars'].forEach(id => { const v = localStorage.getItem('kt_' + id); if (v) $('#' + id).value = v; $('#' + id).onchange = e => localStorage.setItem('kt_' + id, e.target.value); });
$('#btnResegment').onclick = () => {
  const words = P.captions.flatMap(c => c.words.map(w => ({ ...w })));
  if (!words.length) return;
  const emojis = P.captions.filter(c => c.emoji);
  P.captions = segment(words, segOpts());
  // שמירת אימוג׳י לפי זמן
  for (const e of emojis) { const c = P.captions.find(c => e.s >= c.s - 0.01 && e.s < c.e); if (c) c.emoji = e.emoji; }
  commit(true); renderCaps(); toast('חולק מחדש ✔');
};

// ================== CAPTION LIST ==================
function setCapText(cap, text) {
  const toks = text.split(/\s+/).filter(Boolean);
  if (!toks.length) { cap.words = []; return; }
  if (toks.length === cap.words.length) cap.words = cap.words.map((w, i) => ({ ...w, t: toks[i] }));
  else {
    const old = cap.words;
    const nw = spreadWords(toks.join(' '), cap.s, cap.e);
    // שומרים הדגשות לפי טקסט זהה
    nw.forEach(w => { const o = old.find(x => x.t === w.t); if (o?.emph) w.emph = true; });
    cap.words = nw;
  }
}
function retime(cap, s, e) {
  s = Math.max(0, s); e = Math.max(s + 0.1, e);
  const os = cap.s, oe = cap.e, k = (e - s) / Math.max(0.01, oe - os);
  cap.words = cap.words.map(w => ({ ...w, s: s + (w.s - os) * k, e: s + (w.e - os) * k }));
  cap.s = s; cap.e = e;
}
const capText = c => c.words.map(w => w.t).join(' ');
const sortCaps = () => P.captions.sort((a, b) => a.s - b.s);

function renderCaps() {
  const list = $('#capList'); list.innerHTML = '';
  $('#capEmpty').classList.toggle('hidden', P.captions.length > 0);
  sortCaps();
  P.captions.forEach((c, idx) => list.append(capCard(c, idx)));
  lastActive = null; needDraw = true;
}
function capCard(c, idx) {
  const sIn = h('input', { type: 'number', step: '0.05', value: fmtS(c.s), title: 'התחלה' });
  const eIn = h('input', { type: 'number', step: '0.05', value: fmtS(c.e), title: 'סוף' });
  sIn.onchange = () => { retime(c, +sIn.value, c.e); commit(); renderWords(); needDraw = true; };
  eIn.onchange = () => { retime(c, c.s, +eIn.value); commit(); renderWords(); needDraw = true; };
  const ta = h('textarea', { rows: 1, dir: 'auto' }); ta.value = capText(c);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.oninput = () => { setCapText(c, ta.value); fit(); renderWords(); commit(); };
  ta.onfocus = () => { selId = c.id; highlightSel(); if (video.paused) seek(c.s + 0.01); };
  ta.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { // אנטר מפצל בנקודת הסמן
      e.preventDefault();
      const before = ta.value.slice(0, ta.selectionStart).trim().split(/\s+/).filter(Boolean).length;
      splitCap(c, before);
    }
  };
  setTimeout(fit);
  const words = h('div', { class: 'words' });
  const renderWords = () => {
    words.innerHTML = '';
    c.words.forEach(w => {
      const chip = h('span', { class: 'word' + (w.emph ? ' emph' : ''), title: `${fmtS(w.s)}–${fmtS(w.e)} · לחיצה = הדגשה, לחיצה כפולה = קפוץ` }, w.t);
      chip.onclick = () => { w.emph = !w.emph; chip.classList.toggle('emph', w.emph); commit(); };
      chip.ondblclick = () => seek(w.s + 0.01);
      words.append(chip);
    });
  };
  renderWords();
  const opts = h('div', { class: 'cap-opts hidden' });
  const o = c.o || (c.o = {});
  const mkSel = (label, key, map) => {
    const s = h('select', {}, h('option', { value: '' }, 'ברירת מחדל'), ...Object.entries(map).map(([k, v]) => h('option', { value: k }, v)));
    s.value = o[key] ?? ''; s.onchange = () => { o[key] = s.value; commit(); };
    return h('label', {}, label, s);
  };
  const emo = h('input', { value: c.emoji || '', placeholder: '😀', maxlength: 8 });
  emo.oninput = () => { c.emoji = emo.value.trim(); commit(); };
  const col = h('input', { type: 'color', value: o.color || P.style.color });
  col.oninput = () => { o.color = col.value; commit(); };
  const posSel = h('select', {}, h('option', { value: '' }, 'ברירת מחדל'), h('option', { value: '0.2' }, 'למעלה'), h('option', { value: '0.5' }, 'אמצע'), h('option', { value: '0.75' }, 'למטה'));
  posSel.value = o.posY != null && o.posY !== '' ? String(o.posY) : '';
  posSel.onchange = () => { o.posY = posSel.value === '' ? '' : +posSel.value; commit(); };
  const sizeIn = h('input', { type: 'number', step: '0.5', placeholder: String(P.style.fontSize), value: o.fontSize ?? '' });
  sizeIn.onchange = () => { o.fontSize = sizeIn.value === '' ? '' : +sizeIn.value; commit(); };
  opts.append(
    mkSel('כניסה', 'animIn', ANIMS_IN), mkSel('יציאה', 'animOut', ANIMS_OUT), mkSel('אפקט מילים', 'wordAnim', WORD_ANIMS),
    h('label', {}, 'מיקום', posSel), h('label', {}, 'אימוג׳י', emo), h('label', {}, 'גודל גופן', sizeIn),
    h('label', {}, 'צבע טקסט', col), h('label', {}, ' ', h('button', { class: 'btn small', onclick: () => { c.o = {}; commit(); renderCaps(); } }, 'איפוס עיצוב'))
  );
  const card = h('div', { class: 'cap' + (c.id === selId ? ' sel' : ''), 'data-id': c.id },
    h('div', { class: 'cap-head' },
      h('b', {}, '#' + (idx + 1)), sIn, '→', eIn, h('span', { class: 'sp' }),
      h('button', { title: 'נגן מכאן', onclick: () => { seek(c.s); video.play(); } }, '▶'),
      h('button', { title: 'פצל באמצע', onclick: () => splitCap(c) }, '✂'),
      h('button', { title: 'מזג עם הבאה', onclick: () => mergeNext(c) }, '⇣'),
      h('button', { title: 'עיצוב / אנימציה לכתובית זו', onclick: () => opts.classList.toggle('hidden') }, '⚙'),
      h('button', { title: 'מחק', onclick: () => { P.captions = P.captions.filter(x => x !== c); commit(true); renderCaps(); } }, '🗑'),
    ),
    ta, words, opts);
  card.onclick = e => { if (e.target === card) { selId = c.id; highlightSel(); seek(c.s + 0.01); } };
  return card;
}
function highlightSel(scroll) {
  $$('.cap.sel').forEach(e => e.classList.remove('sel'));
  const el = document.querySelector(`.cap[data-id="${selId}"]`);
  if (el) { el.classList.add('sel'); if (scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  needDraw = true;
}
function splitCap(c, at) {
  const n = c.words.length; if (n < 2) return toast('אין מה לפצל');
  const k = at && at > 0 && at < n ? at : Math.ceil(n / 2);
  const a = c.words.slice(0, k), b = c.words.slice(k);
  const nc = { id: newId(), s: b[0].s, e: c.e, words: b, o: clone(c.o || {}) };
  c.words = a; c.e = Math.max(a[a.length - 1].e, c.s + 0.2); if (c.e > nc.s) c.e = nc.s;
  P.captions.splice(P.captions.indexOf(c) + 1, 0, nc);
  commit(true); renderCaps();
  setTimeout(() => document.querySelector(`.cap[data-id="${nc.id}"] textarea`)?.focus());
}
function mergeNext(c) {
  const i = P.captions.indexOf(c), n = P.captions[i + 1]; if (!n) return;
  c.words = [...c.words, ...n.words]; c.e = n.e; if (!c.emoji) c.emoji = n.emoji;
  P.captions.splice(i + 1, 1); commit(true); renderCaps();
}
$('#btnAddCap').onclick = () => {
  const t = video.currentTime; const next = P.captions.find(c => c.s > t);
  const e = Math.min(t + 2, next ? next.s : P.duration);
  const c = { id: newId(), s: t, e: Math.max(t + 0.3, e), words: spreadWords('טקסט חדש', t, Math.max(t + 0.3, e)) };
  P.captions.push(c); selId = c.id; commit(true); renderCaps();
  setTimeout(() => { const ta = document.querySelector(`.cap[data-id="${c.id}"] textarea`); ta?.focus(); ta?.select(); });
};

// ---------- כלים ----------
const stripPre = w => w.replace(/[^\p{L}\p{N}]/gu, '');
$('#btnFillers').onclick = () => {
  let n = 0;
  for (const c of P.captions) { const before = c.words.length; c.words = c.words.filter(w => !FILLERS.includes(stripPre(w.t).toLowerCase())); n += before - c.words.length; }
  P.captions = P.captions.filter(c => c.words.length);
  commit(true); renderCaps(); toast(`הוסרו ${n} מילות מילוי`);
};
const EMOJI = { 'כסף': '💰', 'שקל': '💸', 'דולר': '💵', 'אהבה': '❤️', 'אוהב': '❤️', 'לב': '❤️', 'שמח': '😄', 'צחוק': '😂', 'מצחיק': '🤣', 'עצוב': '😢', 'בוכה': '😭', 'כועס': '😡', 'אש': '🔥', 'חם': '🔥', 'מטורף': '🤯', 'הלם': '😱', 'מפחיד': '😱', 'וואו': '🤩', 'מדהים': '🤩', 'יפה': '😍', 'מושלם': '👌', 'בדיוק': '🎯', 'מטרה': '🎯', 'רעיון': '💡', 'טיפ': '💡', 'סוד': '🤫', 'זמן': '⏰', 'שעה': '⏰', 'היום': '📅', 'מחר': '📅', 'בית': '🏠', 'עבודה': '💼', 'עסק': '💼', 'לקוח': '🤝', 'לקוחות': '🤝', 'הצלחה': '🏆', 'ניצחון': '🏆', 'מקום': '📍', 'טלפון': '📱', 'וואטסאפ': '💬', 'הודעה': '💬', 'אוכל': '🍽️', 'פיצה': '🍕', 'קפה': '☕', 'מים': '💧', 'ים': '🌊', 'שמש': '☀️', 'גשם': '🌧️', 'כוח': '💪', 'חזק': '💪', 'כושר': '🏋️', 'רכב': '🚗', 'אוטו': '🚗', 'טיסה': '✈️', 'חופשה': '🏖️', 'מוזיקה': '🎵', 'שיר': '🎶', 'סרט': '🎬', 'מצלמה': '📸', 'תמונה': '📸', 'ספר': '📚', 'ללמוד': '📚', 'מחשב': '💻', 'אינטרנט': '🌐', 'עולם': '🌍', 'ישראל': '🇮🇱', 'מתנה': '🎁', 'חג': '🎉', 'מסיבה': '🎉', 'יומולדת': '🎂', 'תינוק': '👶', 'ילדים': '👧', 'משפחה': '👨‍👩‍👧', 'כלב': '🐶', 'חתול': '🐱', 'לא': '❌', 'כן': '✅', 'נכון': '✅', 'טעות': '❌', 'בעיה': '⚠️', 'זהירות': '⚠️', 'שאלה': '❓', 'למה': '🤔', 'חושב': '🤔', 'סבבה': '👍', 'אחלה': '👍', 'תודה': '🙏', 'בבקשה': '🙏', 'מהר': '⚡', 'מהיר': '⚡', 'חדש': '🆕', 'מבצע': '🏷️', 'הנחה': '🏷️', 'חינם': '🆓', 'גדל': '📈', 'צמיחה': '📈', 'ירידה': '📉', 'שיא': '🚀', 'להתחיל': '🚀', 'כוכב': '⭐', 'מלך': '👑', 'מלכה': '👑', 'מוח': '🧠', 'חכם': '🧠', 'עיניים': '👀', 'תראו': '👀', 'שימו': '👀', 'סוף': '🔚', 'שלום': '👋', 'היי': '👋' };
const PREFIX = /^[והבלמשכ]{1,2}/;
function findEmoji(c) {
  for (const w of c.words) {
    const k = stripPre(w.t); if (EMOJI[k]) return EMOJI[k];
    const k2 = k.replace(PREFIX, ''); if (k2.length > 1 && EMOJI[k2]) return EMOJI[k2];
  }
  return '';
}
function autoEmoji(silent) {
  let n = 0, lastAt = -99;
  for (const c of P.captions) { if (c.emoji) continue; const e = findEmoji(c); if (e && c.s - lastAt > 2.5) { c.emoji = e; n++; lastAt = c.s; } }
  if (!silent) { commit(true); renderCaps(); toast(`נוספו ${n} אימוג׳י`); }
}
$('#btnAutoEmoji').onclick = () => autoEmoji();
$('#btnClearEmoji').onclick = () => { P.captions.forEach(c => c.emoji = ''); commit(true); renderCaps(); };
const STOP = new Set(['אני', 'אתה', 'את', 'הוא', 'היא', 'אנחנו', 'הם', 'זה', 'זאת', 'של', 'על', 'עם', 'אבל', 'גם', 'כמו', 'שלא', 'הזה', 'הזאת', 'כל', 'יש', 'אין', 'מה', 'איך', 'כדי', 'אז', 'רק', 'עוד', 'היה', 'היתה', 'להיות', 'אותו', 'אותה', 'שלי', 'שלך', 'לכם', 'אתכם']);
$('#btnAutoEmph').onclick = () => {
  for (const c of P.captions) {
    c.words.forEach(w => w.emph = false);
    const num = c.words.find(w => /\d/.test(w.t)); if (num) { num.emph = true; continue; }
    const cand = c.words.filter(w => !STOP.has(stripPre(w.t)) && stripPre(w.t).length >= 4).sort((a, b) => stripPre(b.t).length - stripPre(a.t).length)[0];
    if (cand && c.words.length > 1) cand.emph = true;
  }
  commit(true); renderCaps(); toast('הודגשו מילות מפתח ⭐');
};
$('#btnRemovePunct').onclick = () => { P.captions.forEach(c => c.words.forEach(w => w.t = w.t.replace(/[.,!?;:…"״]+$/g, '').replace(/^["״]+/, '') || w.t)); commit(true); renderCaps(); };
const CURSES = ['זין', 'כוס', 'שרמוטה', 'זונה', 'מזדיין', 'חרא', 'כוסעמק', 'fuck', 'shit', 'bitch'];
$('#btnCensor').onclick = () => {
  let n = 0;
  P.captions.forEach(c => c.words.forEach(w => { const k = stripPre(w.t).replace(PREFIX, ''); if (CURSES.some(x => k === x || stripPre(w.t) === x)) { w.t = w.t[0] + '*'.repeat(Math.max(1, w.t.length - 2)) + (w.t.length > 1 ? w.t[w.t.length - 1] : ''); n++; } }));
  commit(true); renderCaps(); toast(`צונזרו ${n} מילים`);
};
$('#btnCopyText').onclick = async () => { await navigator.clipboard.writeText(P.captions.map(capText).join('\n')); toast('התמליל הועתק 📋'); };
$('#btnReplace').onclick = () => {
  const f = $('#findText').value; if (!f) return; const r = $('#replaceText').value; let n = 0;
  for (const c of P.captions) { const t = capText(c); if (t.includes(f)) { setCapText(c, t.split(f).join(r)); n++; } }
  commit(true); renderCaps(); toast(`הוחלף ב-${n} כתוביות`);
};
$('#btnShift').onclick = () => { const d = +$('#shiftSec').value || 0; P.captions.forEach(c => retime(c, c.s + d, c.e + d)); commit(true); renderCaps(); };

// SRT / VTT
const srtT = (t, sep = ',') => { const ms = Math.round(t * 1000); const hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
const download = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const baseName = () => (file?.name || 'video').replace(/\.[^.]+$/, '');
$('#btnExportSrt').onclick = () => download(new Blob(['﻿' + P.captions.map((c, i) => `${i + 1}\n${srtT(c.s)} --> ${srtT(c.e)}\n${capText(c)}\n`).join('\n')], { type: 'text/plain' }), baseName() + '.srt');
$('#btnExportVtt').onclick = () => download(new Blob(['WEBVTT\n\n' + P.captions.map(c => `${srtT(c.s, '.')} --> ${srtT(c.e, '.')}\n${capText(c)}\n`).join('\n')], { type: 'text/vtt' }), baseName() + '.vtt');
$('#btnExportTxt').onclick = () => download(new Blob([P.captions.map(capText).join('\n')], { type: 'text/plain' }), baseName() + '.txt');
$('#importSrt').onchange = async e => {
  const txt = await e.target.files[0].text(); e.target.value = '';
  const re = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const pt = s => { const p = s.replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const caps = []; let m;
  while ((m = re.exec(txt.replace(/\r/g, '')))) {
    const text = m[3].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim(); if (!text) continue;
    const s = pt(m[1]), en = pt(m[2]); caps.push({ id: newId(), s, e: en, words: spreadWords(text, s, en) });
  }
  if (!caps.length) return toast('לא נמצאו כתוביות בקובץ');
  P.captions = caps; commit(true); renderCaps(); toast(`יובאו ${caps.length} כתוביות`);
};
$('#btnSaveProject').onclick = () => download(new Blob([snap()], { type: 'application/json' }), baseName() + '.kt.json');
$('#loadProject').onchange = async e => {
  try { const o = JSON.parse(await e.target.files[0].text()); P.captions = o.captions || []; P.style = { ...DEFAULT_STYLE, ...o.style }; Object.assign(P.frame, o.frame); Object.assign(P.extras, o.extras); commit(true); refreshAll(); ensureFont(); toast('הפרויקט נטען ✔'); }
  catch { toast('קובץ פרויקט לא תקין'); }
  e.target.value = '';
};

// ================== CONTROLS BUILDER ==================
const binders = [];
function ctrl(obj, key, label, type, a = {}) {
  const getO = typeof obj === 'function' ? obj : () => obj;
  let input, val = h('span', { class: 'val' });
  const set = v => { getO()[key] = v; if (a.onSet) a.onSet(v); if (obj === styleObj) rememberStyle(); commit(); };
  if (type === 'range') {
    input = h('input', { type: 'range', min: a.min, max: a.max, step: a.step || 1 });
    input.oninput = () => { set(+input.value); val.textContent = a.fmt ? a.fmt(+input.value) : input.value; };
  } else if (type === 'color') {
    input = h('input', { type: 'color' }); input.oninput = () => set(input.value);
  } else if (type === 'toggle') {
    input = h('input', { type: 'checkbox' }); input.onchange = () => set(input.checked);
  } else if (type === 'select') {
    input = h('select', {}, ...Object.entries(a.options).map(([k, v]) => h('option', { value: k }, v)));
    input.onchange = () => set(a.num ? +input.value : input.value);
  } else if (type === 'seg') {
    input = h('div', { class: 'seg' }, ...Object.entries(a.options).map(([k, v]) => {
      const b = h('button', { 'data-v': k }, v);
      b.onclick = () => { set(a.num ? +k : k); sync(); }; return b;
    }));
    const row = h('div', { class: 'ctrl', style: 'grid-template-columns:110px 1fr' }, h('span', {}, label), input);
    const sync = () => [...input.children].forEach(b => b.classList.toggle('active', String(getO()[key]) === b.dataset.v));
    binders.push(sync); return row;
  } else if (type === 'text') {
    input = h('input', { placeholder: a.placeholder || '' }); input.oninput = () => set(input.value);
  }
  const sync = () => {
    const v = getO()[key];
    if (type === 'toggle') input.checked = !!v; else input.value = v ?? '';
    if (type === 'range') val.textContent = a.fmt ? a.fmt(+v) : v;
  };
  binders.push(sync);
  return h('div', { class: 'ctrl' }, h('span', {}, label), input, type === 'range' ? val : h('span'));
}
const syncControls = () => binders.forEach(f => f());
const styleObj = () => P.style;
const rememberStyle = () => localStorage.setItem('kt_last_style', JSON.stringify(P.style));
const G = t => h('div', { class: 'group-title' }, t);

function buildStyleControls() {
  const S = styleObj;
  const fontSel = h('select', { id: 'fontSelect' });
  fontSel.onchange = () => { P.style.fontFamily = fontSel.value; rememberStyle(); commit(); ensureFont(); renderFontList(); };
  binders.push(() => { fillFontSelect(fontSel); fontSel.value = P.style.fontFamily; });
  $('#styleControls').append(
    G('טקסט'),
    h('div', { class: 'ctrl', style: 'grid-template-columns:110px 1fr' }, h('span', {}, 'גופן'), fontSel),
    ctrl(S, 'fontSize', 'גודל', 'range', { min: 2, max: 18, step: 0.1 }),
    ctrl(S, 'fontWeight', 'עובי', 'select', { num: true, options: { 300: 'דק', 400: 'רגיל', 500: 'בינוני', 600: 'חצי-בולט', 700: 'בולט', 800: 'בולט מאוד', 900: 'שחור' }, onSet: () => ensureFont() }),
    ctrl(S, 'italic', 'נטוי', 'toggle'),
    ctrl(S, 'color', 'צבע טקסט', 'color'),
    ctrl(S, 'gradient', 'גרדיאנט', 'toggle'),
    ctrl(S, 'color2', 'צבע גרדיאנט', 'color'),
    ctrl(S, 'highlightColor', 'צבע מילה פעילה', 'color'),
    ctrl(S, 'emphColor', 'צבע הדגשה ⭐', 'color'),
    ctrl(S, 'emphScale', 'גודל הדגשה', 'range', { min: 1, max: 1.6, step: 0.01 }),
    ctrl(S, 'uppercase', 'אותיות גדולות (EN)', 'toggle'),
    G('קו מתאר וצל'),
    ctrl(S, 'strokeWidth', 'עובי קו מתאר', 'range', { min: 0, max: 30, step: 0.5 }),
    ctrl(S, 'strokeColor', 'צבע קו', 'color'),
    ctrl(S, 'shadowOpacity', 'שקיפות צל', 'range', { min: 0, max: 1, step: 0.05 }),
    ctrl(S, 'shadowBlur', 'טשטוש צל', 'range', { min: 0, max: 60 }),
    ctrl(S, 'shadowY', 'היסט צל', 'range', { min: -20, max: 30 }),
    ctrl(S, 'shadowColor', 'צבע צל', 'color'),
    G('רקע'),
    ctrl(S, 'bgMode', 'רקע לטקסט', 'seg', { options: { none: 'ללא', line: 'לכל שורה', block: 'בלוק' } }),
    ctrl(S, 'bgColor', 'צבע רקע', 'color'),
    ctrl(S, 'bgOpacity', 'אטימות', 'range', { min: 0, max: 1, step: 0.05 }),
    ctrl(S, 'bgPadding', 'ריפוד', 'range', { min: 0, max: 80 }),
    ctrl(S, 'bgRadius', 'עיגול פינות', 'range', { min: 0, max: 100 }),
    G('פריסה ומיקום'),
    ctrl(S, 'posY', 'מיקום אנכי', 'range', { min: 0.04, max: 0.96, step: 0.01, fmt: v => Math.round(v * 100) + '%' }),
    ctrl(S, 'posX', 'מיקום אופקי', 'range', { min: 0.05, max: 0.95, step: 0.01, fmt: v => Math.round(v * 100) + '%' }),
    ctrl(S, 'maxWidth', 'רוחב מקסימלי', 'range', { min: 30, max: 100, fmt: v => v + '%' }),
    ctrl(S, 'lineHeight', 'מרווח שורות', 'range', { min: 0.8, max: 2, step: 0.02 }),
    ctrl(S, 'letterSpacing', 'ריווח אותיות', 'range', { min: -10, max: 30, step: 0.5 }),
    ctrl(S, 'wordSpacing', 'ריווח מילים', 'range', { min: 0.3, max: 3, step: 0.05 }),
    ctrl(S, 'balance', 'איזון שורות', 'toggle'),
    h('div', { class: 'row gap-s' },
      h('button', { class: 'btn small grow', onclick: () => { P.style.posY = 0.18; commit(); syncControls(); } }, '⬆ למעלה'),
      h('button', { class: 'btn small grow', onclick: () => { P.style.posY = 0.5; commit(); syncControls(); } }, '⏺ אמצע'),
      h('button', { class: 'btn small grow', onclick: () => { P.style.posY = 0.72; commit(); syncControls(); } }, '⬇ למטה'),
      h('button', { class: 'btn small grow', onclick: () => { P.style.posX = 0.5; commit(); syncControls(); } }, '↔ מרכז')),
    G('אימוג׳י'),
    ctrl(S, 'emojiSize', 'גודל אימוג׳י', 'range', { min: 0.6, max: 4, step: 0.1 }),
    ctrl(S, 'emojiPos', 'מיקום אימוג׳י', 'seg', { options: { above: 'מעל', below: 'מתחת' } }),
    ctrl(S, 'autoEmoji', 'הוסף אוטומטית בתמלול', 'toggle'),
  );
}

function animGrid(key, map) {
  const grid = h('div', { class: 'anim-grid' }, ...Object.entries(map).map(([k, v]) => {
    const b = h('button', { 'data-v': k }, v);
    b.onclick = () => { P.style[key] = k; rememberStyle(); commit(); sync(); previewAnim(key); };
    return b;
  }));
  const sync = () => [...grid.children].forEach(b => b.classList.toggle('active', P.style[key] === b.dataset.v));
  binders.push(sync); return grid;
}
function previewAnim(key) {
  // מנגן את הכתובית הקרובה כדי לראות את האנימציה
  const t = video.currentTime;
  let c = P.captions.find(c => t >= c.s && t < c.e) || P.captions.find(c => c.s >= t) || P.captions[0];
  if (!c) return;
  seek(key === 'animOut' ? Math.max(c.s, c.e - 0.8) : c.s);
  video.play(); clearTimeout(previewAnim.t);
  previewAnim.t = setTimeout(() => video.pause(), (key === 'animOut' ? 0.9 : Math.min(2.2, c.e - c.s + 0.1)) * 1000);
}
function buildAnimControls() {
  const S = styleObj;
  $('#animControls').append(
    G('כניסה'), animGrid('animIn', ANIMS_IN),
    ctrl(S, 'animDur', 'משך כניסה', 'range', { min: 0.05, max: 1.2, step: 0.05, fmt: v => v.toFixed(2) + 'ש' }),
    G('יציאה'), animGrid('animOut', ANIMS_OUT),
    ctrl(S, 'animOutDur', 'משך יציאה', 'range', { min: 0.05, max: 1, step: 0.05, fmt: v => v.toFixed(2) + 'ש' }),
    G('אפקט מילים (לפי הדיבור)'), animGrid('wordAnim', WORD_ANIMS),
    ctrl(S, 'activeScale', 'הגדלת מילה פעילה', 'range', { min: 1, max: 1.6, step: 0.01 }),
    h('button', { class: 'btn small', onclick: () => { for (const c of P.captions) if (c.o) { delete c.o.animIn; delete c.o.animOut; delete c.o.wordAnim; } commit(true); renderCaps(); toast('האנימציה הוחלה על כל הכתוביות'); } }, 'החל על כל הכתוביות (מחק התאמות אישיות)'),
  );
}

// ================== PRESETS ==================
const PRESETS = [
  { n: 'קלאסי', s: { fontFamily: 'Heebo', fontWeight: 800, color: '#ffffff', strokeWidth: 12, strokeColor: '#000000', bgMode: 'none', wordAnim: 'highlight', highlightColor: '#ffd60a', animIn: 'pop', shadowOpacity: 0.7, gradient: false } },
  { n: 'בולט צהוב', s: { fontFamily: 'Heebo', fontWeight: 900, color: '#ffffff', strokeWidth: 16, strokeColor: '#000000', bgMode: 'none', wordAnim: 'scale', highlightColor: '#ffe600', activeScale: 1.2, animIn: 'staggerPop', fontSize: 8.2, gradient: false } },
  { n: 'תיבה שחורה', s: { fontFamily: 'Rubik', fontWeight: 700, color: '#ffffff', strokeWidth: 0, bgMode: 'line', bgColor: '#000000', bgOpacity: 0.75, bgRadius: 25, wordAnim: 'none', animIn: 'slideUp', shadowOpacity: 0, gradient: false } },
  { n: 'קריוקי', s: { fontFamily: 'Heebo', fontWeight: 900, color: '#ffffff', strokeWidth: 12, strokeColor: '#000000', bgMode: 'none', wordAnim: 'karaoke', highlightColor: '#25d366', animIn: 'fade', gradient: false } },
  { n: 'תיבת מילה', s: { fontFamily: 'Rubik', fontWeight: 900, color: '#ffffff', strokeWidth: 0, bgMode: 'none', wordAnim: 'box', highlightColor: '#7c5cff', shadowOpacity: 0.9, shadowBlur: 14, animIn: 'pop', gradient: false } },
  { n: 'ניאון', s: { fontFamily: 'Secular One', fontWeight: 400, color: '#bff8ff', strokeWidth: 0, bgMode: 'none', wordAnim: 'glow', highlightColor: '#00e5ff', shadowColor: '#00e5ff', shadowBlur: 40, shadowOpacity: 1, shadowY: 0, animIn: 'glitch', gradient: false } },
  { n: 'מינימלי', s: { fontFamily: 'Assistant', fontWeight: 600, fontSize: 5.6, color: '#ffffff', strokeWidth: 0, shadowOpacity: 0.85, shadowBlur: 12, bgMode: 'none', wordAnim: 'none', animIn: 'fade', animOut: 'fade', gradient: false } },
  { n: 'גרדיאנט', s: { fontFamily: 'Suez One', fontWeight: 400, color: '#ffffff', color2: '#ff7ad9', gradient: true, strokeWidth: 10, strokeColor: '#2a0040', wordAnim: 'bounceWord', highlightColor: '#ffd1f2', animIn: 'zoomOut', bgMode: 'none' } },
  { n: 'מכונת כתיבה', s: { fontFamily: 'Frank Ruhl Libre', fontWeight: 700, color: '#111111', strokeWidth: 0, bgMode: 'block', bgColor: '#fff8e7', bgOpacity: 0.95, bgRadius: 15, wordAnim: 'none', animIn: 'typewriter', shadowOpacity: 0, gradient: false } },
  { n: 'מילה-מילה', s: { fontFamily: 'Heebo', fontWeight: 900, fontSize: 11, color: '#ffffff', strokeWidth: 14, strokeColor: '#000000', wordAnim: 'oneWord', animIn: 'none', animOut: 'none', bgMode: 'none', posY: 0.5, gradient: false } },
  { n: 'בועה', s: { fontFamily: 'Varela Round', fontWeight: 400, color: '#111111', strokeWidth: 0, bgMode: 'block', bgColor: '#ffffff', bgOpacity: 1, bgRadius: 70, bgPadding: 30, wordAnim: 'highlight', highlightColor: '#ff3b7f', animIn: 'elastic', shadowOpacity: 0.3, gradient: false } },
  { n: 'דרמטי', s: { fontFamily: 'Suez One', fontWeight: 400, color: '#ff3b3b', strokeWidth: 10, strokeColor: '#000000', wordAnim: 'dim', highlightColor: '#ffffff', animIn: 'zoomIn', bgMode: 'none', gradient: false } },
  { n: 'גל', s: { fontFamily: 'Fredoka', fontWeight: 700, color: '#ffffff', strokeWidth: 12, strokeColor: '#ff6a00', wordAnim: 'highlight', highlightColor: '#ffef5c', animIn: 'wave', bgMode: 'none', gradient: false } },
  { n: 'קו תחתון', s: { fontFamily: 'Rubik', fontWeight: 700, color: '#ffffff', strokeWidth: 0, shadowOpacity: 0.9, shadowBlur: 10, wordAnim: 'underline', highlightColor: '#25d366', animIn: 'staggerUp', bgMode: 'none', gradient: false } },
  { n: 'כתב יד', s: { fontFamily: 'Karantina', fontWeight: 700, fontSize: 10, color: '#ffffff', strokeWidth: 8, strokeColor: '#000000', wordAnim: 'reveal', animIn: 'none', bgMode: 'none', gradient: false } },
];
const userPresets = () => { try { return JSON.parse(localStorage.getItem('kt_presets') || '[]'); } catch { return []; } };
function drawPresets() {
  const grid = $('#presetGrid'); if (!grid) return; grid.innerHTML = '';
  const all = [...PRESETS.map(p => ({ ...p })), ...userPresets().map(p => ({ ...p, user: true }))];
  for (const pr of all) {
    const c = h('canvas', { width: 240, height: 128 });
    const b = h('button', { class: 'preset', title: pr.n }, c);
    if (pr.user) { const d = h('span', { class: 'del', title: 'מחק' }, '✕'); d.onclick = ev => { ev.stopPropagation(); localStorage.setItem('kt_presets', JSON.stringify(userPresets().filter(x => x.n !== pr.n))); drawPresets(); }; b.append(d); }
    b.onclick = () => { P.style = { ...P.style, ...pr.s, posX: P.style.posX, posY: pr.s.posY ?? (P.style.posY === 0.5 && pr.s.posY == null ? 0.72 : P.style.posY) }; rememberStyle(); commit(true); syncControls(); ensureFont(); toast('סגנון: ' + pr.n); };
    grid.append(b);
    const st = { ...DEFAULT_STYLE, ...pr.s, fontSize: (pr.s.fontSize || 7.2) * 1.55, posX: 0.5, posY: 0.55, maxWidth: 96, maxLines: 1, animIn: 'none', animOut: 'none' };
    const words = pr.s.wordAnim === 'oneWord' ? [{ t: 'כתוביות', s: 0, e: 1 }] : [{ t: 'כתוביות', s: 0, e: 0.4 }, { t: 'בעברית', s: 0.4, e: 1 }];
    if (pr.n === 'בולט צהוב') words[1].emph = false;
    const x = c.getContext('2d');
    const paint = () => {
      const g = x.createLinearGradient(0, 0, 240, 128); g.addColorStop(0, '#5b6478'); g.addColorStop(1, '#2b3140');
      x.fillStyle = g; x.fillRect(0, 0, 240, 128);
      x.fillStyle = '#ffffff10'; for (let i = 0; i < 6; i++) x.fillRect(i * 44, 0, 22, 128);
      drawCaption(x, 240, 128, 0.6, { s: 0, e: 2, words }, { style: { ...st, fontSize: st.fontSize * 128 / 240 * 1.6 } });
      x.fillStyle = '#fff'; x.font = '600 13px Heebo'; x.textAlign = 'right'; x.direction = 'rtl'; x.shadowColor = '#000'; x.shadowBlur = 4; x.fillText(pr.n, 232, 120); x.shadowBlur = 0;
    };
    document.fonts.load(fontString(st, 30)).then(paint, paint);
  }
}
$('#btnSavePreset').onclick = () => {
  const n = prompt('שם לסגנון:'); if (!n) return;
  const { posX, posY, ...s } = P.style;
  localStorage.setItem('kt_presets', JSON.stringify([...userPresets().filter(x => x.n !== n), { n, s }]));
  drawPresets(); toast('נשמר ✔');
};

// ================== FONTS ==================
const BUILTIN_FONTS = ['Heebo', 'Rubik', 'Assistant', 'Secular One', 'Varela Round', 'Suez One', 'Frank Ruhl Libre', 'Karantina', 'Amatic SC', 'Bellefair', 'Noto Sans Hebrew', 'Alef', 'Fredoka', 'Bona Nova', 'Arial', 'David', 'Tahoma', 'Segoe UI'];
let userFonts = [], localFonts = [];
async function loadStoredFonts() {
  const list = await store.allFonts().catch(() => []);
  for (const f of list) await registerFont(f.name, f.data).catch(e => console.warn('font', f.name, e));
  userFonts = list.map(f => ({ name: f.name, file: f.file, size: f.data.byteLength }));
  renderFontList();
}
async function registerFont(name, data) {
  const ff = new FontFace(name, data);
  await ff.load(); document.fonts.add(ff);
  // מאפשר לגופן להופיע בכל משקל (הגופן בקובץ הוא המשקל עצמו)
  for (const w of ['100', '200', '300', '500', '600', '700', '800', '900']) {
    try { const f2 = new FontFace(name, data, { weight: w }); f2.load().then(x => document.fonts.add(x)).catch(() => {}); } catch {}
  }
}
$('#fontInput').onchange = e => { addFonts([...e.target.files]); e.target.value = ''; };
async function addFonts(files) {
  let ok = 0, last;
  for (const f of files) {
    try {
      const data = await f.arrayBuffer();
      let name = f.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[_]+/g, ' ').trim();
      await registerFont(name, data);
      await store.putFont({ name, file: f.name, data });
      userFonts = userFonts.filter(x => x.name !== name); userFonts.push({ name, file: f.name, size: data.byteLength });
      ok++; last = name;
    } catch (err) { console.error(err); toast('לא ניתן לטעון את ' + f.name + ' – הקובץ פגום או לא נתמך'); }
  }
  if (ok) { P.style.fontFamily = last; rememberStyle(); commit(true); syncControls(); renderFontList(); toast(`נוספו ${ok} גופנים ✔ – "${last}" נבחר`); }
}
$('#btnLocalFonts').onclick = async () => {
  if (!window.queryLocalFonts) return toast('זמין רק ב-Chrome/Edge במחשב. אפשר להעלות קובץ גופן במקום.');
  try {
    const fonts = await window.queryLocalFonts();
    localFonts = [...new Set(fonts.map(f => f.family))].sort();
    renderFontList(); syncControls(); toast(`נמצאו ${localFonts.length} גופנים במחשב`);
  } catch (e) { toast('אין הרשאה לגופנים: ' + e.message); }
};
function fillFontSelect(sel) {
  sel.innerHTML = '';
  const grp = (label, arr) => { if (!arr.length) return; const g = h('optgroup', { label }); arr.forEach(n => g.append(h('option', { value: n }, n))); sel.append(g); };
  grp('הגופנים שלי', userFonts.map(f => f.name));
  grp('גופנים עבריים', BUILTIN_FONTS);
  grp('מותקנים במחשב', localFonts);
  if (![...sel.options].some(o => o.value === P.style.fontFamily)) sel.prepend(h('option', { value: P.style.fontFamily }, P.style.fontFamily));
}
function renderFontList() {
  const el = $('#fontList'); el.innerHTML = '';
  const item = (name, sub, del) => {
    const it = h('div', { class: 'font-item' + (P.style.fontFamily === name ? ' cur' : '') },
      h('div', { class: 'sample', style: `font-family:"${name}"` }, 'שלום עולם 123', h('small', {}, name + (sub ? ' · ' + sub : ''))));
    if (del) it.append(h('button', { class: 'btn small danger', onclick: async e => { e.stopPropagation(); await store.delFont(name); userFonts = userFonts.filter(f => f.name !== name); renderFontList(); syncControls(); } }, '🗑'));
    it.onclick = () => { P.style.fontFamily = name; rememberStyle(); commit(true); syncControls(); ensureFont(); renderFontList(); };
    return it;
  };
  if (userFonts.length) { el.append(h('div', { class: 'group-title' }, 'הגופנים שלי')); userFonts.forEach(f => el.append(item(f.name, (f.size / 1024).toFixed(0) + 'KB', true))); }
  el.append(h('div', { class: 'group-title' }, 'גופנים עבריים מובנים')); BUILTIN_FONTS.forEach(n => el.append(item(n)));
  if (localFonts.length) { el.append(h('div', { class: 'group-title' }, 'מותקנים במחשב')); localFonts.forEach(n => el.append(item(n))); }
}
function ensureFont() {
  document.fonts.load(fontString(P.style, 40), 'אבג abc').then(() => { needDraw = true; }).catch(() => {});
  for (const c of P.captions) if (c.o?.fontFamily) document.fonts.load(fontString({ ...P.style, ...c.o }, 40)).catch(() => {});
}

// ================== FRAME PANEL ==================
function buildFramePanel() {
  const F = () => P.frame, X = () => P.extras;
  const logoIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  logoIn.onchange = async () => {
    const f = logoIn.files[0]; if (!f) return;
    const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    P.extras.logo = { src, size: 18, x: 0.92, y: 0.05, opacity: 0.9 };
    logoImg = new Image(); logoImg.src = src; logoImg.onload = () => needDraw = true;
    commit(true); rebuildLogo();
  };
  const logoBox = h('div', { class: 'card', style: 'padding:0;border:none;background:none' });
  const rebuildLogo = () => {
    logoBox.innerHTML = '';
    if (!P.extras.logo) return;
    const L = () => P.extras.logo;
    logoBox.append(
      ctrl(L, 'size', 'גודל לוגו', 'range', { min: 4, max: 60, fmt: v => v + '%' }),
      ctrl(L, 'x', 'מיקום אופקי', 'range', { min: 0, max: 1, step: 0.01 }),
      ctrl(L, 'y', 'מיקום אנכי', 'range', { min: 0, max: 1, step: 0.01 }),
      ctrl(L, 'opacity', 'שקיפות', 'range', { min: 0.1, max: 1, step: 0.05 }),
      h('button', { class: 'btn small danger', onclick: () => { P.extras.logo = null; logoImg = null; commit(true); rebuildLogo(); } }, 'הסר לוגו'));
    syncControls();
  };
  $('#framePanel').append(
    h('div', { class: 'card' },
      G('יחס תמונה'),
      ctrl(F, 'aspect', 'פורמט', 'seg', { options: { '9:16': '9:16 סטטוס', '4:5': '4:5', '1:1': '1:1', '16:9': '16:9', 'orig': 'מקורי' }, onSet: () => { sizeCanvas(); P.exp.parts = null; } }),
      ctrl(F, 'fit', 'התאמה', 'seg', { options: { cover: 'מילוי (חיתוך)', contain: 'התאמה מלאה' } }),
      ctrl(F, 'bgBlur', 'רקע מטושטש', 'toggle'),
      ctrl(F, 'bgColor', 'צבע רקע', 'color'),
      ctrl(F, 'zoom', 'זום', 'range', { min: 0.5, max: 3, step: 0.01, fmt: v => v.toFixed(2) + 'x' }),
      ctrl(F, 'cx', 'מיקום אופקי', 'range', { min: 0, max: 1, step: 0.005, fmt: v => Math.round(v * 100) + '%' }),
      ctrl(F, 'cy', 'מיקום אנכי', 'range', { min: 0, max: 1, step: 0.005, fmt: v => Math.round(v * 100) + '%' }),
      h('p', { class: 'hint' }, 'טיפ: בחר "🖼 הזז תמונה" מעל התצוגה וגרור כדי למקם את החיתוך בדיוק איפה שצריך.'),
      h('button', { class: 'btn small', onclick: () => { Object.assign(P.frame, { zoom: 1, cx: 0.5, cy: 0.5 }); commit(true); syncControls(); } }, 'איפוס מסגור')),
    h('div', { class: 'card' },
      G('תוספות'),
      ctrl(X, 'progressBar', 'פס התקדמות', 'toggle'),
      ctrl(X, 'pbColor', 'צבע פס', 'color'),
      ctrl(X, 'pbTop', 'פס למעלה', 'toggle'),
      ctrl(X, 'watermark', 'טקסט קבוע למעלה', 'text', { placeholder: 'למשל @שם_העסק' }),
      h('label', { class: 'btn small' }, '🖼 הוסף לוגו / סימן מים', logoIn),
      logoBox),
  );
  rebuildLogo();
}

// ================== EXPORT ==================
function currentParts() {
  const E = P.exp;
  if (E.target !== 'status') return [[E.rangeS, E.rangeE]];
  if (!E.parts) E.parts = planStatusParts(P.duration, P.captions, E.maxLen, [E.rangeS, E.rangeE || P.duration]);
  return E.parts;
}
function exportDims() {
  const E = P.exp;
  if (E.target === 'status') return outDims(E.quality === 1080 ? 1080 : 720);
  if (E.fileRes === 0) { const vs = Math.min(video.videoWidth, video.videoHeight) || 1080; return outDims(vs); }
  return outDims(E.fileRes);
}
$$('#exportTarget button').forEach(b => b.onclick = () => { P.exp.target = b.dataset.v; P.exp.parts = null; renderExport(); needDraw = true; });
function renderExport() {
  const E = P.exp; const Eo = () => P.exp;
  $$('#exportTarget button').forEach(b => b.classList.toggle('active', b.dataset.v === E.target));
  const box = $('#exportOptions'); box.innerHTML = '';
  const reset = () => { P.exp.parts = null; renderPlan(); needDraw = true; };
  if (E.target === 'status') {
    box.append(
      ctrl(Eo, 'quality', 'איכות', 'seg', { num: true, options: { 1080: 'Full HD 1080×1920', 720: 'HD 720×1280' }, onSet: renderPlan }),
      ctrl(Eo, 'maxLen', 'אורך מקס׳ לחלק', 'seg', { num: true, options: { 15: '15ש', 30: '30ש', 60: '60ש', 90: '90ש' }, onSet: reset }),
      ctrl(Eo, 'sizeCap', 'עד 16MB לחלק', 'toggle', { onSet: renderPlan }),
      h('p', { class: 'hint' }, 'הסרטון מחולק אוטומטית לחלקים באורך המותר בסטטוס, והחיתוך נעשה ברווח שבין משפטים – אף פעם לא באמצע מילה. הפורמט: MP4 H.264 + AAC, ‏30fps, אנכי מלא – בדיוק מה שוואטסאפ מצפה לו כדי לא לכווץ מחדש.'),
    );
  } else {
    box.append(
      ctrl(Eo, 'fileRes', 'רזולוציה', 'seg', { num: true, options: { 720: '720p', 1080: '1080p', 1440: '2K', 0: 'מקורית' } }),
      ctrl(Eo, 'fileFps', 'פריימים', 'seg', { num: true, options: { 24: '24', 25: '25', 30: '30', 60: '60' } }),
      ctrl(Eo, 'fileQ', 'איכות', 'seg', { options: { med: 'בינונית', high: 'גבוהה', max: 'מקסימלית' } }),
    );
  }
  const rs = h('input', { type: 'number', step: '0.1', value: fmtS(E.rangeS) }), re = h('input', { type: 'number', step: '0.1', value: fmtS(E.rangeE || P.duration) });
  rs.onchange = () => { E.rangeS = Math.max(0, Math.min(+rs.value, E.rangeE - 1)); reset(); };
  re.onchange = () => { E.rangeE = Math.min(P.duration, Math.max(+re.value, E.rangeS + 1)); reset(); };
  box.append(h('div', { class: 'row wrap gap-s mini' }, 'טווח ייצוא:', rs, '→', re,
    h('button', { class: 'btn small', onclick: () => { E.rangeS = video.currentTime; rs.value = fmtS(E.rangeS); reset(); } }, 'התחלה = כאן'),
    h('button', { class: 'btn small', onclick: () => { E.rangeE = video.currentTime; re.value = fmtS(E.rangeE); reset(); } }, 'סוף = כאן')));
  syncControls(); renderPlan();
  if (!supportsExport()) $('#exportResults').innerHTML = '<div class="result status-line err">הדפדפן הזה לא תומך בייצוא וידאו (WebCodecs). פתח ב-Chrome או Edge עדכני (גם בטלפון).</div>';
}
function renderPlan() {
  const box = $('#statusPlan'); box.innerHTML = '';
  const parts = currentParts();
  const [W, H] = exportDims();
  box.append(h('h3', {}, P.exp.target === 'status' ? `חלוקה לסטטוס: ${parts.length} ${parts.length === 1 ? 'חלק' : 'חלקים'}` : 'פרטי ייצוא'));
  const tbl = h('div', { class: 'parts-table' });
  parts.forEach((p, i) => {
    const len = p[1] - p[0];
    const br = P.exp.target === 'status' ? statusBitrate(len, Math.max(W, H), P.exp.sizeCap ? 16 : 0) : 0;
    const row = h('div', { class: 'part-row' }, h('b', {}, `חלק ${i + 1}`));
    if (P.exp.target === 'status' && parts.length > 1 && i > 0) {
      const inp = h('input', { type: 'number', step: '0.1', value: fmtS(p[0]), title: 'נקודת חיתוך' });
      inp.onchange = () => {
        const v = +inp.value; const prev = parts[i - 1], max = Math.min(p[1] - 0.5, prev[0] + P.exp.maxLen);
        const nv = Math.max(prev[0] + 0.5, Math.min(max, v)); prev[1] = nv; p[0] = nv; renderPlan(); needDraw = true;
      };
      row.append('חיתוך ב-', inp, h('button', { class: 'btn small', onclick: () => seek(p[0]) }, '👁'));
    } else row.append(h('span', { style: 'direction:ltr' }, `${fmt(p[0])} → ${fmt(p[1])}`));
    row.append(h('span', { class: 'len' }, `${len.toFixed(1)}s${br ? ' · ~' + (((br + 128000) * len) / 8 / 1048576).toFixed(1) + 'MB' : ''}`));
    if (len > P.exp.maxLen + 0.05 && P.exp.target === 'status') row.style.outline = '1px solid var(--danger)';
    tbl.append(row);
  });
  box.append(tbl, h('div', { class: 'hint' }, `רזולוציה: ${W}×${H}`));
}

let abortCtl = null;
$('#btnCancelExport').onclick = () => abortCtl?.abort();
$('#btnExport').onclick = async () => {
  if (!file) return;
  if (!supportsExport()) return toast('הדפדפן לא תומך בייצוא. נסה Chrome.');
  video.pause();
  const E = P.exp, parts = currentParts();
  const [W, H] = exportDims();
  const res = $('#exportResults'); res.innerHTML = '';
  const prog = $('#exportProgress'), bar = prog.querySelector('.bar'), lbl = prog.querySelector('span');
  prog.classList.remove('hidden'); $('#btnExport').disabled = true;
  abortCtl = new AbortController();
  // וידוא שהגופנים טעונים
  await Promise.all([fontString(P.style, 40), ...P.captions.filter(c => c.o?.fontSize || c.o?.fontFamily).map(c => fontString({ ...P.style, ...c.o }, 40))].map(f => document.fonts.load(f, 'אבג').catch(() => {})));
  const blobs = []; const t0 = performance.now();
  const proj = { ...clone({ captions: P.captions, style: P.style, frame: P.frame, extras: P.extras }), duration: P.duration };
  try {
    for (let i = 0; i < parts.length; i++) {
      const [s, e] = parts[i];
      const fps = E.target === 'status' ? 30 : E.fileFps;
      const vbr = E.target === 'status' ? statusBitrate(e - s, Math.max(W, H), E.sizeCap ? 16 : 0)
        : Math.round(W * H * fps * ({ med: 0.07, high: 0.12, max: 0.2 }[E.fileQ]));
      const blob = await exportVideo({
        file, project: proj, start: s, end: e, W, H, fps, videoBitrate: vbr, logoImg, signal: abortCtl.signal,
        onProgress: p => { const tot = (i + p) / parts.length; bar.style.width = (tot * 100) + '%'; const el = (performance.now() - t0) / 1000; const eta = tot > 0.03 ? el / tot - el : 0; lbl.textContent = `${parts.length > 1 ? `חלק ${i + 1}/${parts.length} · ` : ''}${Math.round(tot * 100)}%${eta ? ` · עוד ~${Math.ceil(eta)} שנ׳` : ''}`; },
      });
      const name = `${baseName()}${parts.length > 1 ? `_חלק${i + 1}` : ''}${E.target === 'status' ? '_סטטוס' : ''}.mp4`;
      const f = new File([blob], name, { type: 'video/mp4' });
      blobs.push(f); res.append(resultCard(f, i, parts.length));
    }
    if (blobs.length > 1) res.prepend(shareAllCard(blobs));
    toast('הייצוא הושלם ✔');
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') toast('הייצוא בוטל');
    else res.append(h('div', { class: 'result status-line err' }, '✖ שגיאה בייצוא: ' + (e.message || e)));
  } finally { prog.classList.add('hidden'); bar.style.width = 0; $('#btnExport').disabled = false; abortCtl = null; }
};
const canShareFiles = files => { try { return !!navigator.canShare && navigator.canShare({ files }); } catch { return false; } };
async function shareFiles(files) {
  if (!canShareFiles(files)) { toast('שיתוף ישיר לא נתמך בדפדפן הזה – מוריד את הקובץ'); files.forEach(f => download(f, f.name)); return; }
  try { await navigator.share({ files }); }
  catch (e) { if (e.name !== 'AbortError') { toast('השיתוף נכשל: ' + e.message); } }
}
function resultCard(f, i, n) {
  const url = URL.createObjectURL(f);
  return h('div', { class: 'result' },
    h('b', {}, n > 1 ? `חלק ${i + 1} מתוך ${n}` : 'הסרטון מוכן'),
    h('video', { src: url, controls: true, playsinline: true }),
    h('div', { class: 'row' },
      h('button', { class: 'btn wa grow', onclick: () => shareFiles([f]) }, '🟢 שתף לוואטסאפ'),
      h('button', { class: 'btn', onclick: () => download(f, f.name) }, '⬇ שמור')),
    h('div', { class: 'hint' }, `${(f.size / 1048576).toFixed(1)}MB · בתפריט השיתוף בחר WhatsApp ← "הסטטוס שלי"`));
}
function shareAllCard(files) {
  return h('div', { class: 'result' },
    h('b', {}, `${files.length} חלקים מוכנים לסטטוס`),
    h('button', { class: 'btn wa block big', onclick: () => shareFiles(files) }, `🟢 שתף את כל ${files.length} החלקים לוואטסאפ`),
    h('div', { class: 'hint' }, 'וואטסאפ יעלה אותם לסטטוס לפי הסדר. אם השיתוף של כמה קבצים יחד לא עובד במכשיר שלך – שתף כל חלק בנפרד למטה.'));
}

// ================== SETTINGS ==================
const dlg = $('#settingsDlg');
fillProviderSelect($('#setProvider'), getSettings().provider);
function openSettings() {
  const s = getSettings();
  $('#setProvider').value = s.provider; fillSettings(s); dlg.showModal();
}
function fillSettings(s) {
  const p = $('#setProvider').value;
  $('#setKey').value = s.keys[p] || '';
  $('#setModel').value = s.models[p] || PROVIDERS[p].model;
  $('#setEndpoint').value = s.endpoint || '';
  $('#setVocab').value = s.vocab || '';
  $('#providerHelp').textContent = PROVIDERS[p].help;
  $('#endpointRow').classList.toggle('hidden', p !== 'custom');
}
$('#setProvider').onchange = () => { const s = getSettings(); fillSettings(s); };
$('#btnSettings').onclick = openSettings;
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok') return;
  const s = getSettings(); const p = $('#setProvider').value;
  s.provider = p; s.keys[p] = $('#setKey').value.trim(); s.models[p] = $('#setModel').value.trim() || PROVIDERS[p].model;
  s.endpoint = $('#setEndpoint').value.trim(); s.vocab = $('#setVocab').value;
  saveSettings(s); $('#providerQuick').value = p; toast('ההגדרות נשמרו ✔');
});

// ================== KEYBOARD ==================
document.addEventListener('keydown', e => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? $('#btnRedo').click() : $('#btnUndo').click(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); $('#btnRedo').click(); }
  else if (inField || !file) return;
  else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') seek(video.currentTime + (e.shiftKey ? 1 : 0.1));
  else if (e.key === 'ArrowRight') seek(video.currentTime - (e.shiftKey ? 1 : 0.1));
});

// ================== INIT ==================
function refreshAll() { sizeCanvas(); renderCaps(); syncControls(); renderFontList(); if (!$('[data-panel=export]').classList.contains('hidden')) renderExport(); needDraw = true; }
buildStyleControls(); buildAnimControls(); buildFramePanel();
loadStoredFonts();
syncControls();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
// קובץ ששותף לאפליקציה (מהגלריה → שתף → כתוביות)
(async () => {
  if (!location.search.includes('shared')) return;
  try {
    const c = await caches.open('kt-share'); const r = await c.match('shared-video');
    if (r) { const b = await r.blob(); const name = r.headers.get('x-name') || 'video.mp4'; await c.delete('shared-video'); history.replaceState(null, '', location.pathname); loadFile(new File([b], decodeURIComponent(name), { type: b.type || 'video/mp4' })); }
  } catch (e) { console.warn(e); }
})();
window.__kt = { P, seek, video, loadFile, renderCaps: () => renderCaps(), commit };
