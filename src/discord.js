// One connection to the Discord desktop app, with reconnects and Discord's update limit built in.
const MIN_GAP_MS = 4000; // Discord accepts about one status update every 4 seconds

/** Discord rejects text fields shorter than 2 or longer than 128 characters (counted in UTF-16 units). */
export function fit(s, max = 128) {
  if (s == null) return undefined;
  let out = String(s);
  if (!out) return undefined;
  if (out.length > max) {
    const chars = [...out];
    while (chars.join("").length > max - 1) chars.pop();
    out = `${chars.join("")}…`;
  }
  return out.length < 2 ? `${out}⠀` : out;
}

/** Turns our activity into the shape Discord expects. */
export function toDiscord(a) {
  if (!a) return null;
  const out = {
    type: a.type ?? 2, // "Listening to"
    name: fit(a.name),
    details: fit(a.details),
    state: fit(a.state),
    largeImageKey: a.largeImage,
    smallImageKey: a.smallImage,
    startTimestamp: a.start,
    endTimestamp: a.end,
    statusDisplayType: a.statusDisplay,
    buttons: a.buttons?.slice(0, 2).map((b) => ({ label: fit(b.label, 32), url: b.url })),
  };
  if (out.largeImageKey) out.largeImageText = fit(a.largeText);
  if (out.smallImageKey) out.smallImageText = fit(a.smallText);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export class DiscordLink {
  constructor(clientId, log) {
    this.clientId = clientId;
    this.log = log;
    this.client = null;
    this.connected = false;
    this.lastSent = 0;
    this.pending = undefined; // newest activity waiting for its turn (null = clear)
    this.lastKey = null;
    this.failures = 0;
    this.reconnecting = false;
    this.timer = null;
  }

  async connect() {
    const { Client } = await import("@xhayper/discord-rpc");
    const attempt = async () => {
      this.reconnecting = false;
      this.client = new Client({ clientId: this.clientId });
      this.client.on("ready", () => {
        this.connected = true;
        this.lastKey = null;
        this.log.info(`Connected to Discord as ${this.client.user?.username ?? "you"}`);
        this.flush();
      });
      this.client.on("disconnected", () => {
        if (this.reconnecting) return;
        this.reconnecting = true;
        this.connected = false;
        this.log.warn("Lost the connection to Discord (did it restart or reload?). Reconnecting in 5 seconds…");
        setTimeout(attempt, 5_000);
      });
      try { await this.client.login(); } catch (e) {
        this.log.warn(`Couldn't reach Discord (${e.message}). Is the desktop app open? Retrying in 15 seconds…`);
        this.reconnecting = true;
        setTimeout(attempt, 15_000);
      }
    };
    this.reconnect = async () => {
      if (this.reconnecting) return;
      this.reconnecting = true;
      this.connected = false;
      const old = this.client;
      this.client = null;
      try { old?.removeAllListeners(); await old?.destroy(); } catch { /* already broken */ }
      this.log.warn("Updates keep failing, so reconnecting to Discord from scratch…");
      setTimeout(attempt, 3_000);
    };
    await attempt();
  }

  /** Queue an activity (or null to clear). Only the newest one is kept; it goes out when allowed. */
  set(activity) {
    if (JSON.stringify(activity) === this.lastKey && this.pending === undefined) return;
    this.pending = activity;
    this.flush();
  }

  flush() {
    if (this.pending === undefined || !this.connected) return;
    const wait = this.lastSent + MIN_GAP_MS - Date.now();
    if (wait > 0) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), wait); return; }
    const a = this.pending;
    this.pending = undefined;
    this.lastSent = Date.now();
    const key = JSON.stringify(a);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const p = a ? this.client.user?.setActivity(a) : this.client.user?.clearActivity();
    Promise.resolve(p).then(() => { this.failures = 0; }).catch((e) => {
      // After Discord reloads (Ctrl+R) the old connection can look alive but reject everything.
      if (++this.failures >= 3) { this.failures = 0; this.pending ??= a; this.reconnect?.(); return; }
      this.lastKey = null;
      this.log.warn(`Discord didn't accept the update (${e.message || "no reason given"}).`);
    });
  }

  async close() {
    try { await this.client?.user?.clearActivity(); await this.client?.destroy(); } catch { /* already gone */ }
  }
}
