// npm run setup: asks for the three things Karaokord needs, opens the right pages and writes config.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const rl = createInterface({ input });
const lines = rl[Symbol.asyncIterator](); // reads answers one line at a time, typed or piped
const open = (url) => exec(process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`, () => {});
const cfg = existsSync("config.json") ? JSON.parse(readFileSync("config.json", "utf8")) : {};
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/** Asks until the answer passes `ok` (Enter keeps the current value). */
async function ask(question, current, ok, hint) {
  for (;;) {
    output.write(`${question}${current ? ` [${current}]` : ""}: `);
    const { value, done } = await lines.next();
    if (done) { console.log(); process.exit(1); }
    const a = String(value).trim() || current || "";
    if (ok(a)) return a;
    console.log(`  ✖ ${hint}\n`);
  }
}

console.log(`\n  🎤 ${bold("Karaokord setup")}. Press Enter to keep a value in [brackets].\n`);

console.log(`${bold("1/3 Discord app")}: click "New Application", give it any name, copy the Application ID.`);
open("https://discord.com/developers/applications");
cfg.clientId = await ask("   Application ID", cfg.clientId, (a) => /^\d{17,20}$/.test(a), "That should be a long number, like 1234567890123456789.");

console.log(`\n${bold("2/3 Spotify app")}: click "Create app". Redirect URI: http://127.0.0.1:8888/callback, tick "Web API", copy the Client ID.`);
open("https://developer.spotify.com/dashboard");
cfg.spotifyClientId = await ask("   Client ID (Enter to skip for now)", cfg.spotifyClientId, (a) => !a || /^[0-9a-f]{32}$/i.test(a), "That should be 32 letters and numbers.");

console.log(`\n${bold("3/3 Karaoke picture worker")} (optional): see the README, step 3. Paste its address, or press Enter to skip.`);
cfg.cardUrl = await ask("   Worker address", cfg.cardUrl, (a) => !a || /^https:\/\/[^\s/]+\.[^\s/]+\/?$/.test(a), "That should look like https://karaokord.your-name.workers.dev");
cfg.cardUrl = cfg.cardUrl.replace(/\/+$/, "");
if (cfg.cardUrl) {
  const res = await fetch(`${cfg.cardUrl}/`, { signal: AbortSignal.timeout(8000) }).then((r) => r.text()).catch((e) => `error: ${e.message}`);
  console.log(res.includes("running") ? "   ✓ The worker is running." : `   ⚠ That address didn't answer like the Karaokord worker (${res.slice(0, 80)}). You can fix it later in config.json.`);
}

for (const [k, v] of Object.entries({ syncOffsetMs: 1500, bass: true, showNextLine: true, songColors: true })) cfg[k] ??= v;
for (const k of ["spotifyClientId", "cardUrl"]) if (!cfg[k]) delete cfg[k];
writeFileSync("config.json", `${JSON.stringify(cfg, null, 2)}\n`);
rl.close();
console.log(`\n✓ Saved config.json.\n\n  Try it:   ${bold('npm run demo -- "rick astley never gonna give you up"')}`);
console.log(cfg.spotifyClientId ? `  Then:     ${bold("npm start")} and play something on Spotify.\n` : "  Add a Spotify Client ID later (npm run setup again) to follow your music.\n");
