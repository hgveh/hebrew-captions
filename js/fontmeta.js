// קריאת שם משפחה ומשקל מתוך קובץ הגופן עצמו (TTF/OTF), כולל תיקון קבצים שמסומנים לא נכון
const WEIGHT_WORDS = [
  [/(ultra|extra)\s*black|black\s*extra|ultrablack|extrablack|extrim|extreme|fat/i, 950],
  [/black|heavy\s*black/i, 900],
  [/(extra|ultra)\s*bold|extrabold|ultrabold|heavy/i, 800],
  [/(semi|demi)\s*bold|semibold|demibold/i, 600],
  [/bold/i, 700],
  [/medium|mid\b/i, 500],
  [/(extra|ultra)\s*light|extralight|ultralight/i, 200],
  [/thin|hairline/i, 100],
  [/light/i, 300],
  [/regular|normal|book|roman|plain/i, 400],
];
export const WEIGHT_NAMES = { 100: 'דק מאוד', 200: 'דק+', 300: 'דק', 400: 'רגיל', 500: 'בינוני', 600: 'חצי-בולט', 700: 'בולט', 800: 'בולט מאוד', 900: 'שחור', 950: 'שחור+' };

export function weightFromWords(s) {
  if (!s) return null;
  for (const [re, w] of WEIGHT_WORDS) if (re.test(s)) return w;
  return null;
}
const SUFFIX = /[\s_-]*((ultra|extra)\s*black|ultrablack|extrablack|black|heavy|(extra|ultra|semi|demi)\s*bold|extrabold|semibold|demibold|bold|medium|(extra|ultra)\s*light|extralight|light|thin|regular|extrim)$/i;

function readNames(dv, off) {
  const count = dv.getUint16(off + 2), strOff = off + dv.getUint16(off + 4);
  const out = {}; const prio = {};
  for (let i = 0; i < count; i++) {
    const r = off + 6 + i * 12;
    const pid = dv.getUint16(r), eid = dv.getUint16(r + 2), lang = dv.getUint16(r + 4), id = dv.getUint16(r + 6), len = dv.getUint16(r + 8), o = dv.getUint16(r + 10);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    let s = '';
    const base = strOff + o;
    if (pid === 3 || pid === 0) { for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(base + k)); }
    else if (pid === 1 && eid === 0) { for (let k = 0; k < len; k++) s += String.fromCharCode(dv.getUint8(base + k)); }
    else continue;
    const p = pid === 3 && lang === 0x409 ? 3 : pid === 3 ? 2 : pid === 1 ? 1 : 0;
    if (!(id in prio) || p > prio[id]) { prio[id] = p; out[id] = s.replace(/\0/g, '').trim(); }
  }
  return out;
}

export function parseFont(buf, fileName = '') {
  const dv = new DataView(buf);
  let base = 0;
  const tag = dv.getUint32(0);
  if (tag === 0x74746366) base = dv.getUint32(12); // ttcf → הגופן הראשון
  else if (tag === 0x774F4646 || tag === 0x774F4632) return fromFileName(fileName); // WOFF/WOFF2
  const n = dv.getUint16(base + 4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16;
    const t = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3));
    tables[t] = dv.getUint32(r + 8);
  }
  const names = tables.name != null ? readNames(dv, tables.name) : {};
  let osW = 400, italicBit = false, boldBit = false;
  if (tables['OS/2'] != null) { osW = dv.getUint16(tables['OS/2'] + 4); const fs = dv.getUint16(tables['OS/2'] + 62); italicBit = !!(fs & 1); boldBit = !!(fs & 32); }
  if (tables.head != null) { const ms = dv.getUint16(tables.head + 44); boldBit = boldBit || !!(ms & 1); italicBit = italicBit || !!(ms & 2); }
  let family = names[16] || names[1] || fileName.replace(/\.[^.]+$/, '');
  const sub = names[17] || names[2] || '';
  const full = names[4] || '';
  let weight = weightFromWords(sub);
  // משקל שמופיע בשם המשפחה עצמו (למשל "HardufBlack" / "EFT_Nefesh UltraBlack")
  const m = family.match(SUFFIX);
  if (m && m.index > 1) {
    const fw = weightFromWords(m[1]);
    family = family.slice(0, m.index).trim();
    if (weight == null || weight === 400) weight = fw;
  }
  if (weight == null || (weight === 400 && /regular|normal|book/i.test(sub) === false)) {
    const fromFull = weightFromWords(full.replace(family, ''));
    if (fromFull) weight = fromFull;
  }
  if (weight == null) {
    let w = osW < 10 ? osW * 100 : osW; // יש קבצים שמסמנים 4 במקום 400
    if (w < 100 || w > 1000) w = 400;
    weight = w === 400 && boldBit ? 700 : w;
  }
  const italic = /italic|oblique|נטוי/i.test(sub) || italicBit;
  return { family: family.trim(), weight, style: italic ? 'italic' : 'normal', sub, full };
}

function fromFileName(fileName) {
  let base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  let weight = 400; const m = base.match(/[\s-]+([A-Za-z]+)$/);
  if (m) { const w = weightFromWords(m[1]); if (w) { weight = w; base = base.slice(0, m.index); } }
  return { family: base.trim(), weight, style: /italic|oblique/i.test(fileName) ? 'italic' : 'normal' };
}

// איחוד משפחות שנקראות "AhlaB" / "Ahla" (אות אחת בסוף = משקל) – רק אם משפחת הבסיס קיימת
export function mergeLetterSuffix(metas, known = []) {
  const fams = new Set([...known, ...metas.map(m => m.family)]);
  for (const m of metas) {
    const mm = m.family.match(/^(.*[a-zא-ת])([BLMH])$/);
    if (mm && fams.has(mm[1])) { m.family = mm[1]; if (m.weight === 400) m.weight = { B: 700, L: 300, M: 500, H: 800 }[mm[2]]; }
  }
  return metas;
}

// קורא ZIP (stored / deflate) – כדי לייבא חבילת גופנים בקובץ אחד
export async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('קובץ ZIP לא תקין');
  const cnt = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < cnt; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const flags = dv.getUint16(p + 8, true);
    const lho = dv.getUint32(p + 42, true);
    const nameBytes = u8.subarray(p + 46, p + 46 + nlen);
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8').decode(nameBytes);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = u8.slice(ds, ds + csize);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ name: name.split('/').pop(), data: bytes.buffer });
  }
  return out;
}
