/**
 * useAzureSpeech.ts — Phase 2
 *
 * Streams raw PCM16 mic audio to the FastConformer CTC backend via WebSocket.
 * Sends a JSON config frame first (with auth token + surah number).
 *
 * Phase 2 changes:
 *   - Sends "surah" in config handshake for server-side QuranDB matching
 *   - Handles "match" message type (server-side word matching results)
 *   - Still handles legacy "final" for backward compatibility
 *   - Sends "reset" and "setPosition" control messages
 *
 * REQUIRES: Backend running at VITE_WS_URL (server_nemo.py with QuranDB)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { unlockAudio } from "@/lib/audioPlayer";
import { supabase } from "@/integrations/supabase/client";

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;

// ── AudioWorklet (PCM Float32→Int16 conversion) ───────────────────────────────
const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MicPermission =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "error";

export interface PhoneticScore {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronunciationScore: number;
}

export interface WordResult {
  word: string;
  confidence: number;
  accuracyScore?: number;
  errorType?: string;
}

export interface ServerWordMatch {
  index: number; // global word index in surah
  expected: string; // diacritized expected word
  spoken: string; // what RNNT heard
  similarity: number; // 0.0 - 1.0
  matched: boolean; // true if similarity >= threshold
  ayah: number; // ayah number
  wordInAyah: number; // word index within ayah
  retries: number; // server-side retry count
  /** Phase 4: Word-level timing from RNNT hypothesis (optional) */
  startMs?: number; // ms from start of audio chunk
  endMs?: number;
  durationMs?: number; // endMs - startMs
}

/** Phase 2: Server-side match result message */
export interface MatchResult {
  type: "match";
  words: ServerWordMatch[];
  position: number; // new global word position
  ayah: number; // current ayah
  wordsMatched: number; // how many words matched this chunk
  totalWords: number; // total words in surah
  complete: boolean; // true if surah complete
  transcript: string; // raw CTC transcript for display
}

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  words?: WordResult[];
  phonetic?: PhoneticScore;
  /** Phase 2: server-side match results (when backend has QuranDB) */
  match?: MatchResult;
}

interface StartOptions {
  refText?: string;
  /** Phase 2: surah number for server-side matching */
  surah?: number;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
}

interface UseAzureSpeechReturn {
  isListening: boolean;
  isConnected: boolean;
  error: string | null;
  start: (
    onResult: (r: TranscriptionResult) => void,
    opts?: StartOptions,
  ) => void;
  stop: () => void;
  updateRefText: (text: string, surah?: number) => void;
  /** Phase 2: reset server-side position tracking */
  resetPosition: () => void;
  /** Phase 2: jump to a specific word position */
  setPosition: (position: number) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAzureSpeech(): UseAzureSpeechReturn {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletBlobRef = useRef<string | null>(null);
  const onResultRef = useRef<((r: TranscriptionResult) => void) | null>(null);
  const onAudioChunkRef = useRef<((chunk: ArrayBuffer) => void) | null>(null);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;

    onAudioChunkRef.current = null;

    setIsListening(false);
    setIsConnected(false);
  }, []);

  useEffect(
    () => () => {
      cleanup();
    },
    [cleanup],
  );

  // ── Update ref text mid-session (Phase 2: also sends surah) ──────────────

  const updateRefText = useCallback((text: string, surah?: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "updateRefText",
          refText: text,
          ...(surah != null && { surah }),
        }),
      );
    }
  }, []);

  // ── Phase 2: Reset server-side position ──────────────────────────────────

  const resetPosition = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reset" }));
    }
  }, []);

  // ── Phase 2: Set server-side position ────────────────────────────────────

  const setPosition = useCallback((position: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "setPosition", position }));
    }
  }, []);

  // ── WebSocket streaming path ──────────────────────────────────────────────

  const startStreaming = useCallback(
    async (
      onResult: (r: TranscriptionResult) => void,
      opts: StartOptions = {},
    ) => {
      setError(null);
      onResultRef.current = onResult;
      onAudioChunkRef.current = opts.onAudioChunk ?? null;
      unlockAudio();

      if (!WS_URL) {
        setError("Backend not configured. Set VITE_WS_URL in your .env file.");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setError("Authentication required. Please sign in first.");
        return;
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onerror = () => {
        setError(
          "Cannot connect to backend. Is it running? Check VITE_WS_URL.",
        );
        cleanup();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "ready") {
            setIsConnected(true);
            return;
          }
          if (msg.type === "error") {
            if (msg.code === "AUTH_REQUIRED") {
              setError("Authentication failed. Please sign in again.");
              cleanup();
              return;
            }
            if (msg.code === "RATE_LIMITED") {
              setError("Too many requests. Please slow down.");
              return;
            }
            setError(msg.message);
            return;
          }

          // ── Phase 2: Handle server-side match results ─────────────────
          if (msg.type === "match") {
            onResultRef.current?.({
              text: msg.transcript ?? "",
              isFinal: true,
              match: msg as MatchResult,
            });
            return;
          }

          // Legacy: handle "final" / "interim" (fallback when no surah detected)
          if (msg.type === "interim" || msg.type === "final") {
            onResultRef.current?.({
              text: msg.text ?? "",
              isFinal: msg.type === "final",
              words: msg.words,
              phonetic: msg.phonetic,
            });
          }
        } catch {
          // Non-JSON — ignore
        }
      };

      ws.onclose = (e) => {
        setIsConnected(false);
        if (e.code === 4003) {
          setError("Authentication required. Please sign in.");
        } else if (e.code === 4001) {
          setError("Connection timeout. Please try again.");
        }
      };

      // Wait for connection (5s timeout)
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error("WebSocket timeout")), 5000);
        ws.addEventListener(
          "open",
          () => {
            clearTimeout(t);
            res();
          },
          { once: true },
        );
        ws.addEventListener(
          "error",
          () => {
            clearTimeout(t);
            rej(new Error("WS error"));
          },
          { once: true },
        );
      });

      // ① Send config handshake with auth token + surah number (Phase 2)
      ws.send(
        JSON.stringify({
          type: "config",
          locale: "ar-SA",
          refText: opts.refText ?? null,
          surah: opts.surah ?? null,
          token: token,
        }),
      );

      // ② Open microphone at 16 kHz mono
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : "UnknownError";
        const message = err instanceof Error ? err.message : "Unknown microphone error";
        if (name === "NotAllowedError") {
          setError(
            "Microphone permission denied. Please allow microphone access in your browser settings.",
          );
        } else if (name === "NotFoundError") {
          setError(
            "No microphone found. Please connect a microphone and try again.",
          );
        } else {
          setError(`Microphone error: ${message}`);
        }
        cleanup();
        return;
      }
      streamRef.current = stream;

      // ③ AudioWorklet → raw PCM16 → WebSocket + tajweed buffer
      if (!workletBlobRef.current) {
        const blob = new Blob([WORKLET_CODE], {
          type: "application/javascript",
        });
        workletBlobRef.current = URL.createObjectURL(blob);
      }

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      await audioCtx.audioWorklet.addModule(workletBlobRef.current);

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
      workletRef.current = worklet;

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
        onAudioChunkRef.current?.(e.data);
      };

      source.connect(worklet);
      setIsListening(true);
      console.log(
        "[useAzureSpeech] Connected to FastConformer backend (Phase 2)",
      );
    },
    [cleanup],
  );

  // ── Public API ──────────────────────────────────────────────────────────

  const start = useCallback(
    (onResult: (r: TranscriptionResult) => void, opts: StartOptions = {}) => {
      startStreaming(onResult, opts).catch((err) => {
        console.error("[useAzureSpeech] Connection error:", err);
        setError(
          "Failed to connect to backend. Make sure server_nemo.py is running.",
        );
      });
    },
    [startStreaming],
  );

  const stop = useCallback(() => {
    cleanup();
    console.log("[useAzureSpeech] Stopped");
  }, [cleanup]);

  return {
    isListening,
    isConnected,
    error,
    start,
    stop,
    updateRefText,
    resetPosition,
    setPosition,
  };
}
