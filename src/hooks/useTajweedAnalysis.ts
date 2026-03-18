/**
 * useTajweedAnalysis.ts
 *
 * Key fix in this version:
 *   - analyzeAyah now accepts globalIndexOffset so the returned wordStatuses
 *     map is keyed by GLOBAL word index, not per-ayah word_index.
 *   - QuranDisplay looks up by globalIndex — this makes them match.
 */

import { useState, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TajweedViolation {
  rule: string;
  sub_type: string;
  word: string;
  word_index: number;
  correct: boolean;
  confidence: number;
  verifiable: boolean;        // true = timing data present and verdict is real
  expected_duration?: number;
  actual_duration?: number;
  timestamp?: number;
  details: string;
}

export interface WordTimingInput {
  word_index: number;
  duration_ms: number;
  nemo_duration_ms?: number;  // raw NeMo duration for VAD calibration
}

export interface TajweedResult {
  rules_found: number;
  rules_checked: number;
  violations: TajweedViolation[];
  confirmations: TajweedViolation[];
  score: number;
  processing_time_ms: number;
  alignment_method: string;
}

export interface WordTajweedStatus {
  word_index: number;       // per-ayah index (from server)
  global_index: number;     // global surah index (for QuranDisplay lookup)
  rules: TajweedViolation[];
  has_violation: boolean;
  worst_rule?: string;
}

interface UseTajweedAnalysisReturn {
  isAnalyzing: boolean;
  lastResult: TajweedResult | null;
  /** Keyed by GLOBAL word index — matches word.globalIndex in QuranDisplay */
  wordStatuses: Map<number, WordTajweedStatus>;
  error: string | null;
  analyzeAyah: (
    audioChunks: ArrayBuffer[],
    ayahWords: string[],
    wordTimings?: WordTimingInput[],
    globalIndexOffset?: number,
  ) => Promise<TajweedResult | null>;
  addAudioChunk: (chunk: ArrayBuffer) => void;
  getBufferedAudio: () => ArrayBuffer[];
  clearBuffer: () => void;
  /** Call when loading a new surah to wipe all previous tajweed results */
  resetTajweedStatuses: () => void;
  overallScore: number | null;
}

const API_BASE = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export function useTajweedAnalysis(): UseTajweedAnalysisReturn {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastResult, setLastResult] = useState<TajweedResult | null>(null);
  const [wordStatuses, setWordStatuses] = useState<Map<number, WordTajweedStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const audioBufferRef = useRef<ArrayBuffer[]>([]);

  const addAudioChunk = useCallback((chunk: ArrayBuffer) => {
    audioBufferRef.current.push(chunk);
  }, []);

  const getBufferedAudio = useCallback((): ArrayBuffer[] => [...audioBufferRef.current], []);

  const clearBuffer = useCallback(() => { audioBufferRef.current = []; }, []);

  const analyzeAyah = useCallback(
    async (
      audioChunks: ArrayBuffer[],
      ayahWords: string[],
      wordTimings: WordTimingInput[] = [],
      globalIndexOffset: number = 0,
    ): Promise<TajweedResult | null> => {
      if (ayahWords.length === 0) return null;

      setIsAnalyzing(true);
      setError(null);

      try {
        // Merge audio chunks
        const totalLen = audioChunks.reduce((s, c) => s + c.byteLength, 0);
        const merged = new Uint8Array(totalLen);
        let off = 0;
        for (const chunk of audioChunks) {
          merged.set(new Uint8Array(chunk), off);
          off += chunk.byteLength;
        }

        // Base64 encode
        let binary = "";
        for (let i = 0; i < merged.byteLength; i++)
          binary += String.fromCharCode(merged[i]);
        const b64 = btoa(binary);

        const resp = await fetch(`${API_BASE}/analyze-tajweed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio_base64: b64,
            ayah_words: ayahWords,
            word_timings: wordTimings,
          }),
        });

        if (!resp.ok) throw new Error(`Tajweed analysis failed: ${resp.status}`);

        const result: TajweedResult = await resp.json();
        setLastResult(result);
        setOverallScore(result.score);

        // Build per-word status map keyed by GLOBAL index
        // word_index from server is per-ayah (0, 1, 2...) → add offset
        setWordStatuses((prev) => {
          const next = new Map(prev);

          for (const entry of [...result.violations, ...result.confirmations]) {
            const globalIdx = entry.word_index + globalIndexOffset;
            const ex = next.get(globalIdx) ?? {
              word_index: entry.word_index,
              global_index: globalIdx,
              rules: [],
              has_violation: false,
            };
            // Avoid duplicates
            if (!ex.rules.find(r => r.sub_type === entry.sub_type)) {
              ex.rules.push(entry);
            }
            if (!entry.correct) {
              ex.has_violation = true;
              ex.worst_rule = entry.rule;
            }
            next.set(globalIdx, { ...ex });
          }

          return next;
        });

        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Tajweed analysis failed";
        setError(msg);
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [],
  );

  const resetTajweedStatuses = useCallback(() => {
    setWordStatuses(new Map());
    setLastResult(null);
    setOverallScore(null);
    setError(null);
  }, []);

  return {
    isAnalyzing,
    lastResult,
    wordStatuses,
    error,
    analyzeAyah,
    addAudioChunk,
    getBufferedAudio,
    clearBuffer,
    resetTajweedStatuses,
    overallScore,
  };
}
