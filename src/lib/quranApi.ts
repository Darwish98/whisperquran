/**
 * quranApi.ts
 *
 * Text via  api.alquran.cloud   (Uthmani script)
 * Audio via cdn.islamic.network
 *
 * AUDIO URL FORMAT (ayah-level):
 *   https://cdn.islamic.network/quran/audio/{bitrate}/{reciterId}/{globalAyahNumber}.mp3
 *   {globalAyahNumber} is 1–6236 (NOT surah+ayah padded together)
 *   e.g. Surah 1 Ayah 1 = .../ar.alafasy/1.mp3
 *        Surah 2 Ayah 1 = .../ar.alafasy/8.mp3
 *
 * BITRATE: Not all reciters are available at 128kbps. Each reciter entry
 * specifies its own bitrate based on what the CDN actually hosts.
 */

export interface SurahInfo {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
}

export interface QuranWord {
  text: string;
  ayahNumber: number; // ayah number within surah (1-based)
  globalAyahNumber: number; // global ayah number 1–6236 for audio URLs
  page: number; // Madani mushaf page 1–604
  wordIndex: number;
  globalIndex: number;
}

export interface AyahData {
  number: number; // global ayah number 1–6236
  text: string;
  numberInSurah: number;
  page: number; // Madani mushaf page 1–604
}

export interface Reciter {
  id: string;
  name: string;
  nameAr: string;
  riwaya: string;
  riwayaAr: string;
  bitrate: number; // CDN-available bitrate for this reciter
}

export const RECITERS: Reciter[] = [
  {
    id: "ar.alafasy",
    name: "Mishary Rashid Alafasy",
    nameAr: "مشاري راشد العفاسي",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 128,
  },
  {
    id: "ar.abdurrahmaansudais",
    name: "Abdurrahmaan As-Sudais",
    nameAr: "عبدالرحمن السديس",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 192,
  },
  {
    id: "ar.saoodshuraym",
    name: "Saud Al-Shuraim",
    nameAr: "سعود الشريم",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 64,
  },
  {
    id: "ar.mahermuaiqly",
    name: "Maher Al-Muaiqly",
    nameAr: "ماهر المعيقلي",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 128,
  },
  {
    id: "ar.husary",
    name: "Mahmoud Khalil Al-Husary",
    nameAr: "محمود خليل الحصري",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 128,
  },
  {
    id: "ar.minshawi",
    name: "Mohamed Siddiq El-Minshawi",
    nameAr: "محمد صديق المنشاوي",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 128,
  },
  {
    id: "ar.muhammadayyoub",
    name: "Muhammad Ayyub",
    nameAr: "محمد أيوب",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 128,
  },
  {
    id: "ar.shaatree",
    name: "Abu Bakr Al-Shatri",
    nameAr: "أبو بكر الشاطري",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 128,
  },
  {
    id: "ar.hanirifai",
    name: "Hani Ar-Rifai",
    nameAr: "هاني الرفاعي",
    riwaya: "Hafs an Asim",
    riwayaAr: "حفص عن عاصم",
    bitrate: 192,
  },
  {
    id: "ar.ibrahimakhbar",
    name: "Ibrahim Al-Akhdar",
    nameAr: "إبراهيم الأخضر",
    riwaya: "Warsh an Nafi'",
    riwayaAr: "ورش عن نافع",
    bitrate: 32,
  },
  {
    id: "ar.husarymujawwad",
    name: "Al-Husary (Mujawwad)",
    nameAr: "الحصري (مجوّد)",
    riwaya: "Qalun an Nafi'",
    riwayaAr: "قالون عن نافع",
    bitrate: 128,
  },
];

export const DEFAULT_RECITER = RECITERS[0];

const CDN = "https://cdn.islamic.network/quran/audio";

/**
 * Ayah audio URL using GLOBAL ayah number (1–6236).
 * Uses the reciter's own bitrate from the RECITERS array.
 */
export function getAyahAudioUrl(
  globalAyahNumber: number,
  reciterId: string = DEFAULT_RECITER.id,
): string {
  const reciter = RECITERS.find((r) => r.id === reciterId);
  const bitrate = reciter?.bitrate ?? 128;
  return `${CDN}/${bitrate}/${reciterId}/${globalAyahNumber}.mp3`;
}

const SURAH_LIST_URL = "https://api.alquran.cloud/v1/surah";
const SURAH_TEXT_URL = (n: number) =>
  `https://api.alquran.cloud/v1/surah/${n}/quran-uthmani`;

export async function fetchSurahList(): Promise<SurahInfo[]> {
  const res = await fetch(SURAH_LIST_URL);
  const data = await res.json();
  return data.data;
}

function stripDiacritics(t: string): string {
  return t.replace(
    /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g,
    "",
  );
}

function normalizeAlef(t: string): string {
  return t.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627");
}

const BISMILLAH_SKELETON = normalizeAlef(
  stripDiacritics("بسم الله الرحمن الرحيم"),
);

function bismillahPrefixLength(original: string): number {
  const stripped = normalizeAlef(stripDiacritics(original));
  if (!stripped.startsWith(BISMILLAH_SKELETON)) return 0;
  let origIdx = 0,
    skelIdx = 0;
  while (origIdx < original.length && skelIdx < BISMILLAH_SKELETON.length) {
    const norm = normalizeAlef(stripDiacritics(original[origIdx]));
    if (norm.length > 0) skelIdx += norm.length;
    origIdx++;
  }
  while (origIdx < original.length && /\s/.test(original[origIdx])) origIdx++;
  return origIdx;
}

export async function fetchSurahText(
  surahNumber: number,
): Promise<QuranWord[]> {
  const res = await fetch(SURAH_TEXT_URL(surahNumber));
  const data = await res.json();
  const ayahs: AyahData[] = data.data.ayahs;

  const result: QuranWord[] = [];
  let globalIndex = 0;

  for (const ayah of ayahs) {
    let text = ayah.text;

    if (surahNumber !== 1 && surahNumber !== 9 && ayah.numberInSurah === 1) {
      const len = bismillahPrefixLength(text);
      if (len > 0) text = text.slice(len).trim();
    }

    for (const [i, wordText] of text.split(/\s+/).filter(Boolean).entries()) {
      result.push({
        text: wordText,
        ayahNumber: ayah.numberInSurah,
        globalAyahNumber: ayah.number,
        page: ayah.page,
        wordIndex: i,
        globalIndex: globalIndex++,
      });
    }
  }

  return result;
}
