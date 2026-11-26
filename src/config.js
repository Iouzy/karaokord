// Reads config.json. Environment variables DISCORD_CLIENT_ID, SPOTIFY_CLIENT_ID and CARD_URL also work.
import { existsSync, readFileSync } from "node:fs";

export function loadConfig() {
  let raw = {};
  if (existsSync("config.json")) {
    try { raw = JSON.parse(readFileSync("config.json", "utf8")); } catch (e) {
      throw new Error(`config.json isn't valid JSON (${e.message}). Check for a missing comma or quote.`);
    }
  }
  return {
    clientId: process.env.DISCORD_CLIENT_ID || raw.clientId || "",
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || raw.spotifyClientId || "",
    cardUrl: (process.env.CARD_URL || raw.cardUrl || "").replace(/\/+$/, ""),
    syncOffsetMs: raw.syncOffsetMs ?? 1500,
    bass: raw.bass ?? true,
    showNextLine: raw.showNextLine ?? true,
  };
}
