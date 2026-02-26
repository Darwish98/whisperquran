/**
 * audioPlayer.ts — Simple HTMLAudioElement-based player
 *
 * Uses HTMLAudioElement instead of AudioContext — avoids all autoplay/unlock issues.
 * Browsers allow HTMLAudio playback triggered from any async context as long as
 * the user has interacted with the page at least once (which mic permission grants).
 */

const cache = new Map<string, string>(); // url → blob URL
const preloadCache = new Map<string, Promise<string>>();

export type AudioStatus = 'unlocked';

export function getAudioStatus(): AudioStatus {
  return 'unlocked';
}

/** No-op — HTMLAudio doesn't need unlocking */
export function unlockAudio(): void {}

/** Check if audio is ready (always true for HTMLAudio) */
export function isAudioUnlocked(): boolean {
  return true;
}

async function fetchAsBlobUrl(url: string): Promise<string> {
  if (cache.has(url)) return cache.get(url)!;

  // Deduplicate concurrent fetches for same URL
  if (!preloadCache.has(url)) {
    const p = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        cache.set(url, blobUrl);
        return blobUrl;
      });
    preloadCache.set(url, p);
  }

  return preloadCache.get(url)!;
}

/**
 * Play a URL immediately using HTMLAudioElement.
 * Returns true on success, false on failure.
 */
export async function playAudio(url: string): Promise<boolean> {
  try {
    const blobUrl = await fetchAsBlobUrl(url);
    const audio = new Audio(blobUrl);
    audio.volume = 1.0;
    await audio.play();
    console.log(`[audioPlayer] ▶️ Playing: ${url.split('/').pop()}`);
    return true;
  } catch (err) {
    console.warn('[audioPlayer] playAudio failed:', err);
    return false;
  }
}

/** Background-preload URLs into blob cache. Fire-and-forget. */
export function preloadWordAudio(urls: string[]): void {
  for (const url of urls) {
    fetchAsBlobUrl(url).catch(() => {});
  }
}
