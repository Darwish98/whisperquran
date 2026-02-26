/**
 * audioPlayer.ts
 *
 * Uses a single persistent Audio element created at module load.
 * unlockAudio() must be called from a synchronous user gesture once —
 * after that the element stays unlocked for the session.
 */

const player = new Audio();
player.preload = 'none';

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export type AudioStatus = 'locked' | 'unlocked';
export function getAudioStatus(): AudioStatus { return 'unlocked'; }
export function isAudioUnlocked(): boolean { return true; }

/**
 * Call synchronously from ANY user gesture (button click, tap).
 * Primes the persistent Audio element so .play() works in async contexts.
 */
export function unlockAudio(): void {
  player.src = SILENT_WAV;
  player.volume = 0;
  player.play().then(() => {
    player.volume = 1;
  }).catch(() => {});
}

/**
 * Play audio. Fetches and caches as blob URL on first call.
 */
export async function playAudio(url: string): Promise<boolean> {
  try {
    const blobUrl = await getBlobUrl(url);
    player.pause();
    player.src = blobUrl;
    player.volume = 1;
    await player.play();
    return true;
  } catch (err) {
    console.warn('[audio] play failed:', err);
    return false;
  }
}

export function preloadWordAudio(urls: string[]): void {
  urls.forEach(url => getBlobUrl(url).catch(() => {}));
}

async function getBlobUrl(url: string): Promise<string> {
  if (cache.has(url)) return cache.get(url)!;
  if (!inflight.has(url)) {
    inflight.set(url, fetch(url)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.blob(); })
      .then(b => { const u = URL.createObjectURL(b); cache.set(url, u); return u; })
    );
  }
  return inflight.get(url)!;
}
