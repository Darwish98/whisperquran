// Normalize Arabic text by removing diacritics (tashkeel) for comparison
const DIACRITICS_REGEX = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0616-\u061A\u0653-\u0655\uFE70-\uFE7F]/g;

export function removeDiacritics(text: string): string {
  return text.replace(DIACRITICS_REGEX, '');
}

export function normalizeArabic(text: string): string {
  let normalized = removeDiacritics(text.trim());
  // Normalize alef variants
  normalized = normalized.replace(/[\u0622\u0623\u0625\u0671\u0627\u0654\u0655]/g, '\u0627');
  // Normalize taa marbuta to haa
  normalized = normalized.replace(/\u0629/g, '\u0647');
  // Normalize alef maqsura to yaa
  normalized = normalized.replace(/\u0649/g, '\u064A');
  // Remove tatweel
  normalized = normalized.replace(/\u0640/g, '');
  // Remove zero-width characters
  normalized = normalized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  // Normalize spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

// Check if two individual words match (fuzzy)
function fuzzyWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;
  
  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;

  // Levenshtein-like: allow up to 2 char difference for words > 3 chars
  if (a.length > 3 && b.length > 3) {
    const maxLen = Math.max(a.length, b.length);
    const dist = levenshtein(a, b);
    if (dist <= Math.min(2, Math.floor(maxLen * 0.3))) return true;
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
  const normalSpoken = normalizeArabic(spoken);
  const normalExpected = normalizeArabic(expected);

  // Direct match
  if (normalSpoken === normalExpected) return true;

  // Check if any spoken word matches expected
  const spokenWords = normalSpoken.split(/\s+/);
  for (const w of spokenWords) {
    if (fuzzyWordMatch(w, normalExpected)) return true;
  }

  // Check if expected appears anywhere in spoken
  if (normalSpoken.includes(normalExpected)) return true;

  return false;
}

// Given a transcription and a list of expected words starting at startIdx,
// return how many consecutive expected words were matched
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
    } else {
      // Try skipping a spoken word (filler/noise)
      if (spokenIdx + 1 < spokenWords.length && fuzzyWordMatch(spokenWords[spokenIdx + 1], normalExpected)) {
        matched++;
        spokenIdx += 2;
      } else {
        break;
      }
    }
  }

  // If no sequential match, check if at least the first expected word appears anywhere
  if (matched === 0) {
    const normalExpected = normalizeArabic(expectedWords[startIdx].text);
    for (const w of spokenWords) {
      if (fuzzyWordMatch(w, normalExpected)) return 1;
    }
    // Last resort: check substring
    if (normalTranscription.includes(normalExpected)) return 1;
  }

  return matched;
}
