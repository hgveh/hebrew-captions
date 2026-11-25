// מנוע ציור – משמש גם לתצוגה המקדימה וגם לייצוא, כך שמה שרואים = מה שמקבלים.

export const DEFAULT_STYLE = {
  fontFamily: 'Heebo', fontWeight: 800, italic: false,
  fontSize: 7.2,            // % מרוחב הפריים
  color: '#ffffff', gradient: false, color2: '#ffd60a',
  highlightColor: '#ffd60a', emphColor: '#25d366', emphScale: 1.15,
  strokeColor: '#000000', strokeWidth: 12, // % מגודל הגופן
  shadowColor: '#000000', shadowBlur: 10, shadowX: 0, shadowY: 3, shadowOpacity: 0.7,
  bgMode: 'none', bgColor: '#000000', bgOpacity: 0.65, bgPadding: 22, bgRadius: 30, // padding/radius ב-% מהגופן
  lineHeight: 1.18, letterSpacing: 0, wordSpacing: 1,
  maxWidth: 84, maxLines: 2, balance: true,
  posX: 0.5, posY: 0.72,
  uppercase: false,
  animIn: 'pop', animOut: 'fade', animDur: 0.25, animOutDur: 0.15,
  wordAnim: 'highlight', activeScale: 1.12,
  emojiSize: 1.6, emojiPos: 'above',
};

export const ANIMS_IN = {
  none: 'ללא', fade: 'עמעום', pop: 'פופ', zoomIn: 'זום פנימה', zoomOut: 'זום החוצה',
  slideUp: 'החלקה למעלה', slideDown: 'החלקה למטה', slideRight: 'החלקה ימינה', slideLeft: 'החלקה שמאלה',
  bounce: 'קפיצה', drop: 'נפילה', elastic: 'אלסטי', blur: 'טשטוש', rotate: 'סיבוב', flip: 'היפוך',
  stretch: 'מתיחה', shake: 'רעידה', glitch: 'גליץ׳', swing: 'נדנדה',
  typewriter: 'מכונת כתיבה', staggerPop: 'מילה-מילה פופ', staggerFade: 'מילה-מילה עמעום',
  staggerUp: 'מילה-מילה למעלה', wave: 'גל', cascade: 'מפל',
};
export const ANIMS_OUT = {
  none: 'ללא', fade: 'עמעום', pop: 'פופ החוצה', zoomIn: 'זום', zoomOut: 'התכווצות',
  slideUp: 'החלקה למעלה', slideDown: 'החלקה למטה', slideRight: 'החלקה ימינה', slideLeft: 'החלקה שמאלה',
  blur: 'טשטוש', rotate: 'סיבוב', flip: 'היפוך', glitch: 'גליץ׳', drop: 'נפילה',
};
export const WORD_ANIMS = {
  none: 'ללא', highlight: 'צבע מילה פעילה', karaoke: 'קריוקי (מילוי)', box: 'תיבה סביב מילה',
  scale: 'הגדלת מילה', bounceWord: 'קפיצת מילה', reveal: 'הופעה כשנאמרת', dim: 'עמום עד שנאמרת',
  underline: 'קו תחתון', oneWord: 'מילה אחת בכל פעם', glow: 'זוהר',
};

// ---------- easing ----------
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const eOutCubic = t => 1 - Math.pow(1 - t, 3);
const eOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const eOutElastic = t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
const eOutBounce = t => { const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t; if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375; return n1 * (t -= 2.625 / d1) * t + 0.984375; };

const HEB = /[֐-׿יִ-ﭏ]/;
const STAGGER = new Set(['staggerPop', 'staggerFade', 'staggerUp', 'wave', 'cascade', 'typewriter']);

// טרנספורמציה של כתובית שלמה. p=0 נסתר, p=1 מוצג במלואו
function capTransform(type, p, W, H, out) {
  const r = { alpha: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, blur: 0, glitch: 0 };
  if (p >= 1 || type === 'none' || STAGGER.has(type)) return r;
  const e = eOutCubic(p);
  switch (type) {
    case 'fade': r.alpha = p; break;
    case 'pop': { const s = out ? lerp(0.6, 1, e) : eOutBack(p) * 0.6 + 0.4; r.sx = r.sy = s; r.alpha = clamp(p * 3); break; }
    case 'zoomIn': { const s = out ? lerp(1.5, 1, e) : lerp(1.6, 1, e); r.sx = r.sy = s; r.alpha = p; break; }
    case 'zoomOut': { const s = lerp(0.3, 1, out ? e : eOutBack(p)); r.sx = r.sy = s; r.alpha = p; break; }
    case 'slideUp': r.dy = (out ? -1 : 1) * (1 - e) * H * 0.06; r.alpha = p; if (out) r.dy = -(1 - e) * H * 0.06; break;
    case 'slideDown': r.dy = (out ? 1 : -1) * (1 - e) * H * 0.06; r.alpha = p; break;
    case 'slideRight': r.dx = (out ? 1 : -1) * (1 - e) * W * 0.25; r.alpha = p; break;
    case 'slideLeft': r.dx = (out ? -1 : 1) * (1 - e) * W * 0.25; r.alpha = p; break;
    case 'bounce': r.dy = (1 - eOutBounce(p)) * -H * 0.08; r.alpha = clamp(p * 4); break;
    case 'drop': r.dy = out ? (1 - e) * H * 0.1 : (1 - eOutBounce(p)) * -H * 0.25; r.alpha = clamp(p * 3); break;
    case 'elastic': { const s = eOutElastic(p); r.sx = r.sy = Math.max(0.01, s); r.alpha = clamp(p * 4); break; }
    case 'blur': r.blur = (1 - e) * 18; r.alpha = p; break;
    case 'rotate': r.rot = (1 - e) * (out ? 0.4 : -0.5); r.sx = r.sy = lerp(0.5, 1, e); r.alpha = p; break;
    case 'flip': r.sy = Math.max(0.01, out ? e : eOutBack(p)); r.alpha = clamp(p * 2); break;
    case 'stretch': r.sx = lerp(1.8, 1, eOutElastic(p)); r.sy = lerp(0.4, 1, e); r.alpha = clamp(p * 3); break;
    case 'shake': r.dx = Math.sin(p * 46) * (1 - p) * W * 0.03; r.alpha = clamp(p * 4); break;
    case 'glitch': r.glitch = 1 - p; r.dx = (Math.sin(p * 97) > 0.3 ? 1 : -1) * (1 - p) * W * 0.02; r.alpha = clamp(p * 2.5); break;
    case 'swing': r.rot = Math.sin(p * 14) * (1 - p) * 0.25; r.alpha = clamp(p * 3); break;
  }
  return r;
}

function mergeT(a, b) {
  return { alpha: a.alpha * b.alpha, dx: a.dx + b.dx, dy: a.dy + b.dy, sx: a.sx * b.sx, sy: a.sy * b.sy,
    rot: a.rot + b.rot, blur: a.blur + b.blur, glitch: Math.max(a.glitch, b.glitch) };
}

export function fontString(st, px) {
  return `${st.italic ? 'italic ' : ''}${st.fontWeight} ${Math.max(1, px).toFixed(2)}px "${st.fontFamily}", "Heebo", sans-serif`;
}

// סגנון מילה = סגנון הכתובית + שינויים שנעשו רק למילה הזו
export function wordStyle(st, w) {
  if (!w.o) return st;
  const s = { ...st };
  for (const k in w.o) if (w.o[k] !== '' && w.o[k] != null) s[k] = w.o[k];
  return s;
}

export function effStyle(project, cap) {
  const s = { ...project.style };
  if (cap && cap.o) for (const k in cap.o) if (cap.o[k] !== '' && cap.o[k] != null) s[k] = cap.o[k];
  return s;
}

// ---------- פריסת שורות ----------
function layout(ctx, words, st, W) {
  const fs = st.fontSize / 100 * W;
  ctx.font = fontString(st, fs);
  try { ctx.letterSpacing = (st.letterSpacing / 100 * fs) + 'px'; } catch {}
  let space = ctx.measureText(' ').width * st.wordSpacing;
  // מקום למילה שגדלה כשהיא פעילה – שלא תעלה על השכנות
  if (st.wordAnim === 'scale' || st.wordAnim === 'box') space += fs * Math.max(0, (st.wordAnim === 'box' ? 0.18 : 0) + (st.activeScale - 1) * (st.wordAnim === 'scale' ? 1.6 : 0));
  const items = words.map((w, i) => {
    const ws = wordStyle(st, w);
    let txt = ws.uppercase ? w.t.toUpperCase() : w.t;
    const wfs = ws.fontSize / 100 * W * (w.emph ? ws.emphScale : 1);
    ctx.font = fontString(ws, wfs);
    try { ctx.letterSpacing = (ws.letterSpacing / 100 * wfs) + 'px'; } catch {}
    return { i, w, ws, txt, fs: wfs, width: ctx.measureText(txt).width };
  });
  ctx.font = fontString(st, fs);
  try { ctx.letterSpacing = (st.letterSpacing / 100 * fs) + 'px'; } catch {}
  const maxW = st.maxWidth / 100 * W;
  // שבירה חמדנית
  let lines = []; let cur = []; let cw = 0;
  for (const it of items) {
    const add = cur.length ? space + it.width : it.width;
    if (cur.length && cw + add > maxW) { lines.push(cur); cur = [it]; cw = it.width; }
    else { cur.push(it); cw += add; }
  }
  if (cur.length) lines.push(cur);
  // איזון שורות
  if (st.balance && lines.length > 1 && items.length <= 30) {
    const n = lines.length, N = items.length;
    const wsum = (a, b) => { let s = 0; for (let k = a; k < b; k++) s += items[k].width + (k > a ? space : 0); return s; };
    // DP: מזער את רוחב השורה המקסימלי
    const memo = new Map();
    const solve = (start, left) => {
      const key = start + ',' + left; if (memo.has(key)) return memo.get(key);
      let best = { cost: Infinity, cuts: [] };
      if (left === 1) { const w = wsum(start, N); best = { cost: w, cuts: [] }; }
      else for (let e = start + 1; e <= N - left + 1; e++) {
        const w = wsum(start, e); if (w > maxW && e > start + 1) break;
        const sub = solve(e, left - 1); const c = Math.max(w, sub.cost);
        if (c < best.cost) best = { cost: c, cuts: [e, ...sub.cuts] };
      }
      memo.set(key, best); return best;
    };
    const res = solve(0, n);
    if (res.cost <= Math.max(maxW, ...lines.map(l => l.reduce((s, it, k) => s + it.width + (k ? space : 0), 0)))) {
      const b = [0, ...res.cuts, N]; lines = [];
      for (let k = 0; k < b.length - 1; k++) lines.push(items.slice(b[k], b[k + 1]));
    }
  }
  const rtl = words.some(w => HEB.test(w.t));
  const lh = fs * st.lineHeight;
  const lhs = lines.map(ln => Math.max(lh, ...ln.map(it => it.fs * st.lineHeight)));
  const total = lhs.reduce((a, b) => a + b, 0);
  let yAcc = -total / 2;
  const out = lines.map((ln, li) => {
    const width = ln.reduce((s, it, k) => s + it.width + (k ? space : 0), 0);
    let x = rtl ? width / 2 : -width / 2;
    const placed = ln.map(it => {
      let left;
      if (rtl) { left = x - it.width; x = left - space; } else { left = x; x += it.width + space; }
      return { ...it, left, cx: left + it.width / 2 };
    });
    const y = yAcc + lhs[li] / 2; yAcc += lhs[li];
    return { items: placed, width, y, lh: lhs[li] };
  });
  return { lines: out, fs, lh, space, rtl, height: total, width: Math.max(0, ...out.map(l => l.width)) };
}

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
}

function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

// ---------- ציור כתובית ----------
export function drawCaption(ctx, W, H, t, cap, project, opts = {}) {
  const st = effStyle(project, cap);
  if (!cap.words?.length) return;
  const words = st.wordAnim === 'oneWord' ? currentWordOnly(cap, t) : cap.words;
  if (!words.length) return;
  const L = layout(ctx, words, st, W);
  const pIn = clamp((t - cap.s) / Math.max(0.001, st.animDur));
  const pOut = clamp((cap.e - t) / Math.max(0.001, st.animOutDur));
  const T = mergeT(capTransform(st.animIn, pIn, W, H, false), capTransform(st.animOut, pOut, W, H, true));
  const fs = L.fs;
  const cx = st.posX * W, cy = st.posY * H;

  ctx.save();
  ctx.translate(cx + T.dx, cy + T.dy);
  if (T.rot) ctx.rotate(T.rot);
  if (T.sx !== 1 || T.sy !== 1) ctx.scale(T.sx, T.sy);
  ctx.globalAlpha = T.alpha;
  if (T.blur > 0.2) ctx.filter = `blur(${T.blur * W / 720}px)`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.direction = L.rtl ? 'rtl' : 'ltr';
  try { ctx.letterSpacing = (st.letterSpacing / 100 * fs) + 'px'; } catch {}

  const pad = st.bgPadding / 100 * fs, rad = st.bgRadius / 100 * fs;
  if (st.bgMode === 'block' && L.width > 0) {
    ctx.fillStyle = hexA(st.bgColor, st.bgOpacity);
    rr(ctx, -L.width / 2 - pad, -L.height / 2 - pad * 0.6, L.width + pad * 2, L.height + pad * 1.2, rad);
    ctx.fill();
  }
  if (st.bgMode === 'line') {
    ctx.fillStyle = hexA(st.bgColor, st.bgOpacity);
    for (const ln of L.lines) { rr(ctx, -ln.width / 2 - pad, ln.y - ln.lh / 2 - pad * 0.15, ln.width + pad * 2, ln.lh + pad * 0.3, rad); ctx.fill(); }
  }

  // תווים למכונת כתיבה
  const totalChars = words.reduce((s, w) => s + w.t.length, 0);
  let charBudget = st.animIn === 'typewriter' ? Math.floor(clamp((t - cap.s) / Math.max(0.05, Math.min(cap.e - cap.s, totalChars * 0.045))) * totalChars + 0.0001) : Infinity;
  const nW = words.length;
  let order = 0;

  for (const ln of L.lines) {
    for (const it of ln.items) {
      const w = it.w, ws = it.ws;
      const idx = order++;
      let alpha = 1, scale = 1, dy = 0, color = w.emph ? ws.emphColor : null, box = false, underline = 0, glow = 0, karaFill = -1;
      const spoken = t >= w.s, active = t >= w.s && t < w.e;
      const wp = clamp((t - w.s) / Math.max(0.05, w.e - w.s));

      // אנימציות כניסה בדירוג מילים
      if (STAGGER.has(st.animIn) && st.animIn !== 'typewriter') {
        const per = Math.max(st.animDur, 0.12);
        const spread = Math.min((cap.e - cap.s) * 0.5, per * nW * 0.6);
        const start = cap.s + (nW > 1 ? idx / (nW - 1) * spread : 0);
        const p = clamp((t - start) / per);
        if (st.animIn === 'staggerPop') { scale *= Math.max(0.01, eOutBack(p)); alpha *= clamp(p * 3); }
        if (st.animIn === 'staggerFade') alpha *= p;
        if (st.animIn === 'staggerUp') { dy += (1 - eOutCubic(p)) * fs * 0.8; alpha *= p; }
        if (st.animIn === 'cascade') { dy -= (1 - eOutBounce(p)) * fs * 1.2; alpha *= clamp(p * 3); }
        if (st.animIn === 'wave') { alpha *= clamp(p * 3); dy += Math.sin((t * 6) - idx * 0.8) * fs * 0.08 + (1 - eOutCubic(p)) * fs * 0.5; }
      }

      switch (st.wordAnim) {
        case 'highlight': if (active) color = ws.highlightColor; break;
        case 'karaoke': if (active) karaFill = wp; else if (spoken) color = ws.highlightColor; break;
        case 'box': if (active) box = true; break;
        case 'scale': if (active) { const k = eOutBack(clamp(wp * 4)); scale *= lerp(1, st.activeScale, k); color = ws.highlightColor; } break;
        case 'bounceWord': if (active) { dy -= Math.sin(clamp(wp * 2) * Math.PI) * fs * 0.25; color = ws.highlightColor; } break;
        case 'reveal': if (!spoken) alpha = 0; else { const k = clamp((t - w.s) / 0.15); scale *= lerp(0.6, 1, eOutBack(k)); alpha *= k; } break;
        case 'dim': if (!spoken) alpha *= 0.35; else if (active) color = ws.highlightColor; break;
        case 'underline': if (active) underline = eOutCubic(clamp(wp * 3)); break;
        case 'oneWord': { const k = clamp((t - w.s) / 0.12); scale *= lerp(0.7, 1, eOutBack(k)); break; }
        case 'glow': if (active) glow = 1; break;
      }

      if (alpha <= 0.001) continue;
      // מכונת כתיבה
      let txt = it.txt;
      if (charBudget !== Infinity) {
        if (charBudget <= 0) continue;
        if (charBudget < txt.length) txt = txt.slice(0, charBudget);
        charBudget -= it.txt.length;
      }

      ctx.save();
      ctx.translate(it.cx, ln.y + dy);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = T.alpha * alpha;
      const wfs = it.fs;
      ctx.font = fontString(ws, wfs);
      try { ctx.letterSpacing = (ws.letterSpacing / 100 * wfs) + 'px'; } catch {}
      let left = -it.width / 2;
      if (txt !== it.txt && L.rtl) left = it.width / 2 - ctx.measureText(txt).width;

      if (box) {
        const bp = wfs * 0.14;
        ctx.save(); ctx.shadowColor = 'transparent';
        ctx.fillStyle = ws.highlightColor;
        rr(ctx, left - bp * 1.4, -ln.lh / 2 + bp * 0.2, it.width + bp * 2.8, ln.lh - bp * 0.4, wfs * 0.18); ctx.fill();
        ctx.restore();
      }
      const fillCol = box ? contrast(ws.highlightColor) : (color || ws.color);
      const opt = { glitch: T.glitch, glow, karaFill, partial: txt !== it.txt };
      drawText(ctx, txt, left, it.width, wfs, ws, fillCol, opt, box);
      if (opts.selWord === w) { ctx.save(); ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = Math.max(2, wfs * 0.05); ctx.setLineDash([wfs * 0.15, wfs * 0.1]); rr(ctx, left - wfs * 0.12, -ln.lh / 2, it.width + wfs * 0.24, ln.lh, wfs * 0.15); ctx.stroke(); ctx.restore(); }
      if (underline > 0) {
        ctx.fillStyle = ws.highlightColor; ctx.shadowColor = 'transparent';
        const uw = it.width * underline;
        rr(ctx, L.rtl ? left + it.width - uw : left, wfs * 0.5, uw, wfs * 0.09, wfs * 0.05); ctx.fill();
      }
      ctx.restore();
    }
  }

  // אימוג׳י
  if (cap.emoji) {
    const es = fs * st.emojiSize;
    const k = clamp((t - cap.s) / 0.35);
    ctx.save();
    ctx.globalAlpha = T.alpha * clamp(k * 2);
    const y = st.emojiPos === 'below' ? L.height / 2 + es * 0.65 : -L.height / 2 - es * 0.65;
    ctx.translate(0, y);
    const s = eOutBack(k); ctx.scale(s, s);
    ctx.rotate(Math.sin(t * 3) * 0.08);
    ctx.font = `${es}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.direction = 'ltr';
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = es * 0.15;
    ctx.fillText(cap.emoji, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function contrast(hex) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const l = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#000000' : '#ffffff';
}

function drawText(ctx, txt, left, width, fs, st, fillCol, o, noStroke) {
  const sw = noStroke ? 0 : st.strokeWidth / 100 * fs;
  const hasShadow = st.shadowOpacity > 0 && (st.shadowBlur > 0 || st.shadowX || st.shadowY);
  const setShadow = on => {
    if (on && hasShadow) {
      ctx.shadowColor = hexA(st.shadowColor, st.shadowOpacity);
      ctx.shadowBlur = st.shadowBlur / 100 * fs * 2; ctx.shadowOffsetX = st.shadowX / 100 * fs; ctx.shadowOffsetY = st.shadowY / 100 * fs;
    } else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
  };
  if (o.glitch > 0.02) {
    const off = fs * 0.08 * o.glitch;
    ctx.save(); setShadow(false); ctx.globalAlpha *= 0.8;
    ctx.fillStyle = '#ff004c'; ctx.fillText(txt, left - off, -off * 0.3);
    ctx.fillStyle = '#00e5ff'; ctx.fillText(txt, left + off, off * 0.3);
    ctx.restore();
  }
  if (o.glow) {
    ctx.save(); ctx.shadowColor = st.highlightColor; ctx.shadowBlur = fs * 0.6; ctx.fillStyle = st.highlightColor;
    ctx.fillText(txt, left, 0); ctx.fillText(txt, left, 0); ctx.restore();
  }
  if (sw > 0) {
    setShadow(true);
    ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = sw * 2; ctx.strokeStyle = st.strokeColor;
    ctx.strokeText(txt, left, 0);
    setShadow(false);
  } else setShadow(true);

  let fill = o.glow ? '#ffffff' : fillCol;
  if (st.gradient && fillCol === st.color) {
    const g = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, st.color); g.addColorStop(1, st.color2); fill = g;
  }
  ctx.fillStyle = fill;
  ctx.fillText(txt, left, 0);
  if (o.karaFill >= 0) {
    // מילוי קריוקי – מימין לשמאל בעברית
    const rtl = HEB.test(txt);
    ctx.save(); setShadow(false);
    ctx.beginPath();
    const fw = width * o.karaFill;
    ctx.rect(rtl ? left + width - fw : left, -fs, fw, fs * 2); ctx.clip();
    ctx.fillStyle = st.highlightColor; ctx.fillText(txt, left, 0);
    ctx.restore();
  }
  setShadow(false);
}

function currentWordOnly(cap, t) {
  let w = cap.words.find(w => t >= w.s && t < w.e);
  if (!w) { const past = cap.words.filter(w => w.s <= t); w = past[past.length - 1] || cap.words[0]; }
  return [w];
}

// ---------- רקע / מסגור ----------
export function drawSource(ctx, src, sw, sh, W, H, frame) {
  ctx.fillStyle = frame.bgColor || '#000'; ctx.fillRect(0, 0, W, H);
  if (!src || !sw || !sh) return;
  const zoom = frame.zoom || 1;
  if (frame.fit === 'contain') {
    if (frame.bgBlur) {
      const s = Math.max(W / sw, H / sh) * 1.15;
      ctx.save(); ctx.filter = `blur(${Math.round(W / 22)}px) brightness(0.7)`;
      ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s); ctx.restore();
    }
    const s = Math.min(W / sw, H / sh) * zoom;
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(src, (W - dw) * frame.cx, (H - dh) * frame.cy, dw, dh);
  } else {
    const s = Math.max(W / sw, H / sh) * zoom;
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(src, (W - dw) * frame.cx, (H - dh) * frame.cy, dw, dh);
  }
}

export function frameGeom(sw, sh, W, H, frame) {
  const s = (frame.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh)) * (frame.zoom || 1);
  return { dw: sw * s, dh: sh * s };
}

// ---------- פריים מלא ----------
export function renderFrame(ctx, W, H, t, project, src, sw, sh, logoImg, opts = {}) {
  drawSource(ctx, src, sw, sh, W, H, project.frame);
  const caps = project.captions;
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if (t >= c.s && t < c.e) drawCaption(ctx, W, H, t, c, project, opts);
  }
  const x = project.extras || {};
  if (x.progressBar && project.duration) {
    const p = clamp(t / project.duration);
    const h = Math.max(4, H * 0.008);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, x.pbTop ? 0 : H - h, W, h);
    ctx.fillStyle = x.pbColor || '#25d366';
    ctx.fillRect(W - W * p, x.pbTop ? 0 : H - h, W * p, h);
  }
  if (logoImg && x.logo) {
    const lw = W * x.logo.size / 100, lh = lw * logoImg.naturalHeight / logoImg.naturalWidth;
    ctx.save(); ctx.globalAlpha = x.logo.opacity;
    ctx.drawImage(logoImg, (W - lw) * x.logo.x, (H - lh) * x.logo.y, lw, lh); ctx.restore();
  }
  if (x.watermark) {
    ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
    ctx.font = `700 ${W * 0.035}px Heebo, sans-serif`; ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
    ctx.fillText(x.watermark, W / 2, H * 0.06); ctx.restore();
  }
}

// לבדיקת לחיצה על כתובית
export function wordBoxes(ctx, W, H, cap, project) {
  const st = effStyle(project, cap);
  if (!cap.words?.length || st.wordAnim === 'oneWord') return [];
  const L = layout(ctx, cap.words, st, W);
  const cx = st.posX * W, cy = st.posY * H, out = [];
  for (const ln of L.lines) for (const it of ln.items) out.push({ w: it.w, x: cx + it.left, y: cy + ln.y - ln.lh / 2, wd: it.width, h: ln.lh });
  return out;
}

export function captionBounds(ctx, W, H, cap, project) {
  const st = effStyle(project, cap);
  const L = layout(ctx, cap.words, st, W);
  return { x: st.posX * W - L.width / 2, y: st.posY * H - L.height / 2, w: L.width, h: L.height };
}
