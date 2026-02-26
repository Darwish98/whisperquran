/**
 * audioPlayer.ts
 *
 * Plays Quran ayah audio using a single persistent HTMLAudioElement.
 * Sets src directly — no fetch/blob needed. Browsers stream cross-origin
 * audio fine without CORS headers; only fetch() requires CORS.
 */

const player = new Audio();
player.preload = 'none';

const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export type AudioStatus = 'unlocked';
export function getAudioStatus(): AudioStatus { return 'unlocked'; }
export function isAudioUnlocked(): boolean { return true; }

/** Call from any synchronous user gesture to prime the audio element */
export function unlockAudio(): void {
  player.src = SILENT;
  player.volume = 0;
  player.play().then(() => { player.volume = 1; }).catch(() => {});
}

/** Play an audio URL directly — no fetch, no blob, just src + play() */
export async function playAudio(url: string): Promise<boolean> {
  try {
    player.pause();
    player.src = url;
    player.volume = 1;
    await player.play();
    console.log('[audio] playing:', url.split('/').pop());
    return true;
  } catch (err) {
    console.warn('[audio] failed:', err);
    return false;
  }
}

/** Preload by setting src on throwaway elements — fire and forget */
export function preloadWordAudio(urls: string[]): void {
  urls.forEach(url => {
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
  });
}