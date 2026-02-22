/**
 * useAzureSpeech.ts
 *
 * Streams raw PCM16 mic audio to the backend WebSocket.
 * Sends a JSON config frame first, then binary audio chunks.
 * Returns TranscriptionResult objects that include phonetic accuracy scores
 * from Azure Pronunciation Assessment.
 *
 * Falls back to browser Web Speech API automatically if VITE_WS_URL is not set.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { unlockAudio } from '@/lib/audioPlayer';

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;

// ── AudioWorklet (PCM Float32→Int16 conversion) ───────────────────────────────
// Inlined as a Blob URL so no extra build artefact is needed.
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

export type SpeechMode = 'azure' | 'browser';

export interface PhoneticScore {
  accuracyScore:      number;  // 0–100
  fluencyScore:       number;
  completenessScore:  number;
  pronunciationScore: number;
}

export interface WordResult {
  word:          string;
  confidence:    number;
  accuracyScore?: number;
  errorType?:    string; // 'None' | 'Omission' | 'Insertion' | 'Mispronunciation'
}

export interface TranscriptionResult {
  text:      string;
  isFinal:   boolean;
  words?:    WordResult[];
  phonetic?: PhoneticScore;
}

interface StartOptions {
  refText?: string;  // current expected word — sent to backend for Pronunciation Assessment
}

interface UseAzureSpeechReturn {
  isListening:  boolean;
  isConnected:  boolean;
  mode:         SpeechMode;
  error:        string | null;
  start: (onResult: (r: TranscriptionResult) => void, opts?: StartOptions) => void;
  stop:  () => void;
  /** Update the pronunciation-assessment reference text mid-session */
  updateRefText: (text: string) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAzureSpeech(): UseAzureSpeechReturn {
  const [isListening,  setIsListening]  = useState(false);
  const [isConnected,  setIsConnected]  = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const wsRef          = useRef<WebSocket | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const workletRef     = useRef<AudioWorkletNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const workletBlobRef = useRef<string | null>(null);
  const onResultRef    = useRef<((r: TranscriptionResult) => void) | null>(null);

  // Browser fallback refs
  const recogRef         = useRef<any>(null);
  const shouldRestartRef = useRef(false);

  const mode: SpeechMode = WS_URL ? 'azure' : 'browser';

  // ── Cleanup ──────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;

    shouldRestartRef.current = false;
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null;

    setIsListening(false);
    setIsConnected(false);
  }, []);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  // ── Azure path ────────────────────────────────────────────────────────────

  const startAzure = useCallback(async (
    onResult: (r: TranscriptionResult) => void,
    opts: StartOptions = {},
  ) => {
    setError(null);
    onResultRef.current = onResult;
    unlockAudio();

    // Open WebSocket
    const ws = new WebSocket(WS_URL!);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onerror = () => {
      setError('Cannot connect to backend. Is it running? Check VITE_WS_URL.');
      cleanup();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'ready') { setIsConnected(true); return; }
        if (msg.type === 'error') { setError(msg.message); return; }
        if (msg.type === 'interim' || msg.type === 'final') {
          onResultRef.current?.({
            text:     msg.text ?? '',
            isFinal:  msg.type === 'final',
            words:    msg.words,
            phonetic: msg.phonetic,
          });
        }
      } catch {
        // Non-JSON — ignore
      }
    };

    ws.onclose = () => setIsConnected(false);

    // Wait for connection (5 s timeout)
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('WebSocket timeout')), 5000);
      ws.addEventListener('open',  () => { clearTimeout(t); res(); },  { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('WS error')); }, { once: true });
    });

    // ① Send config handshake (MUST arrive before audio)
    ws.send(JSON.stringify({
      type:    'config',
      locale:  'ar-SA',
      refText: opts.refText ?? null,
    }));

    // ② Open microphone at 16 kHz mono
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount:    1,
        sampleRate:      16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    // ③ AudioWorklet → raw PCM16 → WebSocket
    if (!workletBlobRef.current) {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      workletBlobRef.current = URL.createObjectURL(blob);
    }

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;
    await audioCtx.audioWorklet.addModule(workletBlobRef.current);

    const source  = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor');
    workletRef.current = worklet;

    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    source.connect(worklet);
    // Do NOT connect worklet → destination (avoids echo)
    setIsListening(true);
  }, [cleanup]);

  // ── Browser Web Speech API fallback ──────────────────────────────────────

  const startBrowser = useCallback((
    onResult: (r: TranscriptionResult) => void,
    _opts: StartOptions = {},
  ) => {
    setError(null);
    onResultRef.current = onResult;
    shouldRestartRef.current = true;
    unlockAudio();

    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SR) {
      setError('Speech recognition not supported. Use Chrome or Edge, or set VITE_WS_URL for Azure.');
      return;
    }

    const rec = new SR();
    rec.lang = 'ar-SA';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;

    rec.onresult = (ev: any) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r   = ev.results[i];
        const txt = r[0]?.transcript?.trim();
        if (!txt) continue;
        onResultRef.current?.({
          text:    txt,
          isFinal: r.isFinal,
          words:   Array.from({ length: r.length }, (_: unknown, j: number) => ({
            word:       r[j]?.transcript?.trim() ?? '',
            confidence: r[j]?.confidence        ?? 1,
          })),
        });
      }
    };

    rec.onerror = (e: any) => {
      if (['no-speech', 'audio-capture', 'network'].includes(e.error) && shouldRestartRef.current) {
        setTimeout(() => { try { rec.start(); } catch {} }, 300);
      }
    };

    rec.onend = () => {
      if (shouldRestartRef.current) {
        setTimeout(() => { try { rec.start(); } catch {} }, 100);
      } else {
        setIsListening(false);
        setIsConnected(false);
      }
    };

    recogRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
      setIsConnected(true);
    } catch {
      setError('Failed to start speech recognition.');
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────────

  const start = useCallback((
    onResult: (r: TranscriptionResult) => void,
    opts: StartOptions = {},
  ) => {
    if (mode === 'azure') {
      startAzure(onResult, opts).catch(err => {
        console.warn('Azure failed, falling back to browser:', err);
        setError(null);
        startBrowser(onResult, opts);
      });
    } else {
      startBrowser(onResult, opts);
    }
  }, [mode, startAzure, startBrowser]);

  const stop = useCallback(() => cleanup(), [cleanup]);

  /** Send updated reference text to backend for next Pronunciation Assessment utterance */
  const updateRefText = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'refText', text }));
    }
  }, []);

  return { isListening, isConnected, mode, error, start, stop, updateRefText };
}
