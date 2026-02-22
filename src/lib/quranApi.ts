export interface SurahInfo {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
}

export interface QuranWord {
  text: string;
  ayahNumber: number;
  wordIndex: number;
  globalIndex: number;
}

export interface AyahData {
  number: number;
  text: string;
  numberInSurah: number;
}

const SURAH_LIST_URL = 'https://api.alquran.cloud/v1/surah';
const SURAH_TEXT_URL = (num: number) => `https://api.alquran.cloud/v1/surah/${num}/quran-uthmani`;

export function getWordAudioUrl(surahNumber: number, ayahNumber: number, wordIndex: number): string {
  const s = String(surahNumber).padStart(3, '0');
  const a = String(ayahNumber).padStart(3, '0');
  const w = String(wordIndex + 1).padStart(3, '0');
  return `https://audio.qurancdn.com/wbw/001_${s}_${a}_${w}.mp3`;
}

export function getAyahAudioUrl(surahNumber: number, ayahNumber: number): string {
  const s = String(surahNumber).padStart(3, '0');
  const a = String(ayahNumber).padStart(3, '0');
  return `https://cdn.islamic.network/quran/audio/128/ar.alafasy/${s}${a}.mp3`;
}

export async function fetchSurahList(): Promise<SurahInfo[]> {
  const res = await fetch(SURAH_LIST_URL);
  const data = await res.json();
  return data.data;
}

/**
 * Removes ALL diacritics/tashkeel for comparison purposes only
 */
function stripDiacritics(text: string): string {
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '');
}

/**
 * Normalize alef variants for comparison
 */
function normalizeAlef(text: string): string {
  return text.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
}

/**
 * The Bismillah phrase (bare consonantal skeleton after stripping diacritics + normalizing alef)
 * This matches ANY orthographic variant the API might return.
 *
 * بسم الله الرحمن الرحيم
 */
const BISMILLAH_SKELETON = normalizeAlef(stripDiacritics('بسم الله الرحمن الرحيم'));

/**
 * Checks whether the START of an ayah text (stripped + normalized) begins with Bismillah.
 * Returns the character count to remove from the ORIGINAL text if so, else 0.
 */
function bismillahPrefixLength(originalText: string): number {
  const stripped = normalizeAlef(stripDiacritics(originalText));
  if (!stripped.startsWith(BISMILLAH_SKELETON)) return 0;

  // Walk original text consuming characters until we've matched BISMILLAH_SKELETON.length
  // stripped chars (non-diacritic chars map 1:1 to original non-diacritic chars).
  let origIdx = 0;
  let skelIdx = 0;
  while (origIdx < originalText.length && skelIdx < BISMILLAH_SKELETON.length) {
    const origChar = originalText[origIdx];
    const origNorm = normalizeAlef(stripDiacritics(origChar));
    if (origNorm.length > 0) {
      skelIdx += origNorm.length;
    }
    origIdx++;
  }
  // Skip any trailing whitespace after the bismillah in the original
  while (origIdx < originalText.length && /\s/.test(originalText[origIdx])) origIdx++;
  return origIdx;
}

/**
 * Surat At-Tawbah (9) has NO Bismillah at all.
 * Surat Al-Fatiha (1): Bismillah IS ayah 1 — keep it as words to recite.
 * All other surahs: Bismillah prefixes ayah 1 in the API response — strip it.
 */
export async function fetchSurahText(surahNumber: number): Promise<QuranWord[]> {
  const res = await fetch(SURAH_TEXT_URL(surahNumber));
  const data = await res.json();
  const ayahs: AyahData[] = data.data.ayahs;

  const words: QuranWord[] = [];
  let globalIndex = 0;

  for (const ayah of ayahs) {
    let text = ayah.text;

    // For all surahs except Al-Fatiha (1) and At-Tawbah (9),
    // strip Bismillah from the beginning of ayah 1.
    if (surahNumber !== 1 && surahNumber !== 9 && ayah.numberInSurah === 1) {
      const prefixLen = bismillahPrefixLength(text);
      if (prefixLen > 0) {
        text = text.slice(prefixLen).trim();
      }
    }

    const ayahWords = text.split(/\s+/).filter(w => w.length > 0);
    for (let i = 0; i < ayahWords.length; i++) {
      words.push({
        text: ayahWords[i],
        ayahNumber: ayah.numberInSurah,
        wordIndex: i,
        globalIndex: globalIndex++,
      });
    }
  }

  return words;
}
