/**
 * useTajweedAnalysis.ts
 *
 * Calls POST /analyze-tajweed after recitation completes.
 * Returns per-word tajweed verdicts (correct / violation + rule details).
 * ADDITIVE to existing useAzureSpeech — doesn't change transcription flow.
 *
 * Phase 3: Backend returns text-based rule identification (all confirmations).
 * Phase 5 (future): Backend will use audio for duration-based Ghunna/Madd verification.
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
  expected_duration?: number;
  actual_duration?: number;
  timestamp?: number;
  details: string;
}
export interface WordTimingInput {
  word_index: number;
  duration_ms: number;
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
  word_index: number;
  rules: TajweedViolation[];
  has_violation: boolean;
  worst_rule?: string;
}

interface UseTajweedAnalysisReturn {
  isAnalyzing: boolean;
  lastResult: TajweedResult | null;
  wordStatuses: Map<number, WordTajweedStatus>;
  error: string | null;
  analyzeAyah: (
    audioChunks: ArrayBuffer[],
    ayahWords: string[],
    wordTimings?: WordTimingInput[],
  ) => Promise<TajweedResult | null>;
  addAudioChunk: (chunk: ArrayBuffer) => void;
  getBufferedAudio: () => ArrayBuffer[];
  clearBuffer: () => void;
  overallScore: number | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

// Fixed: use VITE_BACKEND_URL to match .env (was VITE_API_URL)
const API_BASE = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export function useTajweedAnalysis(): UseTajweedAnalysisReturn {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastResult, setLastResult] = useState<TajweedResult | null>(null);
  const [wordStatuses, setWordStatuses] = useState<
    Map<number, WordTajweedStatus>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const audioBufferRef = useRef<ArrayBuffer[]>([]);

  const addAudioChunk = useCallback((chunk: ArrayBuffer) => {
    audioBufferRef.current.push(chunk);
  }, []);

  const getBufferedAudio = useCallback(
    (): ArrayBuffer[] => [...audioBufferRef.current],
    [],
  );

  const clearBuffer = useCallback(() => {
    audioBufferRef.current = [];
  }, []);

  const analyzeAyah = useCallback(
    async (
      audioChunks: ArrayBuffer[],
      ayahWords: string[],
      wordTimings: WordTimingInput[] = [],
    ): Promise<TajweedResult | null> => {
      if (audioChunks.length === 0 || ayahWords.length === 0) return null;

      setIsAnalyzing(true);
      setError(null);

      try {
        // Merge chunks
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

        if (!resp.ok)
          throw new Error(`Tajweed analysis failed: ${resp.status}`);

        const result: TajweedResult = await resp.json();
        setLastResult(result);
        setOverallScore(result.score);

        // Build per-word status map
        const statuses = new Map<number, WordTajweedStatus>();
        for (const v of result.violations) {
          const ex = statuses.get(v.word_index) || {
            word_index: v.word_index,
            rules: [],
            has_violation: false,
          };
          ex.rules.push(v);
          ex.has_violation = true;
          ex.worst_rule = v.rule;
          statuses.set(v.word_index, ex);
        }
        for (const c of result.confirmations) {
          const ex = statuses.get(c.word_index) || {
            word_index: c.word_index,
            rules: [],
            has_violation: false,
          };
          ex.rules.push(c);
          statuses.set(c.word_index, ex);
        }
        setWordStatuses(statuses);
        return result;
      } catch (err: any) {
        setError(err.message || "Tajweed analysis failed");
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [],
  );

  return {
    isAnalyzing,
    lastResult,
    wordStatuses,
    error,
    analyzeAyah,
    addAudioChunk,
    getBufferedAudio,
    clearBuffer,
    overallScore,
  };
}
