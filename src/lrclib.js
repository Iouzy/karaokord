// Timed lyrics from LRCLIB (https://lrclib.net), a free, open lyrics database.
const UA = "Karaokord (https://github.com/Iouzy/karaokord)";
const cache = new Map();

/** Parses LRC text ("[01:02.34]line") into [{ ms, text }] sorted by time. */
export function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const [, m, s] of stamps) lines.push({ ms: Math.round((+m * 60 + +s) * 1000), text });
  }
  return lines.sort((a, b) => a.ms - b.ms);
}

/** Reads one value from LRCLIB's lyricsfile (YAML): bare, 'single' or "double" quoted. */
function yamlValue(v) {
  v = v.trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/**
 * Parses LRCLIB's "lyricsfile", which also has the time of every word:
 *   lines:
 *   - text: ...      start_ms: ...      words:
 *     - text: ...    start_ms: ...
 * Returns [{ ms, text, words: [{ ms, text }] }] or null if there are no word times.
 */
export function parseLyricsfile(yaml) {
  if (!yaml) return null;
  const lines = [];
  let inLines = false, line = null, word = null;
  for (const raw of yaml.split(/\r?\n/)) {
    if (/^lines:\s*$/.test(raw)) { inLines = true; continue; }
    if (!inLines) continue;
    if (/^[A-Za-z_][\w-]*:/.test(raw)) break; // next top-level section (list items start with "-")
    let m;
    if ((m = raw.match(/^- text:(.*)$/))) { line = { ms: 0, text: yamlValue(m[1]), words: [] }; lines.push(line); word = null; }
    else if ((m = raw.match(/^  start_ms:\s*(\d+)/)) && line) line.ms = +m[1];
    else if ((m = raw.match(/^  - text:(.*)$/)) && line) { word = { ms: line.ms, text: yamlValue(m[1]).trim() }; line.words.push(word); }
    else if ((m = raw.match(/^    start_ms:\s*(\d+)/)) && word) word.ms = +m[1];
  }
  const withWords = lines.filter((l) => l.words.length);
  return withWords.length ? lines.sort((a, b) => a.ms - b.ms) : null;
}

async function get(path, params) {
  const res = await fetch(`https://lrclib.net/api/${path}?${new URLSearchParams(params)}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return res.json();
}

/**
 * Finds timed lyrics for a track.
 * Returns { lines } when found, { instrumental: true }, or { lines: null } when nothing is timed.
 */
export async function findLyrics({ id, title, artist, album, durationMs }) {
  const key = id || `${artist}|${title}`;
  if (cache.has(key)) return cache.get(key);

  const firstArtist = artist.split(",")[0].trim();
  // Exact match first (title + artist + album + duration), then a looser search.
  let hit = await get("get", { track_name: title, artist_name: firstArtist, album_name: album ?? "", duration: Math.round(durationMs / 1000) }).catch(() => null);
  if (!hit?.syncedLyrics && !hit?.instrumental) {
    const results = (await get("search", { track_name: title, artist_name: firstArtist })) ?? [];
    hit = results.find((r) => r.syncedLyrics && Math.abs(r.duration * 1000 - durationMs) < 4000)
      ?? results.find((r) => r.syncedLyrics)
      ?? results.find((r) => r.instrumental)
      ?? hit;
  }

  // Word-by-word timing when LRCLIB has it, otherwise line-by-line.
  const result = hit?.instrumental ? { instrumental: true }
    : hit?.lyricsfile && parseLyricsfile(hit.lyricsfile) ? { lines: parseLyricsfile(hit.lyricsfile), wordTimed: true }
    : hit?.syncedLyrics ? { lines: parseLrc(hit.syncedLyrics) }
    : { lines: null };
  cache.set(key, result);
  return result;
}

/** Free-text search, used by --simulate. Returns the first result that has timed lyrics. */
export async function searchTrack(query) {
  const results = (await get("search", { q: query })) ?? [];
  const r = results.find((x) => x.syncedLyrics && x.hasWordSync) ?? results.find((x) => x.syncedLyrics);
  if (!r) return null;
  // Ask for this exact entry, which includes the word timings.
  const full = await get(`get/${r.id}`, {}).catch(() => null);
  const lines = parseLyricsfile(full?.lyricsfile) ?? parseLrc(r.syncedLyrics);
  return { id: `lrclib-${r.id}`, title: r.trackName, artist: r.artistName, album: r.albumName, durationMs: r.duration * 1000, lines };
}
