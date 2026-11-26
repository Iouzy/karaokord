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
//
// The picture plays once and then stays on the last line.

const SIZE = 128;      // picture is 128 × 128
const S = 2;           // font scale
const CW = 6 * S;      // character cell width
const CH = 11 * S;     // character cell height (2 accent rows + 7 letter rows + descender + gap)
const PAD_X = 4, MAX_COLS = Math.floor((SIZE - 2 * PAD_X) / CW), MAX_ROWS = 5;
const BAND = 16;       // height of the top band with the music note

// 0 background, 1 top band, 2 unsung text, 3 sung text, 4 current word, 5 shadow, 6 note, 7 band edge
const PALETTE = [
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
function background(eq = [7, 9, 5, 10, 6], flash = false) {
  const px = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < BAND; y++) px.fill(y === BAND - 1 ? (flash ? 4 : 7) : 1, y * SIZE, (y + 1) * SIZE);
  // a little music note and an equalizer in the top band
  const note = ["00110", "00101", "00100", "00100", "01100", "11100", "01000"];
  note.forEach((row, ry) => [...row].forEach((b, rx) => { if (b === "1") rect(px, 8 + rx * 2, 1 + ry * 2, 2, 2, 6); }));
  eq.forEach((h, k) => rect(px, 20 + k * 6, 14 - h, 3, h, flash ? 4 : 6));
  return px;
}

function rect(px, x, y, w, h, c) {
  for (let yy = Math.max(0, y); yy < Math.min(SIZE, y + h); yy++) px.fill(c, yy * SIZE + Math.max(0, x), yy * SIZE + Math.min(SIZE, x + w));
}

function drawText(px, box, color, dx = 0, dy = 0) {
  [...box.text].forEach((ch, i) => {
    const g = glyph(ch);
    if (!g) return;
    g.forEach((row, ry) => {
      if (!row) return;
      [...row].forEach((b, rx) => {
        if (b !== "1") return;
        const x = box.x + dx + (i * 6 + rx) * S, y = box.y + dy + ry * S;
        if (color !== 2) rect(px, x + 1, y + 1, S, S, 5); // shadow under lit words
        rect(px, x, y, S, S, color);
      });
    });
  });
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

function changedRect(a, b) {
  const rowDiff = (y) => { for (let i = y * SIZE, e = i + SIZE; i < e; i++) if (a[i] !== b[i]) return true; return false; };
  let y0 = 0, y1 = SIZE - 1;
  while (y0 < SIZE && !rowDiff(y0)) y0++;
  if (y0 === SIZE) return { x: 0, y: 0, w: 1, h: 1 }; // nothing changed
  while (!rowDiff(y1)) y1--;
  let x0 = SIZE, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const r = y * SIZE;
    for (let x = 0; x < x0; x++) if (a[r + x] !== b[r + x]) { x0 = x; break; }
    for (let x = SIZE - 1; x > x1; x--) if (a[r + x] !== b[r + x]) { x1 = x; break; }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function gif(frames) {
  const out = new Bytes();
  out.push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
  out.u16(SIZE); out.u16(SIZE);
  out.push(0xf2, 0, 0); // global palette of 8 colours
  for (const c of PALETTE) out.push(...c);
  let prev = null;
  for (const f of frames) {
    // Only the part that changed since the last frame is stored.
    const r = prev ? changedRect(prev, f.px) : { x: 0, y: 0, w: SIZE, h: SIZE };
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
const CALM_EQ = [7, 9, 5, 10, 6];
const HIT_EQ = [[12, 10, 13, 11, 12], [9, 13, 10, 12, 8], [11, 8, 12, 9, 13]];
// A "bass hit" on each word: the text drops, wobbles sideways and settles (hundredths of a second).
const HIT = [{ dx: 0, dy: 5, t: 4 }, { dx: 2, dy: -2, t: 4 }, { dx: -2, dy: 1, t: 4 }];

function paint(boxes, colorOf, dx = 0, dy = 0, eq = CALM_EQ, flash = false) {
  const px = background(eq, flash);
  for (const b of boxes) drawText(px, b, colorOf(b.word), dx, dy);
  return px;
}

/**
 * lines:     the lines to show, each a list of words. The picture turns the page to the next line
 *            when its first word starts, so fast lines aren't skipped.
 * offsetsCs: when each word starts (all lines, in order), in hundredths of a second from load.
 */
export function renderCard(lines, offsetsCs, bass = false) {
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
  const sung = new Set(all.filter((i) => offsetsCs[i] <= 0));
  const colorFor = (current) => (w) => (w === current ? 4 : sung.has(w) ? 3 : 2);
  // Start on the page of the last word already sung.
  let page = 0;
  for (const i of sung) page = Math.max(page, pageOf[i]);

  // Pictures with the time they appear; turned into GIF frames at the end.
  const events = [];
  const at = (t, px) => events.push({ t, px });
  at(0, paint(pages[page], colorFor(null)));
  order.forEach((i, k) => {
    const t = offsetsCs[i];
    const next = k + 1 < order.length ? offsetsCs[order[k + 1]] : t + 60;
    if (pageOf[i] !== page) {
      // A pause between lines: finish the old line, then show the new one just before it starts.
      const prev = k ? offsetsCs[order[k - 1]] : 0;
      if (t - prev > 200) {
        at(prev + 100, paint(pages[page], colorFor(null)));
        at(t - 60, paint(pages[pageOf[i]], colorFor(null)));
      }
      page = pageOf[i];
    }
    const boxes = pages[page], color = colorFor(i);
    // Bass hit, if there's time for it before the next word.
    let start = t;
    if (bass && next - t >= 24) {
      HIT.forEach((h, n) => { at(start, paint(boxes, color, h.dx, h.dy, HIT_EQ[(k + n) % HIT_EQ.length], n === 0)); start += h.t; });
    }
    at(start, paint(boxes, color));
    sung.add(i);
  });
  // Last word turns white and the picture stays there.
  if (order.length) at(offsetsCs[order.at(-1)] + 60, paint(pages[page], colorFor(null)));

  // Browsers slow down frames shorter than 2 hundredths, so a frame that would be that short is
  // replaced by the one after it.
  const frames = [];
  events.forEach((e, n) => {
    const nextT = events[n + 1]?.t;
    if (nextT === undefined) frames.push({ px: e.px, delay: 0 });
    else if (nextT - e.t >= 2) frames.push({ px: e.px, delay: nextT - e.t });
  });
  return gif(frames);
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
  return { lines, words, offsets, bass };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("Karaokord card is running. Pictures are at /l.gif?t=…&w=…", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (url.pathname !== "/l.gif") return new Response("Not found", { status: 404 });
    const cache = globalThis.caches?.default;
    const hit = cache && (await cache.match(request));
    if (hit) return hit;
    const { lines, offsets, bass } = parseRequest(url);
    const body = renderCard(lines.length ? lines : [["♪"]], lines.length ? offsets : [0], bass);
    const res = new Response(body, { headers: { "Content-Type": "image/gif", "Cache-Control": "public, max-age=31536000, immutable" } });
    if (cache && ctx) ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
};
