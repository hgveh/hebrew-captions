// תמלול: חילוץ אודיו במכשיר → שליחה לספק → מילים עם תזמונים → חלוקה לכתוביות
import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from './vendor/mediabunny.min.mjs';

export const PROVIDERS = {
  elevenlabs: {
    name: 'ElevenLabs Scribe (מומלץ – הכי מדויק לעברית)', model: 'scribe_v1',
    help: 'הדיוק הגבוה ביותר לעברית כולל פיסוק ותזמון לכל מילה. מפתח ב-elevenlabs.io → Profile → API Keys.',
  },
  openai: {
    name: 'OpenAI Whisper', model: 'whisper-1',
    help: 'מפתח ב-platform.openai.com. מגבלה: עד ~13 דקות אודיו בקובץ.',
  },
  groq: {
    name: 'Groq Whisper large-v3 (מהיר וזול)', model: 'whisper-large-v3',
    help: 'מהיר מאוד, יש שכבה חינמית. מפתח ב-console.groq.com.',
  },
  custom: {
    name: 'שרת משלך (למשל ivrit.ai)', model: 'ivrit-ai/whisper-large-v3-turbo',
    help: 'כל שרת שתואם ל-OpenAI (‎/v1/audio/transcriptions‎) – למשל מודל ivrit.ai שמותאם במיוחד לעברית, מותקן על השרת שלך.',
  },
};

export function getSettings() {
  const d = { provider: 'elevenlabs', keys: {}, models: {}, endpoint: '', vocab: '' };
  try { return { ...d, ...JSON.parse(localStorage.getItem('kt_settings') || '{}') }; } catch { return d; }
}
export function saveSettings(s) { localStorage.setItem('kt_settings', JSON.stringify(s)); }

// ---------- חילוץ אודיו ל-WAV מונו 16kHz ----------
export async function extractWav(file, onProgress) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const at = await input.getPrimaryAudioTrack();
  if (!at) throw new Error('לסרטון אין פס קול');
  const dur = await input.computeDuration();
  const SR = 16000;
  const total = Math.ceil(dur * SR) + SR;
  const mono = new Float32Array(total);
  const sink = new AudioBufferSink(at);
  let maxEnd = 0;
  for await (const { buffer, timestamp } of sink.buffers()) {
    // ממצעים ערוצים ודוגמים מחדש ידנית (לינארי)
    const ch = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
    const data = []; for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    const startOut = Math.round(timestamp * SR);
    const outLen = Math.floor(n * SR / sr);
    for (let i = 0; i < outLen; i++) {
      const pos = i * sr / SR, i0 = Math.floor(pos), fr = pos - i0, i1 = Math.min(n - 1, i0 + 1);
      let v = 0; for (let c = 0; c < ch; c++) v += data[c][i0] * (1 - fr) + data[c][i1] * fr;
      const o = startOut + i; if (o >= 0 && o < total) mono[o] = v / ch;
    }
    maxEnd = Math.max(maxEnd, startOut + outLen);
    onProgress?.(Math.min(1, timestamp / dur));
  }
  const len = Math.min(total, maxEnd);
  // נרמול עדין
  let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const g = peak > 0 && peak < 0.5 ? 0.9 / peak : 1;
  const buf = new ArrayBuffer(44 + len * 2); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i] * g)) * 32767, true);
  return { blob: new Blob([buf], { type: 'audio/wav' }), duration: dur };
}

// ---------- ספקים ----------
export async function transcribe(file, settings, onStatus) {
  const p = settings.provider;
  const key = settings.keys[p] || '';
  if (!key && p !== 'custom') throw new Error('חסר מפתח API – פתח ⚙ הגדרות');
  onStatus?.('מחלץ אודיו מהסרטון…');
  const { blob } = await extractWav(file, pr => onStatus?.(`מחלץ אודיו… ${Math.round(pr * 100)}%`));
  const mb = (blob.size / 1048576).toFixed(1);
  onStatus?.(`שולח ${mb}MB לתמלול… (זה יכול לקחת דקה)`);
  const model = settings.models[p] || PROVIDERS[p].model;
  let words;
  if (p === 'elevenlabs') words = await elevenlabs(blob, key, model, settings.vocab);
  else {
    const url = p === 'openai' ? 'https://api.openai.com/v1/audio/transcriptions'
      : p === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : settings.endpoint;
    if (!url) throw new Error('חסרה כתובת שרת בהגדרות');
    words = await openaiLike(url, blob, key, model, settings.vocab);
  }
  if (!words.length) throw new Error('לא זוהה דיבור בסרטון');
  return words;
}

async function elevenlabs(blob, key, model, vocab) {
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model_id', model);
  fd.append('language_code', 'heb');
  fd.append('timestamps_granularity', 'word');
  fd.append('tag_audio_events', 'false');
  if (vocab) vocab.split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 100).forEach(k => fd.append('keyterms', k));
  let r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  if (!r.ok && vocab) { // אם המודל לא תומך במונחים – ננסה בלי
    fd.delete('keyterms');
    r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  }
  if (!r.ok) throw new Error('ElevenLabs: ' + (await errText(r)));
  const j = await r.json();
  return (j.words || []).filter(w => w.type === 'word' || (!w.type && w.text?.trim()))
    .map(w => ({ t: w.text.trim(), s: w.start, e: w.end })).filter(w => w.t);
}

async function openaiLike(url, blob, key, model, vocab) {
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model', model);
  fd.append('language', 'he');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  if (vocab) fd.append('prompt', vocab.slice(0, 800));
  const headers = key ? { Authorization: 'Bearer ' + key } : {};
  const r = await fetch(url, { method: 'POST', headers, body: fd });
  if (!r.ok) throw new Error(await errText(r));
  const j = await r.json();
  let words = (j.words || []).map(w => ({ t: (w.word || w.text || '').trim(), s: w.start, e: w.end })).filter(w => w.t);
  if (!words.length && j.segments) {
    // אין תזמון מילים – מחלקים כל מקטע באופן יחסי
    for (const sg of j.segments) words.push(...spreadWords(sg.text, sg.start, sg.end));
  } else if (j.text) words = restorePunctuation(words, j.text);
  return words;
}

async function errText(r) {
  try { const j = await r.json(); return j.error?.message || j.detail?.message || j.detail || JSON.stringify(j); } catch { return r.status + ' ' + r.statusText; }
}

const norm = s => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
// Whisper מחזיר מילים בלי פיסוק – משחזרים מהטקסט המלא
function restorePunctuation(words, text) {
  const toks = text.split(/\s+/).filter(Boolean);
  let j = 0;
  return words.map(w => {
    const nw = norm(w.t);
    for (let k = j; k < Math.min(toks.length, j + 4); k++) {
      if (norm(toks[k]) === nw) { j = k + 1; return { ...w, t: toks[k] }; }
    }
    return w;
  });
}

export function spreadWords(text, s, e) {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const total = toks.reduce((a, t) => a + t.length + 1, 0);
  let acc = s; const span = Math.max(0.1, e - s);
  return toks.map(t => { const d = span * (t.length + 1) / total; const w = { t, s: acc, e: acc + d * 0.95 }; acc += d; return w; });
}

// ---------- חלוקה לכתוביות ----------
let _id = 1;
export const newId = () => 'c' + (Date.now().toString(36)) + (_id++);

export function segment(words, { maxWords = 4, maxChars = 24, punct = true, pause = 0.55 } = {}) {
  const caps = []; let cur = [];
  const flush = () => { if (cur.length) caps.push({ id: newId(), s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = { ...words[i] };
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const chars = cur.reduce((a, x) => a + x.t.length + 1, 0) + w.t.length;
      if (cur.length >= maxWords || chars > maxChars || (w.s - prev.e) > pause || (punct && /[.!?…:;,]$/.test(prev.t) && cur.length >= 1 && !(cur.length === 1 && prev.t.length <= 2))) flush();
    }
    cur.push(w);
  }
  flush();
  // השלמת פערים קטנים ומינימום משך
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i], n = caps[i + 1];
    if (n && n.s - c.e < 0.35) c.e = n.s;
    if (c.e - c.s < 0.5) c.e = Math.min(c.s + 0.5, n ? n.s : c.s + 0.5);
  }
  return caps;
}

export const FILLERS = ['אממ', 'אמ', 'אממממ', 'אהה', 'אה', 'אהם', 'ממ', 'מממ', 'אֶה', 'אההה', 'אום', 'אמממ', 'הממ', 'אהמ', 'um', 'uh', 'umm', 'uhm', 'hmm', 'אהההה', 'אמם'];
