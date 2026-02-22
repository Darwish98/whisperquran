/**
 * quranApi.ts
 *
 * Text via  api.alquran.cloud   (Uthmani script)
 * Audio via cdn.islamic.network (40+ reciters, multiple riwayat)
 *
 * Audio URL format:
 *   https://cdn.islamic.network/quran/audio/{bitrate}/{reciterId}/{surah}{ayah}.mp3
 *   e.g. .../128/ar.alafasy/001001.mp3
 */

// ── Interfaces ────────────────────────────────────────────────────────────────

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

// ── Reciters ──────────────────────────────────────────────────────────────────

export interface Reciter {
  id: string;           // cdn.islamic.network identifier
  name: string;
  nameAr: string;
  riwaya: string;       // e.g. "Hafs an Asim"
  riwayaAr: string;
}

/**
 * Curated list of reciters available on cdn.islamic.network.
 * All confirmed working at 128 kbps.
 */
export const RECITERS: Reciter[] = [
  // ── Hafs an Asim ─────────────────────────────────────────────────────────
  {
    id: 'ar.alafasy',
    name: 'Mishary Rashid Alafasy',
    nameAr: 'مشاري راشد العفاسي',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.abdurrahmaansudais',
    name: 'Abdurrahmaan As-Sudais',
    nameAr: 'عبدالرحمن السديس',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.saoodshuraym',
    name: 'Saud Al-Shuraim',
    nameAr: 'سعود الشريم',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.mahermuaiqly',
    name: 'Maher Al-Muaiqly',
    nameAr: 'ماهر المعيقلي',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.husary',
    name: 'Mahmoud Khalil Al-Husary',
    nameAr: 'محمود خليل الحصري',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.minshawi',
    name: 'Mohamed Siddiq El-Minshawi',
    nameAr: 'محمد صديق المنشاوي',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.muhammadayyoub',
    name: 'Muhammad Ayyub',
    nameAr: 'محمد أيوب',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.shaatree',
    name: 'Abu Bakr Al-Shatri',
    nameAr: 'أبو بكر الشاطري',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  {
    id: 'ar.hanirifai',
    name: 'Hani Ar-Rifai',
    nameAr: 'هاني الرفاعي',
    riwaya: 'Hafs an Asim',
    riwayaAr: 'حفص عن عاصم',
  },
  // ── Warsh an Nafi ────────────────────────────────────────────────────────
  {
    id: 'ar.ibrahimakhdar',
    name: 'Ibrahim Al-Akhdar',
    nameAr: 'إبراهيم الأخضر',
    riwaya: "Warsh an Nafi'",
    riwayaAr: 'ورش عن نافع',
  },
  // ── Qalun an Nafi ────────────────────────────────────────────────────────
  {
    id: 'ar.husarymujawwad',
    name: 'Al-Husary (Mujawwad)',
    nameAr: 'الحصري (مجوّد)',
    riwaya: "Qalun an Nafi'",
    riwayaAr: 'قالون عن نافع',
  },
];

export const DEFAULT_RECITER: Reciter = RECITERS[0]; // Alafasy

// ── Audio URL helpers ─────────────────────────────────────────────────────────

const CDN = 'https://cdn.islamic.network/quran/audio';

/**
 * Ayah-level audio URL for the "listen & repeat" help feature.
 * ref = SSSSAAA (surah 3-digit + ayah 3-digit, zero-padded)
 */
export function getAyahAudioUrl(
  surahNumber: number,
  ayahNumber: number,
  reciterId: string = DEFAULT_RECITER.id,
  bitrate = 128,
): string {
  const ref =
    String(surahNumber).padStart(3, '0') +
    String(ayahNumber).padStart(3, '0');
  return `${CDN}/${bitrate}/${reciterId}/${ref}.mp3`;
}

/**
 * Word-level audio from audio.qurancdn.com (Alafasy only, no reciter selection).
 * Kept for potential future single-word playback.
 */
export function getWordAudioUrl(
  surahNumber: number,
  ayahNumber: number,
  wordIndex: number,
): string {
  const s = String(surahNumber).padStart(3, '0');
  const a = String(ayahNumber).padStart(3, '0');
  const w = String(wordIndex + 1).padStart(3, '0');
  return `https://audio.qurancdn.com/wbw/${s}_${a}_${w}.mp3`;
}

// ── API helpers ───────────────────────────────────────────────────────────────

const SURAH_LIST_URL = 'https://api.alquran.cloud/v1/surah';
const SURAH_TEXT_URL = (n: number) => `https://api.alquran.cloud/v1/surah/${n}/quran-uthmani`;

export async function fetchSurahList(): Promise<SurahInfo[]> {
  const res = await fetch(SURAH_LIST_URL);
  const data = await res.json();
  return data.data;
}

// ── Bismillah stripping ───────────────────────────────────────────────────────

function stripDiacritics(t: string): string {
  return t.replace(
    /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g,
    '',
  );
}

function normalizeAlef(t: string): string {
  return t.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
}

const BISMILLAH_SKELETON = normalizeAlef(stripDiacritics('بسم الله الرحمن الرحيم'));

function bismillahPrefixLength(original: string): number {
  const stripped = normalizeAlef(stripDiacritics(original));
  if (!stripped.startsWith(BISMILLAH_SKELETON)) return 0;

  let origIdx = 0;
  let skelIdx = 0;
  while (origIdx < original.length && skelIdx < BISMILLAH_SKELETON.length) {
    const norm = normalizeAlef(stripDiacritics(original[origIdx]));
    if (norm.length > 0) skelIdx += norm.length;
    origIdx++;
  }
  while (origIdx < original.length && /\s/.test(original[origIdx])) origIdx++;
  return origIdx;
}

// ── fetchSurahText ────────────────────────────────────────────────────────────

export async function fetchSurahText(surahNumber: number): Promise<QuranWord[]> {
  const res = await fetch(SURAH_TEXT_URL(surahNumber));
  const data = await res.json();
  const ayahs: AyahData[] = data.data.ayahs;

  const result: QuranWord[] = [];
  let globalIndex = 0;

  for (const ayah of ayahs) {
    let text = ayah.text;

    // Strip Bismillah prefix from ayah 1 for all surahs except Al-Fatiha (1) and At-Tawbah (9)
    if (surahNumber !== 1 && surahNumber !== 9 && ayah.numberInSurah === 1) {
      const len = bismillahPrefixLength(text);
      if (len > 0) text = text.slice(len).trim();
    }

    for (const [i, wordText] of text.split(/\s+/).filter(Boolean).entries()) {
      result.push({
        text: wordText,
        ayahNumber: ayah.numberInSurah,
        wordIndex: i,
        globalIndex: globalIndex++,
      });
    }
  }

  return result;
}
