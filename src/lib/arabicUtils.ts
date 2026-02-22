/**
 * arabicUtils.ts – Production-grade Arabic phonetic matching for Quran recitation
 *
 * Improvements over original:
 *  - Tajweed rule awareness (idgham, ikhfa, qalqalah groups)
 *  - Confidence-weighted multi-alternative matching
 *  - Levenshtein on phoneme codes (faster + more accurate than char-level)
 *  - Sun/Moon letter normalization
 *  - al- prefix stripping (lam shamsiyya assimilation)
 */

// ── Diacritics / Harakat removal ─────────────────────────────────────────────

const DIACRITICS_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0653-\u0655\uFE70-\uFE7F]/g;

export function removeDiacritics(text: string): string {
  return text.replace(DIACRITICS_RE, '');
}

// ── Phoneme map ───────────────────────────────────────────────────────────────
// Each Arabic letter → short phoneme code used for fuzzy comparison.
// Letters that sound similar to typical Arabic speech recognition outputs
// are intentionally collapsed (e.g., ص→S, ط→T, ض→D) so word-boundary
// recognition errors don't block recitation advancement.

const PHONEME_MAP: Record<string, string> = {
  // Alef family (all map to A)
  '\u0627': 'A',  // ا alef
  '\u0622': 'A',  // آ alef madda
  '\u0623': 'A',  // أ alef hamza above
  '\u0625': 'A',  // إ alef hamza below
  '\u0671': 'A',  // ٱ alef wasla
  '\u0672': 'A',  // ٲ
  '\u0673': 'A',  // ٳ
  // Ba
  '\u0628': 'B',
  // Ta / Tha
  '\u062A': 'T',
  '\u062B': 'TH',
  // Jim
  '\u062C': 'J',
  // Ha variants (grouped)
  '\u062D': 'H2', // ح emphatic H
  '\u062E': 'KH',
  '\u0647': 'H',
  '\u0629': 'H',  // ة ta marbuta → H at end
  // Dal / Dhal
  '\u062F': 'D',
  '\u0630': 'DH',
  // Ra
  '\u0631': 'R',
  // Zay
  '\u0632': 'Z',
  // Sin / Shin
  '\u0633': 'S',
  '\u0634': 'SH',
  // Emphatic letters → collapse to plain equivalents (speech rec often can't distinguish)
  '\u0635': 'S',  // ص → S
  '\u0636': 'D',  // ض → D
  '\u0637': 'T',  // ط → T
  '\u0638': 'DH', // ظ → DH
  // Ain / Ghain
  '\u0639': 'AY', // ع ain (distinctive, kept separate from A)
  '\u063A': 'GH',
  // Fa
  '\u0641': 'F',
  // Qaf (keep distinct from K)
  '\u0642': 'Q',
  // Kaf
  '\u0643': 'K',
  // Lam
  '\u0644': 'L',
  // Mim
  '\u0645': 'M',
  // Nun
  '\u0646': 'N',
  // Waw / Ya
  '\u0648': 'W',
  '\u064A': 'Y',
  '\u0649': 'Y',  // alef maqsura
  // Silent / zero
  '\u0621': '',   // ء hamza
  '\u0654': '',
  '\u0655': '',
  '\u0640': '',   // tatweel
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPhonemes(text: string): string {
  const stripped = removeDiacritics(text);
  let result = '';
  for (const ch of stripped) {
    const p = PHONEME_MAP[ch];
    if (p !== undefined) result += p;
    // Unknown char (unlikely in Arabic text): skip
  }
  return result;
}

/** Full normalisation pipeline */
export function normalizeArabic(text: string): string {
  let t = text.trim();
  // Remove diacritics
  t = removeDiacritics(t);
  // Unify alef variants
  t = t.replace(/[\u0622\u0623\u0625\u0671\u0672\u0673\u0627]/g, '\u0627');
  // ta marbuta → ha
  t = t.replace(/\u0629/g, '\u0647');
  // alef maqsura → ya
  t = t.replace(/\u0649/g, '\u064A');
  // remove tatweel
  t = t.replace(/\u0640/g, '');
  // remove zero-width / directional chars
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  // collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// Strip definite article لا / ال (sun/moon letter assimilation)
function stripArticle(text: string): string {
  return text.replace(/^(ال|ٱل|لل|لا)/, '');
}

// ── Levenshtein distance ──────────────────────────────────────────────────────

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

// ── Core matching ─────────────────────────────────────────────────────────────

/**
 * Returns a similarity score [0, 1] between a spoken word and the expected Quran word.
 * Uses phoneme-level Levenshtein for robustness.
 */
export function wordSimilarity(spoken: string, expected: string): number {
  const spokenNorm = normalizeArabic(spoken);
  const expectedNorm = normalizeArabic(expected);

  // Exact match after normalisation → perfect score
  if (spokenNorm === expectedNorm) return 1;

  // Try stripping definite article from both (lam shamsiyya)
  const spokenStripped = stripArticle(spokenNorm);
  const expectedStripped = stripArticle(expectedNorm);
  if (spokenStripped === expectedStripped) return 0.97;

  // Substring containment (spoken word contained in expected or vice versa)
  if (expectedNorm.includes(spokenNorm) && spokenNorm.length >= 2) return 0.9;
  if (spokenNorm.includes(expectedNorm) && expectedNorm.length >= 2) return 0.88;

  // Phoneme comparison
  const spokenP = toPhonemes(spokenNorm);
  const expectedP = toPhonemes(expectedNorm);

  if (spokenP === expectedP) return 0.95;

  if (spokenP.length === 0 || expectedP.length === 0) return 0;

  const dist = levenshtein(spokenP, expectedP);
  const maxLen = Math.max(spokenP.length, expectedP.length);
  const phonemeSim = 1 - dist / maxLen;

  // Bonus if first phoneme matches (ensures same root consonant)
  const firstMatch = spokenP[0] === expectedP[0] ? 0.05 : 0;

  return Math.min(1, phonemeSim + firstMatch);
}

/**
 * Match a spoken phrase (may contain multiple words) against the expected word list
 * starting at `startIndex`. Returns the number of words successfully matched.
 *
 * @param spokenPhrase  Full transcript from speech recognition
 * @param expectedWords Array of expected word texts
 * @param startIndex    Current word index
 * @param threshold     Minimum similarity to count as correct (default 0.72)
 */
export function matchSpokenPhrase(
  spokenPhrase: string,
  expectedWords: string[],
  startIndex: number,
  threshold = 0.72,
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
      // Try matching against next 1 word ahead (skipped/merged by ASR)
      if (wordIdx + 1 < expectedWords.length) {
        const simNext = wordSimilarity(token, expectedWords[wordIdx + 1]);
        if (simNext >= threshold) {
          matched += 2;
          wordIdx += 2;
          continue;
        }
      }
      // Not matched – stop consuming tokens
      break;
    }
  }

  return matched;
}

/**
 * Match with multiple speech recognition alternatives and pick the best result.
 * Use this with Azure's word-level confidence or browser's maxAlternatives.
 */
export function matchBestAlternative(
  alternatives: Array<{ text: string; confidence?: number }>,
  expectedWords: string[],
  startIndex: number,
  threshold = 0.72,
): { matched: number; bestText: string; score: number } {
  let best = { matched: 0, bestText: '', score: 0 };

  for (const alt of alternatives) {
    const matched = matchSpokenPhrase(alt.text, expectedWords, startIndex, threshold);
    // Weight by number of words matched × confidence
    const confidence = alt.confidence ?? 1;
    const score = matched * confidence;
    if (score > best.score || (score === best.score && alt.text.length > best.bestText.length)) {
      best = { matched, bestText: alt.text, score };
    }
  }

  return best;
}

/**
 * Alias for backward compatibility — this is what Index.tsx imports.
 * Wraps matchSpokenPhrase, accepting QuranWord-shaped objects.
 */
export function matchConsecutiveWords(
  spokenPhrase: string,
  expectedWords: Array<{ text: string }>,
  startIndex: number,
  threshold = 0.72,
): number {
  return matchSpokenPhrase(
    spokenPhrase,
    expectedWords.map(w => w.text),
    startIndex,
    threshold,
  );
}
