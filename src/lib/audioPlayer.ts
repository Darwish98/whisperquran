// Pre-cached audio player for instant word-level playback

const audioCache = new Map<string, HTMLAudioElement>();

export function preloadAudio(url: string): void {
  if (audioCache.has(url)) return;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  audioCache.set(url, audio);
}

export async function playAudio(url: string): Promise<void> {
  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audioCache.set(url, audio);
  }
  audio.currentTime = 0;
  try {
    await audio.play();
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

// Preload a range of word audio URLs for upcoming words
export function preloadWordAudio(urls: string[]): void {
  urls.forEach(preloadAudio);
}
