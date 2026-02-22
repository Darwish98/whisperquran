/**
 * audioPlayer.ts — AudioContext-based player
 *
 * WHY HTMLAudioElement.play() was silent:
 * The browser's autoplay policy blocks audio.play() calls that don't happen
 * within a synchronous user-gesture handler. When the mic is recording, the
 * gesture that started it is long gone, so any new play() call is silently
 * rejected with NotAllowedError (swallowed by the old try/catch).
 *
 * FIX: Use a single shared AudioContext (unlocked on the START button click)
 * and play via AudioBufferSourceNode. Once an AudioContext is resumed by a
 * user gesture it stays unlocked for the session — even across async gaps.
 *
 * Usage:
 *   unlockAudio()           ← call inside any button onClick handler
 *   await playAudio(url)    ← works even during active mic recording
 *   preloadWordAudio(urls)  ← background-fetch + decode for instant playback
 */

let ctx: AudioContext | null = null;
const cache = new Map<string, AudioBuffer>();

/** Returns (or lazily creates) the shared AudioContext. */
function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/**
 * Call this inside any synchronous user-gesture handler (button click, etc.)
 * BEFORE the first playAudio() call. This lifts the autoplay restriction for
 * the entire session.
 */
export function unlockAudio(): void {
  const audioCtx = getCtx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

/**
 * Fetch + decode a URL into an AudioBuffer and cache it.
 * Safe to call in the background — silently skips failures.
 */
export async function preloadAudio(url: string): Promise<void> {
  if (cache.has(url)) return;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const raw = await res.arrayBuffer();
    const buf = await getCtx().decodeAudioData(raw);
    cache.set(url, buf);
  } catch {
    // Network error or unsupported format — ignore silently
  }
}

/**
 * Play a URL immediately. Fetches + decodes on first call; uses cache thereafter.
 * Never throws — logs a warning on failure.
 */
export async function playAudio(url: string): Promise<void> {
  try {
    const audioCtx = getCtx();

    // Last-ditch resume attempt (only works if called from a gesture chain)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    let buffer = cache.get(url);
    if (!buffer) {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[audioPlayer] HTTP ${res.status} for ${url}`);
        return;
      }
      buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      cache.set(url, buffer);
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
  } catch (err) {
    console.warn('[audioPlayer] playAudio failed:', err);
  }
}

/** Background-preload an array of URLs. Fire-and-forget. */
export function preloadWordAudio(urls: string[]): void {
  for (const url of urls) {
    preloadAudio(url).catch(() => {});
  }
}
