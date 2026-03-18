/**
 * ctc_matcher.ts — TypeScript port of ctc_matcher.py
 * ====================================================
 *
 * Direct port — same algorithm, same thresholds, same two-tier matching.
 * Runs entirely in the browser, no server needed.
 *
 * Usage:
 *   const session = new RecitationSession(surahWords);
 *   const result  = session.matchTranscript("بِسْمِ ٱللَّهِ", timings);
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SurahWord {
  text: string; // diacritized Uthmani
  norm: string; // normalized (stripped)
  ayah: number;
  wordInAyah: number;
  globalIndex: number;
}

export interface WordTiming {
  word: string;
  durationMs: number;
  startMs: number;
  endMs: number;
}

export interface WordMatch {
  globalIndex: number;
  expected: string;
  spoken: string;
  similarity: number;
  matched: boolean;
  ayah: number;
  wordInAyah: number;
  durationMs?: number;
}

export interface MatchResult {
  words: WordMatch[];
  wordsMatched: number;
  newPosition: number;
  ayah: number;
  complete: boolean;
  type: "match";
  position: number; // alias for newPosition (wire compat)
  totalWords: number;
  transcript: string;
}

// ── Arabic normalization ──────────────────────────────────────────────────────

const HARAKAT_RE = /[\u064B-\u0652\u0670]/g;
const TATWEEL_RE = /\u0640/g;

export function stripDiacritics(text: string): string {
  return text.replace(HARAKAT_RE, "").replace(TATWEEL_RE, "");
}

export function hasTashkeel(text: string): boolean {
  return HARAKAT_RE.test(text);
}

export function normalizeArabic(text: string): string {
  return stripDiacritics(text)
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // normalize alef variants
    .replace(/\u0629/g, "\u0647") // taa marbuta → haa
    .replace(/\u0649/g, "\u064A") // alef maqsura → ya
    .trim();
}

function simplifyUthmani(t: string): string {
  return t
    .replace(/\u0670/g, "") // superscript alef
    .replace(/\u0671/g, "\u0627") // alef wasla → alef
    .replace(/[\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "")
    .replace(/\u0640/g, ""); // tatweel
}

// ── Levenshtein distance ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// ── Word similarity ───────────────────────────────────────────────────────────
// Two-tier: diacritized (RNNT output) or normalized (CTC/fallback).

function wordSimilarity(
  spokenRaw: string,
  spokenNorm: string,
  spokenHasTashkeel: boolean,
  expectedRaw: string,
  expectedNorm: string,
): number {
  if (spokenRaw === expectedRaw) return 1.0;
  if (spokenNorm === expectedNorm) return spokenHasTashkeel ? 0.85 : 0.9;
  if (!spokenNorm || !expectedNorm) return 0.0;

  let diacritizedSim = 0;
  if (spokenHasTashkeel) {
    const ss = simplifyUthmani(spokenRaw);
    const es = simplifyUthmani(expectedRaw);
    if (ss === es) return 0.98;
    const dist = levenshtein(ss, es);
    const maxLen = Math.max(ss.length, es.length);
    diacritizedSim = maxLen > 0 ? 1 - dist / maxLen : 0;
    if (ss[0] && es[0] && ss[0] === es[0]) diacritizedSim += 0.02;
  }

  const distNorm = levenshtein(spokenNorm, expectedNorm);
  const maxLenNorm = Math.max(spokenNorm.length, expectedNorm.length);
  let normalizedSim = maxLenNorm > 0 ? 1 - distNorm / maxLenNorm : 0;
  if (spokenNorm[0] && expectedNorm[0] && spokenNorm[0] === expectedNorm[0]) {
    normalizedSim += 0.03;
  }

  // Article stripping bonus
  const stripArticle = (t: string) => t.replace(/^(ال|ٱل|لل|لا)/, "");
  const sStrip = stripArticle(spokenNorm);
  const eStrip = stripArticle(expectedNorm);
  if (sStrip && eStrip) {
    if (sStrip === eStrip) {
      normalizedSim = Math.max(normalizedSim, 0.88);
    } else {
      const d2 = levenshtein(sStrip, eStrip);
      const m2 = Math.max(sStrip.length, eStrip.length);
      normalizedSim = Math.max(normalizedSim, m2 > 0 ? 1 - d2 / m2 + 0.03 : 0);
    }
  }

  if (!spokenHasTashkeel) normalizedSim = Math.min(0.9, normalizedSim);

  return Math.min(1.0, Math.max(diacritizedSim, normalizedSim));
}

// ── RecitationSession ─────────────────────────────────────────────────────────

export class RecitationSession {
  private words: SurahWord[];
  private position: number = 0;
  private retries: Map<number, number> = new Map();
  readonly totalWords: number;

  constructor(words: SurahWord[]) {
    this.words = words;
    this.totalWords = words.length;
  }

  get currentPosition(): number {
    return this.position;
  }

  currentAyah(): number {
    if (this.position >= this.totalWords) {
      return this.words[this.totalWords - 1]?.ayah ?? 1;
    }
    return this.words[this.position]?.ayah ?? 1;
  }

  reset(): void {
    this.position = 0;
    this.retries.clear();
  }

  setPosition(idx: number): void {
    this.position = Math.max(0, Math.min(idx, this.totalWords));
  }

  getRetries(globalIndex: number): number {
    return this.retries.get(globalIndex) ?? 0;
  }

  matchTranscript(
    transcript: string,
    timings: WordTiming[] = [],
    threshold = 0.75,
    maxLookahead = 1,
  ): MatchResult {
    const emptyResult = (): MatchResult => ({
      words: [],
      wordsMatched: 0,
      newPosition: this.position,
      position: this.position,
      ayah: this.currentAyah(),
      complete: this.position >= this.totalWords,
      type: "match",
      totalWords: this.totalWords,
      transcript,
    });

    if (!transcript?.trim()) return emptyResult();

    // Split Arabic words
    const spokenWords = transcript
      .replace(/[،؟.!,?]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (spokenWords.length === 0) return emptyResult();

    // Build timing map by word order
    const timingBySpokenIdx = new Map<number, WordTiming>();
    timings.forEach((t, i) => timingBySpokenIdx.set(i, t));

    const matches: WordMatch[] = [];
    let pos = this.position;
    let wordsMatched = 0;
    let spokenIdx = 0;

    for (const spoken of spokenWords) {
      if (pos >= this.totalWords) break;

      const spokenNorm = normalizeArabic(spoken);
      if (!spokenNorm) {
        spokenIdx++;
        continue;
      }
      const spokenHasTashkeel_ = hasTashkeel(spoken);

      let bestMatch: SurahWord | null = null;
      let bestSim = 0;
      let bestOffset = 0;

      const lookahead = Math.min(maxLookahead + 1, this.totalWords - pos);
      for (let offset = 0; offset < lookahead; offset++) {
        const expected = this.words[pos + offset];
        const sim = wordSimilarity(
          spoken,
          spokenNorm,
          spokenHasTashkeel_,
          expected.text,
          expected.norm,
        );
        if (sim > bestSim) {
          bestSim = sim;
          bestMatch = expected;
          bestOffset = offset;
        }
      }

      const timing = timingBySpokenIdx.get(spokenIdx);

      if (bestMatch && bestSim >= threshold) {
        matches.push({
          globalIndex: bestMatch.globalIndex,
          expected: bestMatch.text,
          spoken,
          similarity: Math.round(bestSim * 1000) / 1000,
          matched: true,
          ayah: bestMatch.ayah,
          wordInAyah: bestMatch.wordInAyah,
          durationMs: timing?.durationMs,
        });
        wordsMatched++;

        // Mark skipped words
        for (let skip = 0; skip < bestOffset; skip++) {
          const skipped = this.words[pos + skip];
          matches.push({
            globalIndex: skipped.globalIndex,
            expected: skipped.text,
            spoken: "",
            similarity: 0,
            matched: false,
            ayah: skipped.ayah,
            wordInAyah: skipped.wordInAyah,
          });
        }

        pos = bestMatch.globalIndex + 1;
      } else {
        // Failed match
        const expected = this.words[pos];
        matches.push({
          globalIndex: expected.globalIndex,
          expected: expected.text,
          spoken,
          similarity: Math.round(bestSim * 1000) / 1000,
          matched: false,
          ayah: expected.ayah,
          wordInAyah: expected.wordInAyah,
          durationMs: timing?.durationMs,
        });
        this.retries.set(
          expected.globalIndex,
          (this.retries.get(expected.globalIndex) ?? 0) + 1,
        );
      }

      spokenIdx++;
    }

    this.position = pos;

    return {
      words: matches,
      wordsMatched,
      newPosition: pos,
      position: pos,
      ayah: this.currentAyah(),
      complete: pos >= this.totalWords,
      type: "match",
      totalWords: this.totalWords,
      transcript,
    };
  }

  /** Convert SurahWord array from quranApi QuranWord format */
  static fromQuranWords(
    quranWords: Array<{
      text: string;
      ayahNumber: number;
      globalIndex: number;
      wordIndexInAyah?: number;
    }>,
  ): SurahWord[] {
    const ayahWordCounts = new Map<number, number>();
    return quranWords.map((w) => {
      const cnt = ayahWordCounts.get(w.ayahNumber) ?? 0;
      ayahWordCounts.set(w.ayahNumber, cnt + 1);
      return {
        text: w.text,
        norm: normalizeArabic(w.text),
        ayah: w.ayahNumber,
        wordInAyah: w.wordIndexInAyah ?? cnt,
        globalIndex: w.globalIndex,
      };
    });
  }
}
