// Normalize Arabic text by removing diacritics (tashkeel) for comparison
const DIACRITICS_REGEX = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g;

export function removeDiacritics(text: string): string {
  return text.replace(DIACRITICS_REGEX, '');
}

// Normalize alef variants, taa marbuta, etc.
export function normalizeArabic(text: string): string {
  let normalized = removeDiacritics(text.trim());
  // Normalize alef variants
  normalized = normalized.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
  // Normalize taa marbuta to haa
  normalized = normalized.replace(/\u0629/g, '\u0647');
  // Normalize alef maqsura to yaa
  normalized = normalized.replace(/\u0649/g, '\u064A');
  // Remove tatweel
  normalized = normalized.replace(/\u0640/g, '');
  return normalized;
}

export function wordsMatch(spoken: string, expected: string): boolean {
  const normalSpoken = normalizeArabic(spoken);
  const normalExpected = normalizeArabic(expected);
  
  // Direct match
  if (normalSpoken === normalExpected) return true;
  
  // Check if the spoken text contains the expected word
  const spokenWords = normalSpoken.split(/\s+/);
  return spokenWords.some(w => w === normalExpected);
}
