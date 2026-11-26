// Spotify Web API: one-time login (Authorization Code + PKCE, no client secret)
// and polling of the currently playing track.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";

const TOKEN_FILE = ".spotify-token.json";
export const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = "user-read-currently-playing user-read-playback-state";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function tokenRequest(clientId, params) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify login failed: ${body.error_description || body.error || res.status}`);
  return { ...body, expires_at: Date.now() + (body.expires_in - 60) * 1000 };
}

/** Opens the browser once so you can approve access, then saves a refresh token. */
function login(clientId) {
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: REDIRECT_URI, scope: SCOPES,
    code_challenge_method: "S256", code_challenge: challenge, state,
  });

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const finish = (msg) => { res.writeHead(200, { "Content-Type": "text/html" }).end(`<h2>${msg}</h2><p>You can close this tab.</p>`); server.close(); };
      if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
        finish("Spotify login was cancelled.");
        return reject(new Error(u.searchParams.get("error") || "login cancelled"));
      }
      try {
        const tok = await tokenRequest(clientId, { grant_type: "authorization_code", code: u.searchParams.get("code"), redirect_uri: REDIRECT_URI, code_verifier: verifier });
        finish("Spotify connected ✔");
        resolve(tok);
      } catch (e) { finish("Spotify login failed."); reject(e); }
    });
    server.listen(8888, "127.0.0.1", () => {
      console.log(`🎧 Opening Spotify so you can allow access. If nothing opens, visit:\n   ${url}\n`);
      openBrowser(url);
    });
    server.on("error", reject);
  });
}

export class Spotify {
  constructor(clientId) {
    this.clientId = clientId;
    this.tok = existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, "utf8")) : null;
  }

  save(tok) {
    // Spotify doesn't always return a new refresh token; keep the old one.
    this.tok = { ...this.tok, ...tok, refresh_token: tok.refresh_token || this.tok?.refresh_token };
    writeFileSync(TOKEN_FILE, JSON.stringify(this.tok, null, 2), { mode: 0o600 });
  }

  async accessToken() {
    if (!this.tok?.refresh_token) this.save(await login(this.clientId));
    if (Date.now() >= this.tok.expires_at) {
      try {
        this.save(await tokenRequest(this.clientId, { grant_type: "refresh_token", refresh_token: this.tok.refresh_token }));
      } catch (e) {
        console.warn(`⚠ ${e.message}. Logging in again…`);
        this.tok = null;
        this.save(await login(this.clientId));
      }
    }
    return this.tok.access_token;
  }

  /** Returns the playing track with its position, or null when nothing is playing. */
  async nowPlaying() {
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track", {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 204) return null;
    if (res.status === 401) { this.tok.expires_at = 0; return this.nowPlaying(); }
    if (res.status === 429) throw new Error(`Spotify is rate limiting, retry in ${res.headers.get("retry-after") ?? "?"}s`);
    if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`);
    const d = await res.json();
    const t = d.item;
    if (!t || d.currently_playing_type !== "track") return null;
    return {
      id: t.id,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      album: t.album?.name,
      art: t.album?.images?.[0]?.url,
      url: t.external_urls?.spotify,
      durationMs: t.duration_ms,
      progressMs: d.progress_ms ?? 0,
      playing: d.is_playing,
      fetchedAt: Date.now(),
    };
  }
}
