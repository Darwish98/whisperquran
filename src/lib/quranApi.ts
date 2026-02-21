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

// Surah list
const SURAH_LIST_URL = 'https://api.alquran.cloud/v1/surah';
// Surah text
const SURAH_TEXT_URL = (num: number) => `https://api.alquran.cloud/v1/surah/${num}`;

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
    // Split ayah into words
    const ayahWords = ayah.text.split(/\s+/).filter(w => w.length > 0);
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
