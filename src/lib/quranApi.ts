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
// Use Uthmani script for authoritative text
const SURAH_TEXT_URL = (num: number) => `https://api.alquran.cloud/v1/surah/${num}/quran-uthmani`;

// Word-level audio from everyayah.com
export function getWordAudioUrl(surahNumber: number, ayahNumber: number, wordIndex: number): string {
  const s = String(surahNumber).padStart(3, '0');
  const a = String(ayahNumber).padStart(3, '0');
  const w = String(wordIndex + 1).padStart(3, '0');
  return `https://audio.qurancdn.com/wbw/001_${s}_${a}_${w}.mp3`;
}

// Ayah-level audio (Mishary Rashid Alafasy)
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

export async function fetchSurahText(surahNumber: number): Promise<QuranWord[]> {
  const res = await fetch(SURAH_TEXT_URL(surahNumber));
  const data = await res.json();
  const ayahs: AyahData[] = data.data.ayahs;
  
  const words: QuranWord[] = [];
  let globalIndex = 0;
  
  for (const ayah of ayahs) {
    // Skip Bismillah for all surahs except Al-Fatiha (1) and At-Tawbah (9, has no Bismillah)
    let text = ayah.text;
    if (surahNumber !== 1 && ayah.numberInSurah === 1) {
      // Remove the Bismillah prefix if present
      const bismillah = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
      if (text.startsWith(bismillah)) {
        text = text.slice(bismillah.length).trim();
      }
      // Also try without specific diacritics
      const bismillahAlt = 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ';
      if (text.startsWith(bismillahAlt)) {
        text = text.slice(bismillahAlt.length).trim();
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
