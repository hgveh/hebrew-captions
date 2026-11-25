// ייצוא MP4 (H.264 + AAC) ישירות בדפדפן עם WebCodecs
import {
  Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink,
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  canEncodeVideo, canEncodeAudio,
} from './vendor/mediabunny.min.mjs';
import { renderFrame } from './renderer.js';

export function supportsExport() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// חלוקת הסרטון לחלקים לסטטוס – חיתוך ברווחים שבין משפטים, לא באמצע מילה
export function planStatusParts(duration, captions, maxLen, range = [0, duration]) {
  const [A, B] = range;
  const total = B - A;
  if (total <= maxLen + 0.01) return [[A, B]];
  const n = Math.ceil(total / maxLen);
  const target = total / n;
  // נקודות חיתוך אפשריות: אמצע רווח בין כתוביות
  const caps = captions.filter(c => c.e > A && c.s < B).sort((a, b) => a.s - b.s);
  const cands = [];
  for (let i = 0; i < caps.length - 1; i++) {
    const gapS = caps[i].e, gapE = caps[i + 1].s;
    const last = caps[i].words[caps[i].words.length - 1]?.t || '';
    const sentence = /[.!?…]$/.test(last) ? 1 : /[,;:]$/.test(last) ? 0.5 : 0;
    // גבול המילים בפועל
    const wEnd = caps[i].words[caps[i].words.length - 1]?.e ?? gapS;
    const wStart = caps[i + 1].words[0]?.s ?? gapE;
    const t = (wEnd + wStart) / 2;
    cands.push({ t, gap: Math.max(0, wStart - wEnd), sentence });
  }
  const parts = []; let start = A;
  while (B - start > maxLen + 0.01) {
    const ideal = start + Math.min(maxLen, Math.max(target, (B - start) / Math.ceil((B - start) / maxLen)));
    const lo = start + maxLen * 0.45, hi = start + maxLen - 0.05;
    let best = null, bestScore = -Infinity;
    for (const c of cands) {
      if (c.t <= lo || c.t >= hi) continue;
      const score = Math.min(c.gap, 1.2) * 3 + c.sentence * 2.5 - Math.abs(c.t - ideal) / maxLen * 6;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    const cut = best ? best.t : hi;
    parts.push([start, cut]); start = cut;
  }
  parts.push([start, B]);
  return parts;
}

export async function exportVideo({ file, project, start, end, W, H, fps, videoBitrate, audioBitrate = 128000, logoImg, onProgress, signal }) {
  W = W & ~1; H = H & ~1;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error('לא נמצא ערוץ וידאו');
  const at = await input.getPrimaryAudioTrack();

  if (!(await canEncodeVideo('avc', { width: W, height: H, bitrate: videoBitrate }))) {
    throw new Error('הדפדפן לא תומך בקידוד H.264. נסה Chrome / Edge עדכני.');
  }
  const audioOk = at && await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: audioBitrate });

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vs = new CanvasSource(canvas, { codec: 'avc', bitrate: videoBitrate, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(vs, { frameRate: fps });
  let as = null;
  if (audioOk) { as = new AudioBufferSource({ codec: 'aac', bitrate: audioBitrate }); output.addAudioTrack(as); }
  await output.start();

  // דגימת המקור ברזולוציה מתאימה (מהיר יותר)
  const sw = vt.displayWidth, sh = vt.displayHeight;
  const sinkScale = Math.min(1, Math.max(W / sw, H / sh) * (project.frame.zoom || 1) * 1.05);
  const sink = new CanvasSink(vt, { width: Math.round(sw * Math.max(sinkScale, 0.25)), poolSize: 3 });
  const total = Math.max(1, Math.round((end - start) * fps));

  const videoTask = (async () => {
    function* times() { for (let i = 0; i < total; i++) yield start + (i + 0.5) / fps; }
    let i = 0, src = null;
    for await (const wc of sink.canvasesAtTimestamps(times())) {
      if (signal?.aborted) throw new DOMException('בוטל', 'AbortError');
      if (wc) src = wc.canvas;
      const t = start + i / fps;
      renderFrame(ctx, W, H, t, project, src, src?.width, src?.height, logoImg);
      await vs.add(i / fps, 1 / fps);
      i++;
      if (i % 5 === 0) onProgress?.(i / total);
    }
    // אם המקור קצר מהמתוכנן – משלימים פריימים
    while (i < total) { renderFrame(ctx, W, H, start + i / fps, project, src, src?.width, src?.height, logoImg); await vs.add(i / fps, 1 / fps); i++; }
    vs.close();
  })();

  const audioTask = (async () => {
    if (!as) return;
    const asink = new AudioBufferSink(at);
    let first = true;
    for await (const { buffer, timestamp, duration } of asink.buffers(start, end)) {
      if (signal?.aborted) throw new DOMException('בוטל', 'AbortError');
      let b = buffer, ts = timestamp;
      const sr = b.sampleRate;
      // חיתוך תחילת/סוף החלק
      const cutStart = Math.max(0, Math.round((start - ts) * sr));
      const cutEnd = Math.max(0, Math.round((ts + duration - end) * sr));
      if (cutStart > 0 || cutEnd > 0) {
        const len = b.length - cutStart - cutEnd;
        if (len <= 0) continue;
        b = sliceBuffer(b, cutStart, len); ts += cutStart / sr;
      }
      if (first) {
        first = false;
        if (ts - start > 0.005) { // שקט בתחילה
          const pad = new AudioBuffer({ length: Math.round((ts - start) * sr), numberOfChannels: b.numberOfChannels, sampleRate: sr });
          await as.add(pad);
        }
      }
      await as.add(b);
    }
    as.close();
  })();

  try { await Promise.all([videoTask, audioTask]); }
  catch (e) { try { await output.cancel(); } catch {} throw e; }
  await output.finalize();
  onProgress?.(1);
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

function sliceBuffer(b, off, len) {
  const nb = new AudioBuffer({ length: len, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) nb.copyToChannel(b.getChannelData(c).subarray(off, off + len), c);
  return nb;
}

// קצב סיביות שמתאים לסטטוס: איכות גבוהה אך מתחת ל-16MB לחלק
export function statusBitrate(seconds, height, capMB = 16) {
  const maxBps = height >= 1900 ? 8_000_000 : height >= 1270 ? 5_000_000 : 2_500_000;
  if (!capMB) return maxBps;
  const budget = (capMB * 0.94 * 8 * 1024 * 1024) / Math.max(1, seconds) - 128_000;
  return Math.max(900_000, Math.min(maxBps, Math.floor(budget)));
}
