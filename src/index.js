#!/usr/bin/env node
// Karaokord: your Spotify lyrics as karaoke in your Discord status.
//   npm start                                  → follows Spotify
//   npm run demo -- "rick astley never gonna"  → plays a song's lyrics without Spotify
import { loadConfig } from "./config.js";
import { DiscordLink, toDiscord } from "./discord.js";
import { Karaoke } from "./karaoke.js";
import { Spotify } from "./spotify.js";

const stamp = () => new Date().toLocaleTimeString("en-GB");
const log = { info: (m) => console.log(`${stamp()} · ${m}`), warn: (m) => console.warn(`${stamp()} ⚠ ${m}`) };
const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };

let cfg;
try { cfg = loadConfig(); } catch (e) { die(e.message); }
const demoAt = process.argv.indexOf("--demo");
const demo = demoAt >= 0 ? process.argv.slice(demoAt + 1).join(" ").trim() : null;

if (!cfg.clientId) die('Add your Discord Application ID to config.json as "clientId". See the README, step 1.');
if (!demo && !cfg.spotifyClientId) die('Add your Spotify Client ID to config.json as "spotifyClientId" (README, step 2), or try a demo: npm run demo -- "artist song"');
if (demoAt >= 0 && !demo) die('Say which song: npm run demo -- "rick astley never gonna give you up"');

console.log("\n  🎤 Karaokord\n");

// Check the picture worker once, so a typo in the address shows up now and not as a missing picture.
if (cfg.cardUrl) {
  const { VERSION } = await import("../worker/karaokord-card.js");
  fetch(`${cfg.cardUrl}/`, { signal: AbortSignal.timeout(8000) })
    .then(async (r) => {
      const text = await r.text();
      if (!text.includes("running")) return log.warn(`Karaoke pictures: ${cfg.cardUrl} answered, but it isn't the Karaokord worker. Check "cardUrl".`);
      const live = Number(text.match(/version (\d+)/)?.[1] ?? 1);
      if (live < VERSION) log.warn("Karaoke pictures: your worker in Cloudflare is out of date, so new features won't show. Paste the newest worker/karaokord-card.js into it (Edit code → replace everything → Deploy).");
      else log.info(`Karaoke pictures: ready (${cfg.style}${cfg.bubbles ? " with bubbles" : ""})`);
    })
    .catch((e) => log.warn(`Karaoke pictures: couldn't reach ${cfg.cardUrl} (${e.message}). Check "cardUrl".`));
} else log.info('Karaoke pictures: off (add "cardUrl" to config.json to light up each word, README step 3)');

const karaoke = new Karaoke(cfg, log);
const discord = new DiscordLink(cfg.clientId, log);
await discord.connect();

if (demo) {
  try { await karaoke.demo(demo); } catch (e) { die(e.message); }
} else {
  const spotify = new Spotify(cfg.spotifyClientId);
  try { await spotify.accessToken(); log.info("Spotify connected"); } catch (e) { die(`Spotify login: ${e.message}`); }
  // Asks Spotify where the song is: often while music plays, so pauses and skips show up quickly.
  const poll = async () => {
    try { karaoke.update(await spotify.nowPlaying()); } catch (e) { log.warn(`Spotify: ${e.message}`); }
    setTimeout(poll, karaoke.track?.playing ? 2500 : 5000);
  };
  poll();
}

let wasPlaying = false;
setInterval(() => {
  const a = karaoke.frame();
  if (a) { discord.set(toDiscord(a)); wasPlaying = true; }
  else if (wasPlaying && !karaoke.track?.playing) {
    discord.set(null); // music stopped: clear the status
    wasPlaying = false;
    if (demo) { log.info("Demo finished."); setTimeout(() => bye(), 4500); }
  }
}, 500);

const bye = async () => { await discord.close(); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
