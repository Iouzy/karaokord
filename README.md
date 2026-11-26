# 🎤 Karaokord

**Your Spotify lyrics as karaoke in your Discord status.** The line being sung shows in your
status, and the picture lights up every word right on time, with a little bass bounce on each one.

<p align="center"><img src="docs/preview.gif" width="256" alt="A lyric picture lighting up word by word"></p>

- 🎵 **Synced lyrics**: the line being sung right now, with the next line underneath.
- 🔦 **Word-by-word karaoke picture**: each word lights up as it's sung. Fast verses get several
  lines in one picture, so nothing is skipped.
- 🎨 **Every song has its own colours**, picked from its album cover.
- 🔮 **A moving background** behind the words that jumps on every word: an **orb**, spectrum
  **bars**, sound **waves** or spreading **rings**, with bubbles drifting up and an equalizer that
  never sits still.
- 🔊 **Bass mode**: the picture jumps on every word. On for every song, or only the ones you pick.
- 📏 **Progress bar** that follows the song, plus a "Listen on Spotify" button for your friends.
- ✅ **Uses Discord's official Rich Presence**, the same thing games use. No user token, no
  self-bot, nothing against Discord's rules.

## How it works

Discord only lets a status change about once every 4 seconds, which is too slow for karaoke. An
animated picture, though, plays at any speed. So for every lyric line, Karaokord asks a tiny free
Cloudflare Worker to draw an animated GIF in which each word lights up at the exact moment it's
sung. Lyrics and word timings come from [LRCLIB](https://lrclib.net), a free, open lyrics database.

```
Spotify ──▶ Karaokord (your PC) ──▶ Discord status
                  │                      ▲
                  └── word timings ──▶ Worker draws the GIF
```

## Setup (about 10 minutes, once)

You need [Node.js 18+](https://nodejs.org) and the Discord **desktop** app.

```bash
git clone https://github.com/Iouzy/karaokord
cd karaokord
npm install
npm run setup
```

`npm run setup` opens each page below, asks for the IDs and writes `config.json` for you. On
Windows you can also just double-click **`start.bat`**: it installs, runs the setup the first
time, and starts. (Prefer doing it by hand? Copy `config.example.json` to `config.json`.)

### 1. A Discord app (gives your status its name)

1. Open <https://discord.com/developers/applications> and click **New Application**. Any name works.
2. Copy the **Application ID** (`clientId`).

Try it right away, no Spotify needed:

```bash
npm run demo -- "rick astley never gonna give you up"
```

Open your Discord profile: the lyrics play through your status.

### 2. A Spotify app (lets Karaokord see what you're playing)

1. Open <https://developer.spotify.com/dashboard> and click **Create app**.
2. Redirect URI: `http://127.0.0.1:8888/callback`. Tick **Web API**.
3. Copy the **Client ID** (`spotifyClientId`). No secret needed.

The first `npm start` opens your browser once to allow access.

> Turn off Discord's own Spotify status (User Settings → Connections → Spotify → "Display Spotify
> as your status") so it doesn't cover the lyrics.

### 3. The karaoke picture worker (free)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Iouzy/karaokord/tree/main/worker)

Click the button and follow Cloudflare's steps, then put the worker's address in `config.json`
as `cardUrl`. Or by hand:

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Workers & Pages → Create →
   Create Worker** (start from "Hello World"), name it `karaokord` and click **Deploy**.
2. Click **Edit code**, replace everything with the contents of
   [`worker/karaokord-card.js`](worker/karaokord-card.js), and click **Deploy** again.
3. Opening the worker's address should say **"Karaokord card is running"**.
4. Put the address in `config.json` as `cardUrl`.

When Karaokord starts it checks the worker's version and tells you if it's time to paste the newest
code. One request per lyric line, far below the free plan's 100,000 a day. Without a worker, Karaokord
still works and shows the album cover instead.

### 4. Start

```bash
npm start
```

Play something on Spotify. Your status follows the song, and clears when you pause.

## Settings (`config.json`)

| Setting | Default | What it does |
|---|---|---|
| `clientId` | | Your Discord Application ID |
| `spotifyClientId` | | Your Spotify app's Client ID |
| `cardUrl` | | Your worker's address. Leave empty for no karaoke picture |
| `syncOffsetMs` | `1500` | How early each line shows, to make up for Spotify's and Discord's delays. Lyrics late? Raise it. Early? Lower it |
| `bass` | `true` | `true`, `false`, or a list of song names, like `["never gonna", "bohemian"]` |
| `showNextLine` | `true` | Show the next line under the current one |
| `songColors` | `true` | Theme each picture with the colours of the album cover |
| `style` | `"orb"` | The moving background: `"orb"`, `"bars"`, `"wave"`, `"rings"` or `"none"` |
| `bubbles` | `true` | Bubbles drifting up behind the words |

## Good to know

- **Your friends see the picture start when their Discord loads it.** If they open your profile
  halfway through a line, that line plays from its start. The next line is back in sync.
- **The member list cuts long lines** at about 30 characters. That's Discord; your profile shows
  the whole line.
- **No lyrics for a song?** Only songs with timed lyrics on LRCLIB work. Songs with word timings
  light up exactly; others spread the words evenly over the line. You can add lyrics on
  [lrclib.net](https://lrclib.net).
- **Privacy:** Karaokord only reads what Spotify is playing. Your Spotify login stays in
  `.spotify-token.json` on your PC.

## Project layout

```
src/index.js       start-up, Spotify polling, sending to Discord
src/karaoke.js     picks the line being sung and builds the picture address
src/lrclib.js      finds timed lyrics (with word timings when available)
src/spotify.js     Spotify login (PKCE, no secret) and now playing
src/discord.js     Discord connection, update limit, reconnects
src/color.js       picks each song's colour from its cover
src/setup.js       npm run setup
worker/            the picture worker (one self-contained file)
```

## Credits

Lyrics by [LRCLIB](https://lrclib.net). Demo covers from Apple's public iTunes Search. Discord connection by
[@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc). MIT licence.
