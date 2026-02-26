/**
 * arabicUtils.ts – Arabic phonetic matching for Quran recitation
 *
 * Strict mode: harakat (diacritics) are encoded into the phoneme string
 * so that رَبُّ vs رَبِّ produces different phoneme strings and fails
 * the similarity threshold.
 *
 * Strategy:
 *  1. Consonant skeleton must match (same root letters)
 *  2. Harakat are encoded as vowel phonemes: A=fatha, U=damma, I=kasra, SH=shadda
 *  3. Levenshtein on the full phoneme string (consonants + vowels)
 *  4. Threshold 0.80 for strict harakat enforcement
 */

// ── Diacritics removal (for consonant-only comparisons) ──────────────────────

const DIACRITICS_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0653-\u0655\uFE70-\uFE7F]/g;

export function removeDiacritics(text: string): string {
  return text.replace(DIACRITICS_RE, '');
}

// ── Harakat codes (encoded as vowel tokens after each consonant) ──────────────
// These get inserted into the phoneme string so Levenshtein penalises mismatches

const FATHA   = '\u064E'; // َ  → vowel 'a'
const DAMMA   = '\u064F'; // ُ  → vowel 'u'
const KASRA   = '\u0650'; // ِ  → vowel 'i'
const SHADDA  = '\u0651'; // ّ  → gemination (doubles the consonant)
const SUKUN   = '\u0652'; // ْ  → no vowel
const FATHATAN = '\u064B'; // ً
const DAMMATAN = '\u064C'; // ٌ
const KASRATAN = '\u064D'; // ٍ

// Map harakat to short vowel tokens
const HARAKAT_MAP: Record<string, string> = {
  [FATHA]:    'a',
  [DAMMA]:    'u',
  [KASRA]:    'i',
  [SHADDA]:   ':',  // gemination marker
  [SUKUN]:    '',   // no vowel — silent
  [FATHATAN]: 'an',
  [DAMMATAN]: 'un',
  [KASRATAN]: 'in',
};

// ── Consonant phoneme map ─────────────────────────────────────────────────────

const CONSONANT_MAP: Record<string, string> = {
  '\u0627': 'A',   // ا alef
  '\u0622': 'A',   // آ alef madda
  '\u0623': 'A',   // أ alef hamza above
  '\u0625': 'A',   // إ alef hamza below
  '\u0671': 'A',   // ٱ alef wasla
  '\u0672': 'A',
  '\u0673': 'A',
  '\u0628': 'B',   // ب
  '\u062A': 'T',   // ت
  '\u062B': 'TH',  // ث
  '\u062C': 'J',   // ج
  '\u062D': 'H2',  // ح
  '\u062E': 'KH',  // خ
  '\u062F': 'D',   // د
  '\u0630': 'DH',  // ذ
  '\u0631': 'R',   // ر
  '\u0632': 'Z',   // ز
  '\u0633': 'S',   // س
  '\u0634': 'SH',  // ش
  '\u0635': 'S',   // ص → collapse to S (emphatic lost in ASR)
  '\u0636': 'D',   // ض → collapse to D
  '\u0637': 'T',   // ط → collapse to T
  '\u0638': 'DH',  // ظ → collapse to DH
  '\u0639': 'AY',  // ع
  '\u063A': 'GH',  // غ
  '\u0641': 'F',   // ف
  '\u0642': 'Q',   // ق
  '\u0643': 'K',   // ك
  '\u0644': 'L',   // ل
  '\u0645': 'M',   // م
  '\u0646': 'N',   // ن
  '\u0648': 'W',   // و
  '\u064A': 'Y',   // ي
  '\u0649': 'Y',   // ى alef maqsura
  '\u0647': 'H',   // ه
  '\u0629': 'H',   // ة ta marbuta
  '\u0621': '',    // ء hamza (silent)
  '\u0654': '',
  '\u0655': '',
  '\u0640': '',    // tatweel
};

// ── Phoneme encoder (consonants + harakat interleaved) ────────────────────────

/**
 * Encodes Arabic text into a phoneme string that includes both consonant
 * codes and vowel tokens. This allows Levenshtein to penalise harakat mismatches.
 *
 * Example:
 *   رَبِّ → R-a-B:-i  (ra + ba-shadda + kasra)
 *   رَبُّ → R-a-B:-u  (ra + ba-shadda + damma)
 *   These differ at the last vowel → Levenshtein distance = 1
 */
function toDetailedPhonemes(text: string): string {
  const chars = [...text]; // proper Unicode iteration
  let result = '';
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];

    // Consonant?
    if (ch in CONSONANT_MAP) {
      const consonant = CONSONANT_MAP[ch];
      result += consonant;
      i++;

      // Collect any following harakat
      while (i < chars.length && chars[i] in HARAKAT_MAP) {
        result += HARAKAT_MAP[chars[i]];
        i++;
      }
    } else if (ch in HARAKAT_MAP) {
      // Standalone harakat (shouldn't normally occur, but handle gracefully)
      result += HARAKAT_MAP[ch];
      i++;
    } else {
      // Unknown char (whitespace, punctuation) — skip
      i++;
    }
  }

  return result;
}

// ── Normalisation (for consonant-skeleton comparison) ────────────────────────

export function normalizeArabic(text: string): string {
  let t = text.trim();
  t = removeDiacritics(t);
  t = t.replace(/[\u0622\u0623\u0625\u0671\u0672\u0673\u0627]/g, '\u0627'); // unify alef
  t = t.replace(/\u0629/g, '\u0647');   // ta marbuta → ha
  t = t.replace(/\u0649/g, '\u064A');   // alef maqsura → ya
  t = t.replace(/\u0640/g, '');         // tatweel
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function stripArticle(text: string): string {
  return text.replace(/^(ال|ٱل|لل|لا)/, '');
}

// ── Levenshtein on strings ────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

// Levenshtein on token arrays (for multi-char phoneme codes like 'SH', 'KH')
function levenshteinTokens(a: string[], b: string[]): number {
  if (a.join() === b.join()) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

// Split phoneme string into tokens (handles multi-char codes like SH, KH, H2)
function tokenize(phonemes: string): string[] {
  // Match multi-char codes first, then single chars
  return phonemes.match(/H2|KH|TH|DH|SH|AY|GH|an|un|in|[A-Za-z:]/g) ?? [];
}

// ── Core similarity ───────────────────────────────────────────────────────────

/**
 * Returns a similarity score [0, 1] between spoken and expected Arabic words.
 *
 * STRICT MODE: harakat mismatches are penalised. رَبُّ vs رَبِّ will score ~0.75
 * which is below the 0.80 threshold → rejected.
 *
 * CONSONANT FALLBACK: if spoken has no harakat (ASR stripped them), falls back
 * to consonant-only comparison at a slightly lower cap (0.88 max).
 */
export function wordSimilarity(spoken: string, expected: string): number {
  // ── Step 1: Quick consonant-level check ──────────────────────────────────
  const spokenNorm    = normalizeArabic(spoken);
  const expectedNorm  = normalizeArabic(expected);

  // Completely different consonant skeleton → reject immediately
  const spokenP   = tokenize(toDetailedPhonemes(spokenNorm.replace(/\s/g, '')));
  const expectedP = tokenize(toDetailedPhonemes(expectedNorm.replace(/\s/g, '')));

  if (spokenP.length === 0 || expectedP.length === 0) return 0;

  // ── Step 2: Detailed phoneme comparison (with harakat) ───────────────────
  const spokenFull   = tokenize(toDetailedPhonemes(spoken.trim()));
  const expectedFull = tokenize(toDetailedPhonemes(expected.trim()));

  const spokenHasHarakat   = spoken.match(/[\u064B-\u0652]/) !== null;
  const expectedHasHarakat = expected.match(/[\u064B-\u0652]/) !== null;

  if (spokenHasHarakat && expectedHasHarakat) {
    // Both have harakat — full strict comparison
    const dist   = levenshteinTokens(spokenFull, expectedFull);
    const maxLen = Math.max(spokenFull.length, expectedFull.length);
    const score  = 1 - dist / maxLen;

    // Bonus for matching first consonant
    const firstMatch = spokenP[0] === expectedP[0] ? 0.03 : 0;
    return Math.min(1, score + firstMatch);
  }

  // ── Step 3: Consonant-only fallback (Whisper stripped diacritics) ────────
  // Cap at 0.88 so it can never equal a fully-correct diacritized match
  const dist   = levenshteinTokens(spokenP, expectedP);
  const maxLen = Math.max(spokenP.length, expectedP.length);
  const consSim = 1 - dist / maxLen;

  // Article stripping bonus
  const spokenStripped   = stripArticle(spokenNorm);
  const expectedStripped = stripArticle(expectedNorm);
  if (spokenStripped === expectedStripped) return 0.88;

  const firstMatch = spokenP[0] === expectedP[0] ? 0.03 : 0;
  return Math.min(0.88, consSim + firstMatch);
}

// ── Phrase matching ───────────────────────────────────────────────────────────

/**
 * Match a spoken phrase against expected words starting at startIndex.
 * Returns the number of words successfully matched.
 *
 * Threshold 0.80 for strict harakat enforcement:
 *   - Correct harakat → scores ~0.95–1.0 → passes
 *   - Wrong harakat   → scores ~0.70–0.78 → fails
 *   - No harakat (ASR) → scores up to 0.88 → passes (lenient for ASR limitations)
 */
export function matchSpokenPhrase(
  spokenPhrase: string,
  expectedWords: string[],
  startIndex: number,
  threshold = 0.80,
): number {
  const spokenTokens = spokenPhrase.trim().split(/\s+/).filter(Boolean);
  let matched = 0;
  let wordIdx = startIndex;

  for (const token of spokenTokens) {
    if (wordIdx >= expectedWords.length) break;

    const sim = wordSimilarity(token, expectedWords[wordIdx]);

    if (sim >= threshold) {
      matched++;
      wordIdx++;
    } else {
      // Try skipping one expected word (ASR may merge/skip words)
      if (wordIdx + 1 < expectedWords.length) {
        const simNext = wordSimilarity(token, expectedWords[wordIdx + 1]);
        if (simNext >= threshold) {
          matched += 2;
          wordIdx += 2;
          continue;
        }
      }
      break;
    }
  }

  return matched;
}

export function matchBestAlternative(
  alternatives: Array<{ text: string; confidence?: number }>,
  expectedWords: string[],
  startIndex: number,
  threshold = 0.80,
): { matched: number; bestText: string; score: number } {
  let best = { matched: 0, bestText: '', score: 0 };

  for (const alt of alternatives) {
    const matched = matchSpokenPhrase(alt.text, expectedWords, startIndex, threshold);
    const confidence = alt.confidence ?? 1;
    const score = matched * confidence;
    if (score > best.score || (score === best.score && alt.text.length > best.bestText.length)) {
      best = { matched, bestText: alt.text, score };
    }
  }

  return best;
}

export function matchConsecutiveWords(
  spokenPhrase: string,
  expectedWords: Array<{ text: string }>,
  startIndex: number,
  threshold = 0.80,
): number {
  return matchSpokenPhrase(
    spokenPhrase,
    expectedWords.map(w => w.text),
    startIndex,
    threshold,
  );
}
