/**
 * modelLoader.ts — Download model files from HuggingFace + cache in OPFS
 * ========================================================================
 *
 * First load: downloads from HuggingFace (~130MB total), stores in OPFS.
 * Subsequent loads: reads from OPFS instantly, fully offline.
 *
 * OPFS (Origin Private File System) is supported in:
 *   Chrome 86+, Safari 15.2+, Firefox 111+
 */

const HF_BASE =
  "https://huggingface.co/darwish98/whisperquran-fastconformer/resolve/main";

export const MODEL_FILES = {
  encoder: `${HF_BASE}/encoder_int8.onnx`,
  decoder: `${HF_BASE}/decoder_joint_int8.onnx`,
  tokenizer: `${HF_BASE}/tokenizer.json`,
  tajweed: `${HF_BASE}/tajweed_all_surahs.json`,
};

const CACHE_VERSION = "v1"; // bump to invalidate cache after model updates

export type ProgressCallback = (
  pct: number,
  msg: string,
  bytes?: number,
  total?: number,
) => void;

// ── OPFS helpers ──────────────────────────────────────────────────────────────

async function getOPFSDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(`whisperquran-${CACHE_VERSION}`, {
    create: true,
  });
}

async function readFromOPFS(filename: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await getOPFSDir();
    const file = await dir.getFileHandle(filename);
    const f = await file.getFile();
    return f.arrayBuffer();
  } catch {
    return null;
  }
}

async function writeToOPFS(filename: string, data: ArrayBuffer): Promise<void> {
  const dir = await getOPFSDir();
  const file = await dir.getFileHandle(filename, { create: true });
  const writer = await file.createWritable();
  await writer.write(data);
  await writer.close();
}

// ── Download with progress ────────────────────────────────────────────────────

async function downloadWithProgress(
  url: string,
  onProgress?: ProgressCallback,
  label = "",
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

  const total = parseInt(response.headers.get("content-length") ?? "0");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress && total) {
      onProgress(
        Math.round((received / total) * 100),
        label || `Downloading...`,
        received,
        total,
      );
    }
  }

  // Concatenate chunks
  const all = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all.buffer;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LoadedModels {
  encoderBuffer: ArrayBuffer;
  decoderBuffer: ArrayBuffer;
  tokenizerJson: string;
  tajweedJson: string; // raw JSON string
}

export async function loadModelFiles(
  onProgress?: ProgressCallback,
): Promise<LoadedModels> {
  const filenames = {
    encoder: "encoder_int8.onnx",
    decoder: "decoder_joint_int8.onnx",
    tokenizer: "tokenizer.json",
    tajweed: "tajweed_all_surahs.json",
  };

  const results: Record<string, ArrayBuffer> = {};
  const entries = Object.entries(filenames);
  const weights = { encoder: 70, decoder: 5, tokenizer: 1, tajweed: 24 }; // approx %
  let cumPct = 0;

  for (const [key, filename] of entries) {
    // Try OPFS cache first
    const cached = await readFromOPFS(filename);
    if (cached) {
      console.log(
        `[ModelLoader] ${filename} loaded from cache (${(cached.byteLength / 1024 / 1024).toFixed(1)}MB)`,
      );
      results[key] = cached;
      cumPct += weights[key as keyof typeof weights];
      onProgress?.(cumPct, `${filename} (cached)`);
      continue;
    }

    // Download from HF
    const url = MODEL_FILES[key as keyof typeof MODEL_FILES];
    const share = weights[key as keyof typeof weights];
    console.log(`[ModelLoader] Downloading ${filename} from HuggingFace...`);

    const data = await downloadWithProgress(
      url,
      (pct, _msg, bytes, total) => {
        const overall = cumPct + Math.round((pct * share) / 100);
        const mb = bytes ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : "";
        const tot = total ? ` / ${(total / 1024 / 1024).toFixed(1)}MB` : "";
        onProgress?.(overall, `Downloading ${filename} ${mb}${tot}`);
      },
      filename,
    );

    // Cache to OPFS
    await writeToOPFS(filename, data);
    console.log(`[ModelLoader] ${filename} cached to OPFS`);
    results[key] = data;
    cumPct += share;
  }

  return {
    encoderBuffer: results.encoder,
    decoderBuffer: results.decoder,
    tokenizerJson: new TextDecoder().decode(results.tokenizer),
    tajweedJson: new TextDecoder().decode(results.tajweed),
  };
}

/** Check if model files are already cached in OPFS */
export async function isModelCached(): Promise<boolean> {
  const cached = await readFromOPFS("encoder_int8.onnx");
  return cached !== null && cached.byteLength > 1_000_000;
}

/** Clear cached model files (e.g. for updates) */
export async function clearModelCache(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(`whisperquran-${CACHE_VERSION}`, { recursive: true });
}
