/**
 * audioPlayer.ts — AudioContext-based player with robust browser autoplay handling
 *
 * WHY HTMLAudioElement.play() was silent:
 * The browser's autoplay policy blocks audio.play() calls that don't happen
 * within a synchronous user-gesture handler. When the mic is recording, the
 * gesture that started it is long gone, so any new play() call is silently
 * rejected with NotAllowedError.
 *
 * FIX: Use a shared AudioContext (unlocked on the START button click)
 * and play via AudioBufferSourceNode. Once an AudioContext is resumed by a
 * user gesture it stays unlocked for the session — even across async gaps.
 *
 * Additionally, we create a silent HTML5 Audio element as a secondary unlock
 * strategy. Some browsers (Safari) need both.
 *
 * Usage:
 *   unlockAudio()           ← call inside any button onClick handler
 *   await playAudio(url)    ← works even during active mic recording
 *   preloadWordAudio(urls)  ← background-fetch + decode for instant playback
 *   getAudioStatus()        ← returns current unlock state for UI
 */

let ctx: AudioContext | null = null;
const cache = new Map<string, AudioBuffer>();
let unlocked = false;
let unlockAttempted = false;

/** Returns (or lazily creates) the shared AudioContext. */
function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    console.log('[audioPlayer] AudioContext created, state:', ctx.state);
  }
  return ctx;
}

export type AudioStatus = 'locked' | 'unlocking' | 'unlocked' | 'error';

/**
 * Returns the current audio unlock status for UI display.
 */
export function getAudioStatus(): AudioStatus {
  if (!ctx) return unlockAttempted ? 'error' : 'locked';
  if (ctx.state === 'running') return 'unlocked';
  if (ctx.state === 'suspended') return unlockAttempted ? 'unlocking' : 'locked';
  return 'error';
}

/**
 * Call this inside any synchronous user-gesture handler (button click, etc.)
 * BEFORE the first playAudio() call. This lifts the autoplay restriction for
 * the entire session.
 *
 * Uses multiple strategies for maximum browser compatibility:
 * 1. AudioContext.resume() — works in Chrome, Firefox, Edge
 * 2. Silent HTML5 Audio play — helps Safari
 * 3. Silent oscillator node — ensures AudioContext is truly running
 */
export function unlockAudio(): void {
  unlockAttempted = true;
  const audioCtx = getCtx();

  // Strategy 1: Resume AudioContext
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      unlocked = true;
      console.log('[audioPlayer] AudioContext resumed successfully');
    }).catch((err) => {
      console.warn('[audioPlayer] AudioContext.resume() failed:', err);
    });
  } else if (audioCtx.state === 'running') {
    unlocked = true;
  }

  // Strategy 2: Play a silent buffer to "warm up" the audio graph
  try {
    const silentBuffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const source = audioCtx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
    source.stop(audioCtx.currentTime + 0.001);
    console.log('[audioPlayer] Silent buffer played for unlock');
  } catch (err) {
    console.warn('[audioPlayer] Silent buffer unlock failed:', err);
  }

  // Strategy 3: Silent HTML5 Audio element (Safari workaround)
  try {
    const silentAudio = new Audio();
    silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    silentAudio.volume = 0.01;
    const playPromise = silentAudio.play();
    if (playPromise) {
      playPromise.then(() => {
        silentAudio.pause();
        silentAudio.remove();
        console.log('[audioPlayer] HTML5 Audio silent play succeeded');
      }).catch(() => {
        // Expected to fail sometimes — that's OK
      });
    }
  } catch {
    // Ignore
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
    if (!res.ok) {
      console.warn(`[audioPlayer] Preload HTTP ${res.status} for ${url}`);
      return;
    }
    const raw = await res.arrayBuffer();
    const buf = await getCtx().decodeAudioData(raw);
    cache.set(url, buf);
    console.log(`[audioPlayer] Preloaded: ${url.split('/').pop()}`);
  } catch (err) {
    console.warn('[audioPlayer] Preload failed:', url, err);
  }
}

/**
 * Play a URL immediately. Fetches + decodes on first call; uses cache thereafter.
 * Never throws — logs a warning on failure.
 * Returns a boolean indicating success.
 */
export async function playAudio(url: string): Promise<boolean> {
  try {
    const audioCtx = getCtx();

    // Last-ditch resume attempt (only works if called from a gesture chain)
    if (audioCtx.state === 'suspended') {
      console.log('[audioPlayer] Attempting to resume suspended AudioContext...');
      await audioCtx.resume();
    }

    if (audioCtx.state !== 'running') {
      console.warn('[audioPlayer] AudioContext not running, state:', audioCtx.state,
        '— Audio will not play. Call unlockAudio() from a user gesture first.');
      return false;
    }

    let buffer = cache.get(url);
    if (!buffer) {
      console.log(`[audioPlayer] Fetching: ${url.split('/').pop()}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[audioPlayer] HTTP ${res.status} for ${url}`);
        return false;
      }
      const arrayBuf = await res.arrayBuffer();
      buffer = await audioCtx.decodeAudioData(arrayBuf);
      cache.set(url, buffer);
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    console.log(`[audioPlayer] ▶️ Playing: ${url.split('/').pop()}`);
    return true;
  } catch (err) {
    console.warn('[audioPlayer] playAudio failed:', err);
    return false;
  }
}

/** Background-preload an array of URLs. Fire-and-forget. */
export function preloadWordAudio(urls: string[]): void {
  for (const url of urls) {
    preloadAudio(url).catch(() => {});
  }
}

/** Check if audio is currently unlocked and ready to play */
export function isAudioUnlocked(): boolean {
  return ctx?.state === 'running' || false;
}
