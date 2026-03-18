/**
 * useLocalASR.ts — Client-side FastConformer RNNT inference
 * ==========================================================
 *
 * Verified tensor names from ONNX inspection:
 *
 * encoder.onnx:
 *   IN:  audio_signal [batch, 80, time_frames] float32
 *        length       [batch]                  int64
 *   OUT: outputs          [batch, 512, time_enc] float32
 *        encoded_lengths  [batch]                int64
 *
 * decoder_joint.onnx:
 *   IN:  encoder_outputs  [batch, 512, time_enc]  float32
 *        targets          [batch, 1]              int32   ← previous token
 *        target_length    [batch]                 int32
 *        input_states_1   [1, batch, 640]         float32 ← LSTM hidden
 *        input_states_2   [1, batch, 640]         float32 ← LSTM cell
 *   OUT: outputs          [batch, 1, 1, 1025]     float32 ← joint logits
 *        prednet_lengths  [batch]                 int32
 *        output_states_1  [1, batch, 640]         float32
 *        output_states_2  [1, batch, 640]         float32
 *
 * Vocab: 1024 SentencePiece tokens + blank_id at index 1024
 *
 * Install: npm install onnxruntime-web
 */

import { useState, useRef, useCallback, useEffect } from "react";
import * as ort from "onnxruntime-web";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  encoderFrame: number;
}

export interface LocalASRResult {
  text: string;
  isFinal: boolean;
  timings: WordTiming[];
}

export interface StartOptions {
  surah?: number;
  refText?: string;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16000;
const N_MELS = 80;
const CHUNK_MS = 2000;
const CHUNK_SAMPLES = (CHUNK_MS / 1000) * SAMPLE_RATE; // 32000
const HOP_LENGTH = 160; // 10ms at 16kHz
const WIN_LENGTH = 400; // 25ms at 16kHz
const N_FFT = 512;
const MS_PER_STEP = 80.0; // FastConformer PCD: 8x subsampling × 10ms

// Blank token is the last vocab entry (vocab_size = 1024, blank = 1024)
let BLANK_ID = 1024;

// ── Mel spectrogram ───────────────────────────────────────────────────────────

function hanningWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

const _hann = hanningWindow(WIN_LENGTH);

/** Minimal power-of-2 FFT for real input. Returns [real, imag] of length n. */
function rfft(x: Float32Array): { re: Float32Array; im: Float32Array } {
  const n = x.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(x);

  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang),
      wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1,
        cIm = 0;
      for (let k = 0; k < len >> 1; k++) {
        const uR = re[i + k],
          uI = im[i + k];
        const vR = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm;
        const vI = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe;
        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[i + k + len / 2] = uR - vR;
        im[i + k + len / 2] = uI - vI;
        [cRe, cIm] = [cRe * wRe - cIm * wIm, cRe * wIm + cIm * wRe];
      }
    }
  }
  return { re, im };
}

/** Build HTK mel filterbank: [n_mels, n_fft/2+1] flattened row-major. */
function buildMelFilters(
  nMels: number,
  nFft: number,
  sr: number,
): Float32Array {
  const hzMel = (h: number) => 2595 * Math.log10(1 + h / 700);
  const melHz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const nFreqs = nFft / 2 + 1;
  const melMin = hzMel(0),
    melMax = hzMel(sr / 2);
  const step = (melMax - melMin) / (nMels + 1);
  const pts = Float32Array.from({ length: nMels + 2 }, (_, i) =>
    melHz(melMin + i * step),
  );
  const bins = Float32Array.from({ length: nFreqs }, (_, k) => (k * sr) / nFft);
  const F = new Float32Array(nMels * nFreqs);
  for (let m = 0; m < nMels; m++) {
    for (let k = 0; k < nFreqs; k++) {
      const f = bins[k];
      if (f >= pts[m] && f <= pts[m + 1])
        F[m * nFreqs + k] = (f - pts[m]) / (pts[m + 1] - pts[m]);
      else if (f > pts[m + 1] && f <= pts[m + 2])
        F[m * nFreqs + k] = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
    }
  }
  return F;
}

let _melFilters: Float32Array | null = null;
function getMelFilters(): Float32Array {
  if (!_melFilters) _melFilters = buildMelFilters(N_MELS, N_FFT, SAMPLE_RATE);
  return _melFilters;
}

/**
 * Compute log-mel spectrogram matching NeMo's AudioToMelSpectrogramPreprocessor.
 * Returns Float32Array of shape [N_MELS, nFrames] (row-major).
 */
function computeLogMel(samples: Float32Array): {
  mel: Float32Array;
  nFrames: number;
} {
  const padded = new Float32Array(samples.length + N_FFT);
  padded.set(samples, N_FFT >> 1);

  const nFrames = Math.floor((padded.length - N_FFT) / HOP_LENGTH) + 1;
  const nFreqs = N_FFT / 2 + 1;
  const mel = new Float32Array(N_MELS * nFrames);
  const filters = getMelFilters();
  const frame = new Float32Array(N_FFT);

  for (let t = 0; t < nFrames; t++) {
    const start = t * HOP_LENGTH;
    frame.fill(0);
    for (let i = 0; i < WIN_LENGTH && start + i < padded.length; i++) {
      frame[i] = padded[start + i] * _hann[i];
    }
    const { re, im } = rfft(frame);
    // Power spectrum
    for (let m = 0; m < N_MELS; m++) {
      let v = 0;
      for (let k = 0; k < nFreqs; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        v += filters[m * nFreqs + k] * p;
      }
      mel[m * nFrames + t] = Math.log(Math.max(v, 1e-10));
    }
  }

  // Per-feature normalization (NeMo default)
  for (let m = 0; m < N_MELS; m++) {
    let sum = 0,
      sum2 = 0;
    for (let t = 0; t < nFrames; t++) {
      const v = mel[m * nFrames + t];
      sum += v;
      sum2 += v * v;
    }
    const mean = sum / nFrames;
    const std = Math.sqrt(Math.max(sum2 / nFrames - mean * mean, 1e-10));
    for (let t = 0; t < nFrames; t++)
      mel[m * nFrames + t] = (mel[m * nFrames + t] - mean) / std;
  }

  return { mel, nFrames };
}

// ── RNNT Greedy Decoder ────────────────────────────────────────────────────────
//
// Uses the verified input/output names from ONNX inspection.
//
// Per-step call:
//   IN:  encoder_outputs  [1, 512, time_enc]  (full encoder output, reused each step)
//        targets          [1, 1]              int32  (previous non-blank token)
//        target_length    [1]                 int32  (always 1)
//        input_states_1   [1, 1, 640]         float32
//        input_states_2   [1, 1, 640]         float32
//   OUT: outputs          [1, 1, 1, 1025]     float32  (joint logits)
//        output_states_1  [1, 1, 640]
//        output_states_2  [1, 1, 640]

interface DecodeResult {
  tokenIds: number[];
  frameIndices: number[];
}

async function greedyRNNT(
  encoderOut: ort.Tensor, // [1, 512, time_enc]
  decoderSession: ort.InferenceSession,
  blankId: number,
  maxSymbols = 10,
): Promise<DecodeResult> {
  const tokenIds: number[] = [];
  const frameIndices: number[] = [];

  const timeEnc = encoderOut.dims[2] as number;
  const hiddenDim = 640;

  // Initial LSTM states: zeros [1, 1, 640]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state1: any = new ort.Tensor("float32", new Float32Array(hiddenDim), [
    1,
    1,
    hiddenDim,
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state2: any = new ort.Tensor("float32", new Float32Array(hiddenDim), [
    1,
    1,
    hiddenDim,
  ]);

  // Previous predicted token (start with blank)
  let prevToken = blankId;

  for (let t = 0; t < timeEnc; t++) {
    let symbolsThisStep = 0;

    while (symbolsThisStep < maxSymbols) {
      const targetsTensor = new ort.Tensor(
        "int32",
        Int32Array.from([prevToken]),
        [1, 1],
      );
      const targetLenTensor = new ort.Tensor(
        "int32",
        Int32Array.from([1]),
        [1],
      );

      const out = await decoderSession.run({
        encoder_outputs: encoderOut,
        targets: targetsTensor,
        target_length: targetLenTensor,
        input_states_1: state1,
        input_states_2: state2,
      });

      // Logits: [1, 1, 1, 1025] → argmax over last dim
      const logits = out["outputs"].data as Float32Array;
      const vocabSz = out["outputs"].dims[
        out["outputs"].dims.length - 1
      ] as number;

      // Find logits for current frame t
      // The decoder_joint output for frame t is at offset t * vocabSz
      // But since we pass the full encoder_outputs, we need offset t
      const offset = t * vocabSz;
      let maxVal = -Infinity,
        predicted = blankId;
      for (let i = 0; i < vocabSz; i++) {
        if (logits[offset + i] > maxVal) {
          maxVal = logits[offset + i];
          predicted = i;
        }
      }

      // Update LSTM states
      state1 = out["output_states_1"] as ort.Tensor;
      state2 = out["output_states_2"] as ort.Tensor;

      if (predicted === blankId) break;

      tokenIds.push(predicted);
      frameIndices.push(t);
      prevToken = predicted;
      symbolsThisStep++;
    }
  }

  return { tokenIds, frameIndices };
}

// ── Detokenize → words with timestamps ───────────────────────────────────────

interface Tokenizer {
  vocab_size: number;
  blank_id: number;
  vocab: Record<string, string>;
  word_boundary: string;
}

function tokensToWords(
  tokenIds: number[],
  frameIndices: number[],
  tokenizer: Tokenizer,
  audioDurMs: number,
): WordTiming[] {
  if (!tokenIds.length) return [];

  const wb = tokenizer.word_boundary; // "▁"
  const vocab = tokenizer.vocab;

  const words: WordTiming[] = [];
  let curWord = "";
  let wordStartFr = frameIndices[0];

  for (let i = 0; i < tokenIds.length; i++) {
    const piece = vocab[String(tokenIds[i])] ?? "";
    const frame = frameIndices[i];

    if (piece.startsWith(wb) && curWord.length > 0) {
      // Flush previous word
      const endMs = Math.min(frame * MS_PER_STEP, audioDurMs);
      words.push({
        word: curWord,
        startMs: wordStartFr * MS_PER_STEP,
        endMs,
        durationMs: endMs - wordStartFr * MS_PER_STEP,
        encoderFrame: wordStartFr,
      });
      curWord = piece.replace(wb, "");
      wordStartFr = frame;
    } else {
      curWord += piece.replace(wb, "");
    }
  }

  // Flush last word
  if (curWord.length > 0) {
    words.push({
      word: curWord,
      startMs: wordStartFr * MS_PER_STEP,
      endMs: audioDurMs,
      durationMs: audioDurMs - wordStartFr * MS_PER_STEP,
      encoderFrame: wordStartFr,
    });
  }

  return words;
}

// ── VAD calibration (mirrors madd_audio_verifier.py) ─────────────────────────

function vadSpeechMs(samples: Float32Array): number {
  const frameSamples = Math.round(0.01 * SAMPLE_RATE); // 10ms
  const nFrames = Math.floor(samples.length / frameSamples);
  let voiced = 0,
    consec = 0;
  for (let i = 0; i < nFrames; i++) {
    const f = samples.subarray(i * frameSamples, (i + 1) * frameSamples);
    let ss = 0;
    for (let j = 0; j < f.length; j++) ss += f[j] * f[j];
    if (Math.sqrt(ss / f.length) > 0.015) {
      consec++;
    } else {
      consec = 0;
    }
    if (consec >= 3) voiced++;
  }
  return voiced * 10;
}

function calibrateTimings(
  timings: WordTiming[],
  samples: Float32Array,
): WordTiming[] {
  if (!timings.length) return timings;
  const vad = vadSpeechMs(samples);
  const total = timings.reduce((s, t) => s + t.durationMs, 0);
  if (!total || !vad) return timings;
  const scale = Math.min(Math.max(vad / total, 0.8), 8.0);
  return timings.map((t) => ({
    ...t,
    startMs: t.startMs * scale,
    endMs: t.startMs * scale + t.durationMs * scale,
    durationMs: t.durationMs * scale,
  }));
}

// ── Model loading ─────────────────────────────────────────────────────────────

let _enc: ort.InferenceSession | null = null;
let _dec: ort.InferenceSession | null = null;
let _tok: Tokenizer | null = null;
let _loadP: Promise<void> | null = null;

// Tajweed annotations loaded from HF (gzipped JSON)
let _tajweedData: Record<string, Record<string, unknown[]>> | null = null;
export function getTajweedData() {
  return _tajweedData;
}

async function ensureModels(
  onProgress?: (pct: number, msg: string) => void,
): Promise<void> {
  if (_enc && _dec && _tok) return;
  if (_loadP) return _loadP;

  _loadP = (async () => {
    const hasWebGPU =
      typeof navigator !== "undefined" &&
      !!(navigator as unknown as { gpu?: unknown }).gpu;
    const eps = hasWebGPU ? ["webgpu", "wasm"] : ["wasm"];
    console.log("[LocalASR] EP:", eps[0]);

    // Download + cache all model files from HuggingFace via OPFS
    const { loadModelFiles } = await import("../lib/modelLoader");
    const { encoderBuffer, decoderBuffer, tokenizerJson, tajweedJson } =
      await loadModelFiles(onProgress);

    // Parse tokenizer
    _tok = JSON.parse(tokenizerJson) as Tokenizer;
    BLANK_ID = _tok.blank_id;

    // Parse tajweed annotations
    _tajweedData = JSON.parse(tajweedJson);

    // Load ONNX sessions from ArrayBuffer (no re-download needed)
    _enc = await ort.InferenceSession.create(encoderBuffer, {
      executionProviders: eps,
      graphOptimizationLevel: "all",
    });
    console.log("[LocalASR] Encoder ready");

    _dec = await ort.InferenceSession.create(decoderBuffer, {
      executionProviders: eps,
      graphOptimizationLevel: "all",
    });
    console.log("[LocalASR] Decoder ready");
    onProgress?.(100, "Ready ✓");
  })();

  return _loadP;
}

// ── Core transcribe function ──────────────────────────────────────────────────

export async function transcribeAudio(
  pcm16: Int16Array,
  audioDurMs: number,
): Promise<{ text: string; timings: WordTiming[] } | null> {
  if (!_enc || !_dec || !_tok) throw new Error("Models not loaded");

  // Float32 samples
  const samples = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) samples[i] = pcm16[i] / 32768;

  // RMS gate
  let ss = 0;
  for (let i = 0; i < samples.length; i++) ss += samples[i] * samples[i];
  if (Math.sqrt(ss / samples.length) < 0.005) return null;

  // Mel spectrogram: [1, 80, nFrames]
  const { mel, nFrames } = computeLogMel(samples);
  const audioSignal = new ort.Tensor("float32", mel, [1, N_MELS, nFrames]);
  const lengthTensor = new ort.Tensor(
    "int64",
    BigInt64Array.from([BigInt(nFrames)]),
    [1],
  );

  // Encoder
  const encOut = await _enc.run({
    audio_signal: audioSignal,
    length: lengthTensor,
  });
  const encoderOutputs = encOut["outputs"]; // [1, 512, time_enc]

  // RNNT greedy decode
  const { tokenIds, frameIndices } = await greedyRNNT(
    encoderOutputs,
    _dec,
    BLANK_ID,
  );

  if (!tokenIds.length) return null;

  // Tokens → words + raw NeMo timestamps
  const rawTimings = tokensToWords(tokenIds, frameIndices, _tok, audioDurMs);

  // VAD calibration — corrects NeMo's vowel compression
  const timings = calibrateTimings(rawTimings, samples);
  const text = timings.map((t) => t.word).join(" ");

  return { text, timings };
}

// ── React Hook ────────────────────────────────────────────────────────────────

export interface UseLocalASRReturn {
  isListening: boolean;
  isModelLoaded: boolean;
  isLoadingModel: boolean;
  loadProgress: number;
  loadStatus: string;
  executionProvider: "webgpu" | "wasm" | null;
  error: string | null;
  start: (
    onResult: (r: LocalASRResult) => void,
    opts?: StartOptions,
  ) => Promise<void>;
  stop: () => void;
}

export function useLocalASR(): UseLocalASRReturn {
  const [isListening, setIsListening] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState("");
  const [ep, setEp] = useState<"webgpu" | "wasm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onResultRef = useRef<((r: LocalASRResult) => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bufferRef = useRef<Int16Array[]>([]);
  const listeningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preload on mount
  useEffect(() => {
    setIsLoadingModel(true);
    ensureModels((pct, msg) => {
      setLoadProgress(pct);
      setLoadStatus(msg);
    })
      .then(() => {
        setIsModelLoaded(true);
        setEp(
          typeof navigator !== "undefined" &&
            !!(navigator as unknown as { gpu?: unknown }).gpu
            ? "webgpu"
            : "wasm",
        );
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Model load failed");
      })
      .finally(() => {
        setIsLoadingModel(false);
      });
  }, []);

  const stop = useCallback(() => {
    listeningRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    bufferRef.current = [];
    setIsListening(false);
  }, []);

  const start = useCallback(
    async (onResult: (r: LocalASRResult) => void, opts: StartOptions = {}) => {
      stop();
      if (!isModelLoaded) await ensureModels();

      onResultRef.current = onResult;
      listeningRef.current = true;
      bufferRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = proc;

      proc.onaudioprocess = (e) => {
        if (!listeningRef.current) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++)
          pcm[i] = Math.max(
            -32768,
            Math.min(32767, Math.round(f32[i] * 32768)),
          );
        bufferRef.current.push(pcm);
        opts.onAudioChunk?.(f32.buffer);
      };

      src.connect(proc);
      proc.connect(ctx.destination);
      setIsListening(true);

      // Process every CHUNK_MS
      timerRef.current = setInterval(async () => {
        if (!listeningRef.current || !bufferRef.current.length) return;
        const chunks = bufferRef.current.splice(0);
        const len = chunks.reduce((s, c) => s + c.length, 0);
        const combined = new Int16Array(len);
        let off = 0;
        for (const c of chunks) {
          combined.set(c, off);
          off += c.length;
        }
        const durMs = (combined.length / SAMPLE_RATE) * 1000;
        try {
          const res = await transcribeAudio(combined, durMs);
          if (res?.text.trim()) {
            onResultRef.current?.({
              text: res.text,
              isFinal: true,
              timings: res.timings,
            });
          }
        } catch (e) {
          console.error("[LocalASR] Error:", e);
        }
      }, CHUNK_MS);
    },
    [isModelLoaded, stop],
  );

  return {
    isListening,
    isModelLoaded,
    isLoadingModel,
    loadProgress,
    loadStatus,
    executionProvider: ep,
    error,
    start,
    stop,
  };
}
