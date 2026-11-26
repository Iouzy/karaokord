// Picks a song's colour from its album cover, so each song's karaoke picture has its own look.
import jpeg from "jpeg-js";

/** The most striking colour of an image as 6 hex digits, or null. */
export async function songColor(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const { data } = jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true, maxMemoryUsageInMB: 64 });
    // Colours are grouped by hue; each pixel counts by how vivid it is, so greys and near-black barely count.
    const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0, val = max / 255;
      const w = sat * sat * val;
      if (w < 0.04) continue;
      const d = max - min;
      const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bin = bins[Math.floor(hue * 2) % 12];
      bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
    }
    const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
    if (best.w < 1) return null; // a grey or black-and-white cover: keep the default look
    return [best.r, best.g, best.b].map((v) => Math.round(v / best.w).toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
