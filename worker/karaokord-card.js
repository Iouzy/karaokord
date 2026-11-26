// Karaokord card: a Cloudflare Worker that draws lyric lines as an animated GIF, lighting up the
// words one by one in time with the song, and turning to the next line when it starts.
// Self-contained: paste this whole file into a new Worker in the Cloudflare dashboard.
// No other files or settings needed.
//
//   GET /l.gif?t=<words>&w=<offsets>
//     t  the words, separated by spaces, with "~" between lines (max 240 characters)
//     w  when each word starts, in hundredths of a second from when the picture loads,
//        written in base 36 and separated by "." ("-" in front = already sung)
//     fx "b" for bass mode: the text jumps on every word
//     c  the song's colour as 6 hex digits (from the album cover); the picture is themed with it
//     e  until when the equalizer keeps moving after the last word (hundredths of a second, base 36),
//        so the picture doesn't freeze while waiting for the next line
//     v  background: a style letter (o orb, b bars, w wave, r rings, n none) and 1/0 for bubbles
//
// The picture plays once and then stays on the last line.

export const VERSION = 5; // raise when the picture changes, so the program can say "paste the new code"
const SIZE = 128;      // picture is 128 × 128
const S = 2;           // font scale
const CW = 6 * S;      // character cell width
const CH = 11 * S;     // character cell height (2 accent rows + 7 letter rows + descender + gap)
const PAD_X = 4, MAX_COLS = Math.floor((SIZE - 2 * PAD_X) / CW), MAX_ROWS = 5;
const BAND = 16;       // height of the top band with the music note

// 0 background, 1 top band, 2 unsung text, 3 sung text, 4 current word, 5 shadow, 6 note, 7 band edge
const DEFAULT_PALETTE = [
  [18, 16, 31], [28, 24, 56], [86, 80, 128], [255, 255, 255],
  [255, 79, 154], [6, 5, 12], [140, 155, 255], [44, 38, 82],
];

// ─── Font: 5 wide, rows 0-1 accents, 2-8 letter, 9 below the line ─────────
const B = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110",
  2: "01110 10001 00001 00010 00100 01000 11111", 3: "11110 00001 00001 01110 00001 00001 11110",
  4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
  6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000",
  8: "01110 10001 10001 01110 10001 10001 01110", 9: "01110 10001 10001 01111 00001 00010 01100",
  "!": "00100 00100 00100 00100 00100 00000 00100", "?": "01110 10001 00001 00010 00100 00000 00100",
  ".": "00000 00000 00000 00000 00000 00000 00100", ",": "00000 00000 00000 00000 00000 00100 00100",
  "'": "00100 00100 01000 00000 00000 00000 00000", '"': "01010 01010 00000 00000 00000 00000 00000",
  "-": "00000 00000 00000 01110 00000 00000 00000", ":": "00000 00100 00100 00000 00100 00100 00000",
  ";": "00000 00100 00100 00000 00100 00100 01000", "(": "00010 00100 01000 01000 01000 00100 00010",
  ")": "01000 00100 00010 00010 00010 00100 01000", "&": "01100 10010 10100 01000 10101 10010 01101",
  "/": "00001 00010 00010 00100 01000 01000 10000", "*": "00000 10101 01110 11111 01110 10101 00000",
  "#": "01010 11111 01010 01010 01010 11111 01010", "+": "00000 00100 00100 11111 00100 00100 00000",
  "%": "11001 11010 00010 00100 01000 01011 10011", "¿": "00100 00000 00100 01000 10000 10001 01110",
  "¡": "00100 00000 00100 00100 00100 00100 00100", "♪": "00110 00101 00100 00100 01100 11100 01000",
};
const ACC = { acute: ["00010", "00100"], grave: ["01000", "00100"], circ: ["00100", "01010"], tilde: ["01101", "10110"], diaer: ["01010", "00000"] };
const ACCENTED = {
  "Á": ["A", "acute"], "À": ["A", "grave"], "Â": ["A", "circ"], "Ã": ["A", "tilde"], "Ä": ["A", "diaer"],
  "É": ["E", "acute"], "È": ["E", "grave"], "Ê": ["E", "circ"], "Ë": ["E", "diaer"],
  "Í": ["I", "acute"], "Ì": ["I", "grave"], "Î": ["I", "circ"], "Ï": ["I", "diaer"],
  "Ó": ["O", "acute"], "Ò": ["O", "grave"], "Ô": ["O", "circ"], "Õ": ["O", "tilde"], "Ö": ["O", "diaer"],
  "Ú": ["U", "acute"], "Ù": ["U", "grave"], "Û": ["U", "circ"], "Ü": ["U", "diaer"], "Ñ": ["N", "tilde"],
};
const ALIASES = { "’": "'", "‘": "'", "“": '"', "”": '"', "…": ".", "–": "-", "—": "-" };

function glyph(ch) {
  ch = ALIASES[ch] ?? ch;
  if (ch === "Ç") return [null, null, ...B.C.split(" "), "00110"];
  if (ch === ",") return [null, null, ...B[","].split(" "), "01000"];
  if (ACCENTED[ch]) { const [base, a] = ACCENTED[ch]; return [...ACC[a], ...B[base].split(" "), null]; }
  if (B[ch]) return [null, null, ...B[ch].split(" "), null];
  return null;
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function layout(words) {
  // Long words are split so nothing runs off the picture.
  const pieces = [];
  words.forEach((w, i) => {
    let s = [...w.toUpperCase()].filter((c) => glyph(c) || c === " ").join("");
    if (!s) s = "♪";
    for (let k = 0; k < s.length; k += MAX_COLS) pieces.push({ text: s.slice(k, k + MAX_COLS), word: i });
  });
  const rows = [[]];
  let len = 0;
  for (const p of pieces) {
    const need = (len ? 1 : 0) + p.text.length;
    if (len && len + need > MAX_COLS) { rows.push([]); len = 0; }
    rows.at(-1).push(p);
    len += (len ? 1 : 0) + p.text.length;
  }
  // Too many rows: keep the end of the line (the part being sung).
  const kept = rows.slice(-MAX_ROWS);
  const top = Math.max(BAND + 1, Math.round((SIZE + BAND - kept.length * CH) / 2));
  const boxes = []; // per piece: x, y, w, h, text, word
  kept.forEach((row, r) => {
    const width = row.reduce((n, p, k) => n + p.text.length + (k ? 1 : 0), 0) * CW - S;
    let x = Math.round((SIZE - width) / 2);
    for (const p of row) {
      boxes.push({ ...p, x, y: top + r * CH, w: p.text.length * CW - S, h: 10 * S });
      x += (p.text.length + 1) * CW;
    }
  });
  return boxes;
}

// ─── Drawing ─────────────────────────────────────────────────────────────────
function rect(px, x, y, w, h, c) {
  for (let yy = Math.max(0, y); yy < Math.min(SIZE, y + h); yy++) px.fill(c, yy * SIZE + Math.max(0, x), yy * SIZE + Math.min(SIZE, x + w));
}

/** The top-left corner of every lit 2×2 dot in a word, worked out once per word and reused. */
function dotsOf(box) {
  if (box.dots) return box.dots;
  const dots = [];
  [...box.text].forEach((ch, i) => {
    const g = glyph(ch);
    if (!g) return;
    g.forEach((row, ry) => {
      if (!row) return;
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === "1") dots.push(box.x + (i * 6 + rx) * S, box.y + ry * S);
    });
  });
  return (box.dots = dots);
}

function dot(px, x, y, c) {
  if (x < 0 || y < 0 || x + 1 >= SIZE || y + 1 >= SIZE) return rect(px, x, y, 2, 2, c);
  const i = y * SIZE + x;
  px[i] = px[i + 1] = px[i + SIZE] = px[i + SIZE + 1] = c;
}

function drawText(px, box, color, dx = 0, dy = 0) {
  const d = dotsOf(box);
  for (let k = 0; k < d.length; k += 2) dot(px, d[k] + dx + 1, d[k + 1] + dy + 1, 5); // shadow, so words stay readable over the visualizer
  for (let k = 0; k < d.length; k += 2) dot(px, d[k] + dx, d[k + 1] + dy, color);
}

// ─── GIF encoding (LZW, one shared 8-colour palette) ─────────────────────────
// A growable byte buffer (much faster than pushing numbers onto an array).
class Bytes {
  constructor(n = 16384) { this.a = new Uint8Array(n); this.n = 0; }
  room(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  push(...v) { this.room(v.length); for (const x of v) this.a[this.n++] = x; }
  byte(x) { this.room(1); this.a[this.n++] = x; }
  u16(x) { this.room(2); this.a[this.n++] = x & 255; this.a[this.n++] = (x >> 8) & 255; }
  out() { return this.a.slice(0, this.n); }
}

// LZW codes: (prefix code, next colour) → code. A "generation" stamp marks entries as stale,
// so the table never has to be cleared.
const TABLE = new Int16Array(4096 * 8), STAMP = new Int32Array(4096 * 8);
let generation = 0;
function lzw(indices, minCode, out) {
  const clear = 1 << minCode, eoi = clear + 1, n = indices.length;
  let size = minCode + 1, next = eoi + 1, gen = ++generation;
  out.byte(minCode);
  // Room for the worst case (12 bits a pixel plus block headers), so bytes go straight in.
  out.room(Math.ceil((n + 2) * 1.5 * 256 / 255) + 8);
  const a = out.a;
  let p = out.n, blockAt = p++, cur = 0, bits = 0;
  // Writes one code; a full 255-byte block gets its length byte and a new block starts.
  const emit = (code) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) {
      a[p++] = cur & 255; cur >>>= 8; bits -= 8;
      if (p - blockAt === 256) { a[blockAt] = 255; blockAt = p++; }
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < n; i++) {
    const k = indices[i], key = prefix * 8 + k;
    if (STAMP[key] === gen) { prefix = TABLE[key]; continue; }
    emit(prefix);
    if (next < 4096) {
      TABLE[key] = next++; STAMP[key] = gen;
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear); gen = ++generation; size = minCode + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) { a[p++] = cur & 255; if (p - blockAt === 256) { a[blockAt] = 255; blockAt = p++; } }
  if (p - blockAt > 1) { a[blockAt] = p - blockAt - 1; a[p++] = 0; } else a[blockAt] = 0; // last block, then the end marker
  out.n = p;
}

function changedRect(a, b, rows = SIZE) {
  const rowDiff = (y) => { for (let i = y * SIZE, e = i + SIZE; i < e; i++) if (a[i] !== b[i]) return true; return false; };
  let y0 = 0, y1 = rows - 1;
  while (y0 < rows && !rowDiff(y0)) y0++;
  if (y0 >= rows) return { x: 0, y: 0, w: 1, h: 1 }; // nothing changed
  while (!rowDiff(y1)) y1--;
  let x0 = SIZE, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const r = y * SIZE;
    for (let x = 0; x < x0; x++) if (a[r + x] !== b[r + x]) { x0 = x; break; }
    for (let x = SIZE - 1; x > x1; x--) if (a[r + x] !== b[r + x]) { x1 = x; break; }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ─── Colours from the song ───────────────────────────────────────────────────
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** A palette built around one colour: dark tinted background, the colour itself for the current word. */
export function paletteFor(hex) {
  if (!/^[0-9a-f]{6}$/i.test(hex ?? "")) return DEFAULT_PALETTE;
  const base = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // The current word gets the colour at full strength: vivid and bright, so it pops on the dark background.
  const max = Math.max(...base), min = Math.min(...base);
  const sat = max ? (max - min) / max : 0;
  const vivid = max === min ? [255, 255, 255] : base.map((v) => {
    const t = (v - min) / (max - min); // 0 for the weakest channel, 1 for the strongest
    return Math.round(255 * (1 - Math.max(sat, 0.65) * (1 - t)));
  });
  const c = lum(vivid) < 0.35 ? mixRgb(vivid, [255, 255, 255], 0.3) : vivid;
  const black = [8, 7, 14];
  return [
    mixRgb(black, base, 0.14), mixRgb(black, base, 0.28), mixRgb([92, 90, 108], base, 0.2), [255, 255, 255],
    c, [4, 4, 8], mixRgb([200, 200, 220], c, 0.5), mixRgb(black, c, 0.55),
  ];
}

function gif(frames, palette = DEFAULT_PALETTE) {
  const out = new Bytes();
  out.push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
  out.u16(SIZE); out.u16(SIZE);
  out.push(0xf2, 0, 0); // global palette of 8 colours
  for (const c of palette) out.push(...c);
  let prev = null;
  for (const f of frames) {
    // Only the part that changed since the last frame is stored.
    const r = prev ? changedRect(prev, f.px, f.bandOnly ? BAND : SIZE) : { x: 0, y: 0, w: SIZE, h: SIZE };
    prev = f.px;
    // No looping block, so the picture plays once and stays on the last frame.
    out.push(0x21, 0xf9, 4, 0x04); out.u16(Math.max(0, Math.min(65535, Math.round(f.delay)))); out.push(0, 0);
    out.byte(0x2c); out.u16(r.x); out.u16(r.y); out.u16(r.w); out.u16(r.h); out.byte(0);
    const crop = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) crop.set(f.px.subarray((r.y + y) * SIZE + r.x, (r.y + y) * SIZE + r.x + r.w), y * r.w);
    lzw(crop, 3, out);
  }
  out.byte(0x3b);
  return out.out();
}

// ─── The picture ─────────────────────────────────────────────────────────────
// A "bass hit" on each word: the text drops, wobbles sideways and settles (hundredths of a second).
const HIT = [{ dx: 0, dy: 5, t: 4 }, { dx: 2, dy: -2, t: 4 }, { dx: -2, dy: 1, t: 4 }];
const IDLE_STEP = 20; // between words the background keeps moving: a new picture every 0.2 s
const TAIL_STEP = 30, MAX_TAIL = 2000; // after the last word: every 0.3 s, for up to 20 s
const CX = 64, CY = 72; // centre of the background effects
// Bubbles drifting up behind the words: [x, speed, phase, size]
const BUBBLES = [[14, 9, 0, 2], [30, 6, 40, 1], [47, 11, 75, 2], [80, 7, 20, 1], [96, 10, 60, 2], [112, 8, 90, 1], [60, 5, 105, 1], [122, 12, 33, 1]];

/** How hard the music "hits" at time t: jumps to 1 when a word starts and fades over ~0.2 s. */
function pulseAt(t, starts) {
  let p = 0;
  for (const s of starts) { if (s > t) break; const d = t - s; if (d < 40) p = Math.max(p, Math.exp(-d / 12)); }
  return p;
}

const wob = (k, t) => Math.sin(k * 1.7 + t * 0.09) * 0.5 + Math.sin(k * 3.1 - t * 0.05) * 0.5; // -1..1
const dot2 = (px, x, y, c) => { if (y > BAND) dot(px, Math.round(x), Math.round(y), c); };

// ─── Background styles (colours: 1 = soft, 7 = strong, 6 = light) ────────────
/** A dark orb that breathes, ringed with spikes that dance and jump on every word. */
function orb(px, t, pulse) {
  const r = 26 + pulse * 5 + Math.sin(t * 0.06) * 1.5;
  const r2 = r * r;
  for (let y = Math.max(BAND + 1, Math.floor(CY - r)); y <= Math.min(SIZE - 1, CY + r); y++) {
    const dy = y - CY, half = Math.sqrt(Math.max(0, r2 - dy * dy));
    px.fill(1, y * SIZE + Math.max(0, Math.ceil(CX - half)), y * SIZE + Math.min(SIZE, Math.floor(CX + half) + 1));
  }
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2 + t * 0.01;
    const len = 3 + (wob(k, t) + 1) * 3 + pulse * (4 + 5 * Math.abs(wob(k + 7, t)));
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let d = r + 1; d < r + len; d += 1.5) dot2(px, CX + ca * d, CY + sa * d, 7);
  }
}

/** A spectrum: bars rising from the bottom, jumping on every word. */
function bars(px, t, pulse) {
  for (let k = 0; k < 16; k++) {
    const h = Math.round(6 + (wob(k, t * 1.3) + 1) * 7 + pulse * (8 + 12 * Math.abs(wob(k + 5, t))));
    const x = 1 + k * 8;
    rect(px, x, SIZE - h, 6, h, 1);
    rect(px, x, SIZE - h, 6, 2, 7);
  }
}

/** Sound waves across the middle that swell on every word. */
function waves(px, t, pulse) {
  for (let j = 0; j < 3; j++) {
    const amp = (5 + pulse * 13) * (j === 0 ? 1 : 0.55);
    for (let x = 0; x < SIZE; x += 2) {
      const y = CY + Math.sin(x * 0.07 + t * 0.12 + j * 2.1) * amp * Math.sin((x / SIZE) * Math.PI);
      dot2(px, x, y, j === 0 ? 7 : 1);
    }
  }
}

/** Rings that spread out from the centre each time a word is sung, over rings that slowly breathe. */
function rings(px, t, pulse, starts) {
  const circle = (r, c) => {
    const n = Math.max(24, Math.round(r * 2.4)); // enough 2×2 dots for a solid line
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; dot2(px, CX + Math.cos(a) * r, CY + Math.sin(a) * r, c); }
  };
  // Background rings that always breathe, so the picture is never empty.
  for (let j = 0; j < 2; j++) circle(20 + j * 18 + Math.sin(t * 0.07 + j * 1.3) * 2.5 + pulse * 3, 1);
  // A bright ring for each word, spreading out and fading.
  for (const s of starts) {
    if (s > t) break;
    const age = t - s;
    if (age > 110) continue;
    circle(8 + age * 0.7, age < 70 ? 7 : 1);
  }
}

const STYLES = { o: orb, b: bars, w: waves, r: rings, n: () => {} };

function backdrop(look, t, pulse, starts) {
  const px = new Uint8Array(SIZE * SIZE);
  (STYLES[look.style] ?? orb)(px, t, pulse, starts);
  if (look.bubbles) {
    for (const [bx, speed, phase, size] of BUBBLES) {
      const y = SIZE - (((t * speed) / 40 + phase) % (SIZE - BAND));
      rect(px, Math.round(bx + Math.sin((t + phase * 9) / 30) * 2), Math.round(y), size + 1, size + 1, 6);
    }
  }
  return px;
}

// Top band: a music note that bounces and an equalizer that never sits still.
const NOTE = ["00110", "00101", "00100", "00100", "01100", "11100", "01000"];
function drawBand(px, t, pulse, flash) {
  for (let y = 0; y < BAND; y++) px.fill(y === BAND - 1 ? (flash ? 4 : 7) : 1, y * SIZE, (y + 1) * SIZE);
  const nb = pulse > 0.5 ? -1 : 0;
  NOTE.forEach((row, ry) => { for (let rx = 0; rx < 5; rx++) if (row[rx] === "1") rect(px, 8 + rx * 2, 1 + ry * 2 + nb, 2, 2, 6); });
  for (let k = 0; k < 16; k++) {
    const h = Math.max(1, Math.min(13, Math.round(4 + (wob(k, t * 1.6) + 1) * 3 + pulse * 5 * (0.5 + Math.abs(wob(k + 3, t))))));
    rect(px, 22 + k * 6, 14 - h, 3, h, pulse > 0.7 ? 4 : 6);
  }
}

/**
 * lines:     the lines to show, each a list of words. The picture turns the page to the next line
 *            when its first word starts, so fast lines aren't skipped.
 * offsetsCs: when each word starts (all lines, in order), in hundredths of a second from load.
 * look:      { style: "o" orb | "b" bars | "w" wave | "r" rings | "n" none, bubbles: true/false }
 */
export function renderCard(lines, offsetsCs, bass = false, color = null, holdUntil = 0, look = { style: "o", bubbles: true }) {
  const pages = [], pageOf = [];
  let first = 0;
  for (const ws of lines) {
    const boxes = layout(ws).map((b) => ({ ...b, word: b.word + first }));
    ws.forEach((_, k) => { pageOf[first + k] = pages.length; });
    pages.push(boxes);
    first += ws.length;
  }
  const total = first;
  const shown = (i) => pages[pageOf[i]].some((b) => b.word === i);
  const all = [...Array(total).keys()];
  const order = all.filter((i) => offsetsCs[i] > 0 && shown(i));
  const starts = order.map((i) => offsetsCs[i]);
  const sung = new Set(all.filter((i) => offsetsCs[i] <= 0));
  // Colours for each word, frozen at this moment (words keep being sung after it).
  const colorFor = (current) => { const done = new Set(sung); return (w) => (w === current ? 4 : done.has(w) ? 3 : 2); };
  let page = 0;
  for (const i of sung) page = Math.max(page, pageOf[i]);

  // Scenes: what the words look like from time t. The background is drawn for each frame's own time.
  const scenes = [];
  const at = (t, boxes, colorOf, shake = null) => scenes.push({ t, boxes, colorOf, shake });
  at(0, pages[page], colorFor(null));
  order.forEach((i, k) => {
    const t = offsetsCs[i];
    const next = k + 1 < order.length ? offsetsCs[order[k + 1]] : t + 60;
    if (pageOf[i] !== page) {
      // A pause between lines: finish the old line, then show the new one just before it starts.
      const prev = k ? offsetsCs[order[k - 1]] : 0;
      if (t - prev > 200) {
        at(prev + 100, pages[page], colorFor(null));
        at(t - 60, pages[pageOf[i]], colorFor(null));
      }
      page = pageOf[i];
    }
    const boxes = pages[page], colorOf = colorFor(i);
    // On the word the background jumps (and the text shakes, with bass), then settles.
    if (next - t >= 24) {
      if (bass) { let start = t; HIT.forEach((h, n) => { at(start, boxes, colorOf, { ...h, flash: n === 0 }); start += h.t; }); }
      else at(t, boxes, colorOf);
      at(t + 12, boxes, colorOf);
    } else at(t, boxes, colorOf);
    sung.add(i);
  });
  const end = order.length ? offsetsCs[order.at(-1)] + 60 : 0;
  if (order.length) at(end, pages[page], colorFor(null));

  // Frames: every scene change, plus in-between frames so the background keeps moving.
  // With no background effect only the band moves, and those frames are cheap.
  const still = look.style === "n" && !look.bubbles;
  const tailEnd = Math.min(Math.max(holdUntil, end), end + MAX_TAIL);
  const frames = [];
  scenes.forEach((sc, n) => {
    const until = scenes[n + 1]?.t;
    if (until !== undefined && until - sc.t < 2) return; // browsers slow down frames this short
    const times = [sc.t];
    if (until !== undefined && !sc.shake) for (let tt = sc.t + IDLE_STEP; tt < until - 4; tt += IDLE_STEP) times.push(tt);
    if (until === undefined) for (let tt = sc.t + TAIL_STEP; tt <= tailEnd; tt += TAIL_STEP) times.push(tt);
    const s = sc.shake;
    let px = null;
    times.forEach((tt, m) => {
      const pulse = pulseAt(tt, starts);
      if (still && m > 0) { px = px.slice(); drawBand(px, tt, pulse, false); }
      else {
        px = backdrop(look, tt, pulse, starts);
        for (const b of sc.boxes) drawText(px, b, sc.colorOf(b.word), s?.dx ?? 0, s?.dy ?? 0);
        drawBand(px, tt, pulse, !!s?.flash);
      }
      const stop = m + 1 < times.length ? times[m + 1] : until;
      frames.push({ px, delay: stop === undefined ? 0 : stop - tt, bandOnly: still && m > 0 });
    });
  });
  return gif(frames, paletteFor(color));
}

export function parseRequest(url) {
  const t = (url.searchParams.get("t") ?? "").slice(0, 240);
  // "~" separates lines; up to 40 words in all.
  let room = 40;
  const lines = [];
  for (const l of t.split("~")) {
    const ws = l.split(/\s+/).filter(Boolean).slice(0, room);
    if (ws.length) { lines.push(ws); room -= ws.length; }
    if (!room) break;
  }
  const words = lines.flat();
  const raw = (url.searchParams.get("w") ?? "").split(".").slice(0, words.length);
  const offsets = words.map((_, i) => {
    const v = raw[i] ?? "";
    const n = v.startsWith("-") ? -parseInt(v.slice(1), 36) : parseInt(v, 36);
    return Number.isFinite(n) ? n : i * 40; // missing timing: one word every 0.4 s
  });
  const bass = url.searchParams.get("fx") === "b";
  const color = url.searchParams.get("c");
  const hold = parseInt(url.searchParams.get("e") ?? "", 36);
  // v: background style letter and bubbles on/off, e.g. "o1" (orb with bubbles) or "b0".
  const v = url.searchParams.get("v") ?? "o1";
  const look = { style: "obwrn".includes(v[0]) ? v[0] : "o", bubbles: v[1] !== "0" };
  return { lines, words, offsets, bass, color, hold: Number.isFinite(hold) ? hold : 0, look };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // The version lets the program tell when the code pasted into Cloudflare is out of date.
    if (url.pathname === "/") return new Response(`Karaokord card is running (version ${VERSION}). Pictures are at /l.gif?t=…&w=…`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (url.pathname !== "/l.gif") return new Response("Not found", { status: 404 });
    const cache = globalThis.caches?.default;
    // Saved pictures are kept per code version, so after an update no picture from older code is reused.
    const key = new Request(`${url.origin}${url.pathname}${url.search}&_code=${VERSION}`);
    const hit = cache && (await cache.match(key));
    if (hit) return hit;
    const { lines, offsets, bass, color, hold, look } = parseRequest(url);
    const body = renderCard(lines.length ? lines : [["♪"]], lines.length ? offsets : [0], bass, color, hold, look);
    const res = new Response(body, { headers: { "Content-Type": "image/gif", "Cache-Control": "public, max-age=31536000, immutable" } });
    if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
