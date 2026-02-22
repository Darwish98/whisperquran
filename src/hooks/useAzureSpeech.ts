/**
 * useAzureSpeech – Real-time Arabic speech recognition via Azure backend
 *
 * Architecture:
 *  Browser mic → AudioWorklet (raw PCM16 @ 16kHz) → WebSocket → Azure Speech SDK → transcript
 *
 * ENV: set VITE_WS_URL in your Lovable project env vars
 *   e.g.  VITE_WS_URL=wss://your-app.azurewebsites.net/ws/transcribe
 *
 * Falls back to Web Speech API automatically if WS_URL is not configured.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  words?: Array<{ word: string; confidence: number }>;
}

interface UseAzureSpeechReturn {
  isListening: boolean;
  isConnected: boolean;
  start: (onResult: (result: TranscriptionResult) => void) => void;
  stop: () => void;
  mode: 'azure' | 'browser';
  error: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;
const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096; // samples per worklet chunk

// ── AudioWorklet inline processor (injected as Blob URL) ────────────────────
// Converts Float32 mic input → Int16 PCM for Azure
const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;
    // Convert Float32 → Int16
    const pcm = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

// ── Main hook ────────────────────────────────────────────────────────────────

export function useAzureSpeech(): UseAzureSpeechReturn {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onResultRef = useRef<((r: TranscriptionResult) => void) | null>(null);
  const workletUrlRef = useRef<string | null>(null);

  // Fallback: Web Speech API refs
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);

  const mode: 'azure' | 'browser' = WS_URL ? 'azure' : 'browser';

  // ── Cleanup helper ──────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    // Azure path
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Browser path
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    setIsListening(false);
    setIsConnected(false);
  }, []);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  // ── Azure path ──────────────────────────────────────────────────────────

  const startAzure = useCallback(async (onResult: (r: TranscriptionResult) => void) => {
    setError(null);
    onResultRef.current = onResult;

    // 1. Connect WebSocket
    const ws = new WebSocket(WS_URL!);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setIsConnected(true);
      console.log('🔌 WS connected to Azure backend');
    };

    ws.onerror = () => {
      setError('WebSocket connection failed. Check VITE_WS_URL.');
      cleanup();
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'error') {
          setError(msg.message);
          return;
        }
        if (msg.text && onResultRef.current) {
          onResultRef.current({
            text: msg.text,
            isFinal: msg.type === 'final',
            words: msg.words,
          });
        }
      } catch {
        // plain text fallback
        if (event.data && onResultRef.current) {
          onResultRef.current({ text: event.data as string, isFinal: true });
        }
      }
    };

    // 2. Wait for WS open (max 5s)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS timeout')), 5000);
      ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WS error')); }, { once: true });
    }).catch(err => { setError(String(err)); throw err; });

    // 3. Open microphone (16kHz mono)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    // 4. AudioContext + AudioWorklet for low-latency PCM capture
    const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioCtxRef.current = audioCtx;

    if (!workletUrlRef.current) {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      workletUrlRef.current = URL.createObjectURL(blob);
    }

    await audioCtx.audioWorklet.addModule(workletUrlRef.current);

    const source = audioCtx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
      processorOptions: { bufferSize: BUFFER_SIZE },
    });
    workletNodeRef.current = workletNode;

    workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(e.data);
      }
    };

    source.connect(workletNode);
    workletNode.connect(audioCtx.destination);

    setIsListening(true);
  }, [cleanup]);

  // ── Browser Web Speech API fallback ────────────────────────────────────

  const startBrowser = useCallback((onResult: (r: TranscriptionResult) => void) => {
    setError(null);
    onResultRef.current = onResult;
    shouldRestartRef.current = true;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported. Use Chrome/Edge.');
      return;
    }

    const createRec = () => {
      const rec = new SpeechRecognition();
      rec.lang = 'ar-SA';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 5;

      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          // Send all alternatives
          for (let j = 0; j < result.length; j++) {
            const transcript = result[j].transcript?.trim();
            if (transcript && onResultRef.current) {
              onResultRef.current({ text: transcript, isFinal: result.isFinal });
            }
          }
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

      return rec;
    };

    const rec = createRec();
    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
      setIsConnected(true);
    } catch (err) {
      setError('Failed to start speech recognition.');
    }
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────

  const start = useCallback((onResult: (r: TranscriptionResult) => void) => {
    if (mode === 'azure') {
      startAzure(onResult).catch(err => {
        console.warn('Azure failed, falling back to browser:', err);
        startBrowser(onResult);
      });
    } else {
      startBrowser(onResult);
    }
  }, [mode, startAzure, startBrowser]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return { isListening, isConnected, start, stop, mode, error };
}
