// Enhanced Arabic phonetic matching for Quran recitation

const DIACRITICS_REGEX = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0616-\u061A\u0653-\u0655\uFE70-\uFE7F]/g;

export function removeDiacritics(text: string): string {
  return text.replace(DIACRITICS_REGEX, '');
}

// Arabic phoneme mapping for phonetic comparison
const PHONEME_MAP: Record<string, string> = {
  '\u0627': 'A', // alef
  '\u0622': 'A', // alef madda
  '\u0623': 'A', // alef hamza above
  '\u0625': 'A', // alef hamza below
  '\u0671': 'A', // alef wasla
  '\u0628': 'B', // ba
  '\u062A': 'T', // ta
  '\u062B': 'TH', // tha
  '\u062C': 'J', // jim
  '\u062D': 'H', // ha
  '\u062E': 'KH', // kha
  '\u062F': 'D', // dal
  '\u0630': 'DH', // dhal
  '\u0631': 'R', // ra
  '\u0632': 'Z', // zay
  '\u0633': 'S', // sin
  '\u0634': 'SH', // shin
  '\u0635': 'S', // sad (maps to S for fuzzy matching)
  '\u0636': 'D', // dad (maps to D for fuzzy matching)
  '\u0637': 'T', // ta (emphatic, maps to T)
  '\u0638': 'DH', // dha (maps to DH)
  '\u0639': 'A', // ain (maps to A for speech recognition)
  '\u063A': 'GH', // ghain
  '\u0641': 'F', // fa
  '\u0642': 'Q', // qaf
  '\u0643': 'K', // kaf
  '\u0644': 'L', // lam
  '\u0645': 'M', // mim
  '\u0646': 'N', // nun
  '\u0647': 'H', // ha
  '\u0629': 'H', // ta marbuta
  '\u0648': 'W', // waw
  '\u064A': 'Y', // ya
  '\u0649': 'Y', // alef maqsura
  '\u0621': '', // hamza (often silent)
  '\u0654': '', // hamza above
  '\u0655': '', // hamza below
  '\u0640': '', // tatweel
};

function toPhonemes(text: string): string {
  const stripped = removeDiacritics(text);
  let result = '';
  for (const char of stripped) {
    const phoneme = PHONEME_MAP[char];
    if (phoneme !== undefined) {
      result += phoneme;
    }
  }
  return result;
}

export function normalizeArabic(text: string): string {
  let normalized = removeDiacritics(text.trim());
  normalized = normalized.replace(/[\u0622\u0623\u0625\u0671\u0627\u0654\u0655]/g, '\u0627');
  normalized = normalized.replace(/\u0629/g, '\u0647');
  normalized = normalized.replace(/\u0649/g, '\u064A');
  normalized = normalized.replace(/\u0640/g, '');
  normalized = normalized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

// Phonetic similarity score (0-1)
function phoneticSimilarity(a: string, b: string): number {
  const pa = toPhonemes(a);
  const pb = toPhonemes(b);
  if (pa === pb) return 1;
  if (pa.length === 0 || pb.length === 0) return 0;
  
  const maxLen = Math.max(pa.length, pb.length);
  const dist = levenshtein(pa, pb);
  return 1 - (dist / maxLen);
}

// Configurable threshold for phonetic matching
const PHONETIC_THRESHOLD = 0.7;

function fuzzyWordMatch(a: string, b: string): boolean {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  
  if (na === nb) return true;
  if (na.length === 0 || nb.length === 0) return false;
  
  // One contains the other
  if (na.includes(nb) || nb.includes(na)) return true;

  // Phonetic matching
  if (phoneticSimilarity(a, b) >= PHONETIC_THRESHOLD) return true;

  // Levenshtein on normalized text
  if (na.length > 2 && nb.length > 2) {
    const maxLen = Math.max(na.length, nb.length);
    const dist = levenshtein(na, nb);
    if (dist <= Math.min(2, Math.floor(maxLen * 0.35))) return true;
  }

  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

export function wordsMatch(spoken: string, expected: string): boolean {
  return fuzzyWordMatch(spoken, expected);
}

export function matchConsecutiveWords(
  transcription: string,
  expectedWords: { text: string }[],
  startIdx: number
): number {
  const normalTranscription = normalizeArabic(transcription);
  const spokenWords = normalTranscription.split(/\s+/).filter(w => w.length > 0);
  
  if (spokenWords.length === 0) return 0;

  let matched = 0;
  let spokenIdx = 0;

  for (let i = startIdx; i < expectedWords.length && spokenIdx < spokenWords.length; i++) {
    const normalExpected = normalizeArabic(expectedWords[i].text);
    
    if (fuzzyWordMatch(spokenWords[spokenIdx], normalExpected)) {
      matched++;
      spokenIdx++;
    } else if (spokenIdx + 1 < spokenWords.length && fuzzyWordMatch(spokenWords[spokenIdx + 1], normalExpected)) {
      matched++;
      spokenIdx += 2;
    } else {
      break;
    }
  }

  // Fallback: check first expected word anywhere
  if (matched === 0) {
    const normalExpected = normalizeArabic(expectedWords[startIdx].text);
    for (const w of spokenWords) {
      if (fuzzyWordMatch(w, normalExpected)) return 1;
    }
    if (normalTranscription.includes(normalExpected)) return 1;
  }

  return matched;
}
