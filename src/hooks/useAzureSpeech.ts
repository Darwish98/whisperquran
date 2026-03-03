/**
 * useAzureSpeech.ts
 *
 * Streams raw PCM16 mic audio to the FastConformer CTC backend via WebSocket.
 * Sends a JSON config frame first (with auth token), then binary audio chunks.
 * Returns TranscriptionResult objects.
 *
 * REQUIRES: Backend running at VITE_WS_URL (server_nemo.py)
 * No browser fallback — if backend is down, shows error.
 *
 * SECURITY: Sends Supabase JWT token in the config handshake.
 * Backend validates token before allowing audio processing.
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

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  words?: WordResult[];
  phonetic?: PhoneticScore;
}

interface StartOptions {
  refText?: string;
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
  updateRefText: (text: string) => void;
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

  // ── Update ref text mid-session ──────────────────────────────────────────

  const updateRefText = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "updateRefText", refText: text }),
      );
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

      // Check backend URL is configured
      if (!WS_URL) {
        setError(
          "Backend not configured. Set VITE_WS_URL in your .env file.",
        );
        return;
      }

      // Get current auth token
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setError("Authentication required. Please sign in first.");
        return;
      }

      // Open WebSocket
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

      // ① Send config handshake with auth token (MUST arrive before audio)
      ws.send(
        JSON.stringify({
          type: "config",
          locale: "ar-SA",
          refText: opts.refText ?? null,
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
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          setError(
            "Microphone permission denied. Please allow microphone access in your browser settings.",
          );
        } else if (err.name === "NotFoundError") {
          setError(
            "No microphone found. Please connect a microphone and try again.",
          );
        } else {
          setError(`Microphone error: ${err.message}`);
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
      console.log("[useAzureSpeech] Connected to FastConformer backend");
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

  return { isListening, isConnected, error, start, stop, updateRefText };
}
