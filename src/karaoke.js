// The lyrics logic: follows the song, picks the line being sung, and builds the karaoke picture's address.
import { findLyrics, searchTrack } from "./lrclib.js";
import { songColor } from "./color.js";

const MIN_GAP = 4000; // Discord's update limit
const EQ = ["▁▃▅▇", "▃▇▅▂", "▅▂▇▃", "▇▅▃▁", "▂▅▇▅", "▄▆▂▇"];

/** A line's words with their start times: LRCLIB's word times, or spread evenly over the line. */
function timedWords(lines, j) {
  const line = lines[j];
  if (line.words?.length) return line.words.map((w) => ({ text: w.text.trim(), ms: w.ms })).filter((w) => w.text);
  const parts = line.text.trim().split(/\s+/);
  const end = lines[j + 1]?.ms ?? line.ms + 3000;
  const step = Math.max(150, Math.min(600, (end - line.ms) / parts.length));
  return parts.map((w, k) => ({ text: w, ms: line.ms + k * step }));
}

/**
 * Address of the karaoke picture, timed from now. It holds line `idx` and the lines that start
 * before the next status update can arrive, so the picture turns to them by itself and fast
 * lines aren't skipped.
 */
export function cardUrl(base, lines, idx, pos, bass, color = null, look = { style: "orb", bubbles: true }) {
  if (!lines[idx].text?.trim()) return null;
  const until = pos + MIN_GAP + 1000;
  const chosen = [idx];
  for (let j = idx + 1; j < lines.length && chosen.length < 4 && lines[j].ms < until && lines[j].text?.trim(); j++) chosen.push(j);
  const cs = (ms) => { const n = Math.round((ms - pos) / 10); return n < 0 ? `-${(-n).toString(36)}` : n.toString(36); };
  const clean = (w) => w.replace(/~/g, "-"); // "~" separates lines in the address
  const enc = (s) => encodeURIComponent(s).replace(/%20/g, "+");
  // Keep the picture moving until the line after these is due (plus Discord's delay), up to 20 s.
  const nextMs = lines[chosen.at(-1) + 1]?.ms ?? pos + 20_000;
  const hold = Math.max(0, Math.min(2000, Math.round((nextMs - pos) / 10) + 200)).toString(36);
  const build = (wordLines) => {
    const flat = wordLines.flat();
    return `${base}/l.gif?t=${enc(wordLines.map((ws) => ws.map((w) => clean(w.text)).join(" ")).join("~"))}&w=${flat.map((w) => cs(w.ms)).join(".")}${bass ? "&fx=b" : ""}${color ? `&c=${color}` : ""}&e=${hold}&v=${look.style[0]}${look.bubbles ? 1 : 0}`;
  };
  // Discord takes addresses up to 256 characters: drop later lines first, then sung words.
  for (let n = chosen.length; n >= 1; n--) {
    const wordLines = chosen.slice(0, n).map((j) => timedWords(lines, j));
    if (n > 1) { const url = build(wordLines); if (url.length <= 256) return url; continue; }
    const ws = wordLines[0];
    for (let start = 0; start < ws.length; start++) { const url = build([ws.slice(start)]); if (url.length <= 256) return url; }
  }
  return null;
}

/** "bass" in settings: true (every song), false, or a list of song names to use it on. */
export function useBass(setting, t) {
  if (setting === undefined || setting === true) return true;
  if (Array.isArray(setting)) return setting.some((name) => t.title.toLowerCase().includes(String(name).toLowerCase()));
  return false;
}

export class Karaoke {
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log;
    this.track = null;
    this.lyrics = null;
    this.last = null;
    this.lastEmit = 0;
    this.shownIdx = -1;
    this.shownTrack = null;
    this.eq = 0;
  }

  position() {
    const t = this.track;
    return t ? t.progressMs + (t.playing ? Date.now() - t.fetchedAt : 0) : 0;
  }

  /** A new reading from Spotify (or the demo). */
  update(now) {
    if (now && now.id !== this.track?.id) {
      this.track = now;
      this.lyrics = null;
      this.color = null;
      if (this.cfg.songColors !== false) songColor(now.artSmall ?? now.art).then((c) => { if (this.track?.id === now.id) this.color = c; });
      this.log.info(`▶ ${now.title} · ${now.artist}`);
      findLyrics(now)
        .then((l) => { if (this.track?.id === now.id) { this.lyrics = l; this.log.info(l?.lines?.length ? `  lyrics found${l.wordTimed ? " (word by word)" : " (line by line)"}` : "  no timed lyrics for this song"); } })
        .catch(() => { this.lyrics = { lines: null }; });
    } else this.track = now;
  }

  /** Plays a song's lyrics without Spotify (for `npm run demo`). */
  async demo(query) {
    const found = await searchTrack(query);
    if (!found) throw new Error(`no timed lyrics found for "${query}"`);
    // LRCLIB has no covers, so the demo borrows one from Apple's public search (no key needed).
    const art = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${found.artist} ${found.title}`, entity: "song", limit: "1" })}`, { signal: AbortSignal.timeout(6000) })
      .then((r) => r.json()).then((d) => d.results?.[0]?.artworkUrl100).catch(() => null);
    this.track = { ...found, playing: true, progressMs: 0, fetchedAt: Date.now(), art: art?.replace("100x100", "600x600"), artSmall: art };
    this.lyrics = { lines: found.lines, wordTimed: found.wordTimed };
    if (this.cfg.songColors !== false) this.color = await songColor(art);
    this.log.info(`▶ ${found.title} · ${found.artist} (demo)`);
    return found;
  }

  /** The status to show now, or null when nothing is playing. */
  frame() {
    const t = this.track, cfg = this.cfg;
    if (!t || !t.playing) return null;
    if (this.lyrics === null && Date.now() - t.fetchedAt < 3000) return this.last; // give the lookup a moment
    // Lines are shown a little early to make up for Spotify, the 4-second limit and Discord's own delay.
    const real = this.position();
    const pos = real + cfg.syncOffsetMs;
    const lines = this.lyrics?.lines;
    let idx = -1;
    if (lines?.length) { let lo = 0, hi = lines.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].ms <= pos) { idx = m; lo = m + 1; } else hi = m - 1; } }
    const changed = t.id !== this.shownTrack || idx !== this.shownIdx || (!lines?.length && Date.now() - this.lastEmit > 12000);
    if (!changed || Date.now() - this.lastEmit < MIN_GAP) return this.last;

    const a = {
      name: t.title,
      statusDisplay: 2, // the member list shows the lyric line
      largeImage: t.art,
      largeText: t.album ? `${t.album} · ${t.artist}` : t.artist,
      start: Date.now() - real, // the progress bar follows the real position
      end: Date.now() - real + t.durationMs,
      buttons: t.url ? [{ label: "Listen on Spotify", url: t.url }] : undefined,
    };
    if (!lines?.length) {
      Object.assign(a, { details: `🎵 ${t.title}`, state: `${EQ[this.eq++ % EQ.length]}  ${this.lyrics?.instrumental ? "instrumental" : t.artist}` });
    } else {
      // Lines sung since the last update are merged so fast verses aren't lost from the text.
      const from = this.shownTrack === t.id && this.shownIdx >= 0 && this.shownIdx < idx && idx - this.shownIdx <= 3 ? this.shownIdx + 1 : idx;
      const sung = idx < 0 ? [] : lines.slice(from, idx + 1).map((l) => l.text).filter(Boolean);
      const next = lines.slice(idx + 1).find((l) => l.text)?.text;
      a.details = idx < 0 ? "♪ (intro)" : sung.length ? sung.join(" / ") : "♪ ♪ ♪";
      a.state = cfg.showNextLine && next ? `↳ ${next}` : t.artist;
      const card = idx >= 0 && cfg.cardUrl ? cardUrl(cfg.cardUrl, lines, idx, pos, useBass(cfg.bass, t), this.color, { style: cfg.style, bubbles: cfg.bubbles }) : null;
      if (card) {
        a.largeImage = card;
        a.largeText = `${t.title} · ${t.artist}`;
        if (t.art) { a.smallImage = t.art; a.smallText = t.album ?? t.artist; } // album cover in the corner
      }
    }
    this.lastEmit = Date.now(); this.shownIdx = idx; this.shownTrack = t.id; this.last = a;
    if (real > t.durationMs) t.playing = false; // song over; the next Spotify reading takes it from here
    return a;
  }
}
