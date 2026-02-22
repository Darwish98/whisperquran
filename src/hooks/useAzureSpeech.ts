/**
 * useAzureSpeech.ts
 *
 * Streams raw PCM audio from the browser mic to your Azure backend via WebSocket.
 * Falls back to browser Web Speech API if VITE_WS_URL is not set.
 *
 * Usage in Index.tsx:
 *   const { isListening, isConnected, start, stop, mode } = useAzureSpeech();
 *   start((text) => handleTranscription(text));
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;

// AudioWorklet processor code — converts Float32 mic input → Int16 PCM chunks
// Injected as a Blob URL so no separate .js file is needed
const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || ch.length === 0) return true;
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

export type SpeechMode = 'azure' | 'browser';

interface UseAzureSpeechReturn {
  isListening: boolean;
  isConnected: boolean;
  start: (onResult: (text: string) => void) => void;
  stop: () => void;
  mode: SpeechMode;
  error: string | null;
}

export function useAzureSpeech(): UseAzureSpeechReturn {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const onResultRef = useRef<((text: string) => void) | null>(null);

  // Browser fallback refs
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);

  const mode: SpeechMode = WS_URL ? 'azure' : 'browser';

  const cleanup = useCallback(() => {
    // Azure path
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    // Browser path
    shouldRestartRef.current = false;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;

    setIsListening(false);
    setIsConnected(false);
  }, []);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  // ── Azure streaming path ──────────────────────────────────────────────────

  const startAzure = useCallback(async (onResult: (text: string) => void) => {
    setError(null);
    onResultRef.current = onResult;

    const ws = new WebSocket(WS_URL!);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onerror = () => {
      setError('Cannot connect to Azure backend. Is it running? Check VITE_WS_URL.');
      cleanup();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'error') { setError(msg.message); return; }
        if (msg.text && onResultRef.current) {
          onResultRef.current(msg.text);
        }
      } catch {
        if (event.data && onResultRef.current) onResultRef.current(event.data as string);
      }
    };

    ws.onclose = () => { setIsConnected(false); };

    // Wait for connection (5s timeout)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connection timed out')), 5000);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('WebSocket error')); }, { once: true });
    });

    setIsConnected(true);

    // Open microphone at 16kHz mono
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    // Create worklet blob URL once
    if (!workletUrlRef.current) {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      workletUrlRef.current = URL.createObjectURL(blob);
    }

    await audioCtx.audioWorklet.addModule(workletUrlRef.current);
    const source = audioCtx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
    workletNodeRef.current = workletNode;

    // Send PCM chunks to backend
    workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    source.connect(workletNode);
    // Don't connect to destination — no echo
    setIsListening(true);
  }, [cleanup]);

  // ── Browser Web Speech API fallback ──────────────────────────────────────

  const startBrowser = useCallback((onResult: (text: string) => void) => {
    setError(null);
    onResultRef.current = onResult;
    shouldRestartRef.current = true;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported. Use Chrome or Edge, or set VITE_WS_URL.');
      return;
    }

    const createRec = () => {
      const rec = new SpeechRecognition();
      rec.lang = 'ar-SA';
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 5;

      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            for (let j = 0; j < result.length; j++) {
              const t = result[j].transcript?.trim();
              if (t && onResultRef.current) onResultRef.current(t);
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
        if (shouldRestartRef.current) setTimeout(() => { try { rec.start(); } catch {} }, 100);
        else { setIsListening(false); setIsConnected(false); }
      };

      return rec;
    };

    const rec = createRec();
    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
      setIsConnected(true);
    } catch {
      setError('Failed to start speech recognition.');
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────────

  const start = useCallback((onResult: (text: string) => void) => {
    if (mode === 'azure') {
      startAzure(onResult).catch(err => {
        console.warn('Azure failed, falling back to browser:', err);
        setError(null);
        startBrowser(onResult);
      });
    } else {
      startBrowser(onResult);
    }
  }, [mode, startAzure, startBrowser]);

  const stop = useCallback(() => { cleanup(); }, [cleanup]);

  return { isListening, isConnected, start, stop, mode, error };
}
