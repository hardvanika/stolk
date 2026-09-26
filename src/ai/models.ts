import { Directory, File, Paths } from 'expo-file-system';

/**
 * GGUF models run by llama.cpp on the phone. They are downloaded once (or copied in by hand);
 * after that the app never needs the network.
 * Swap `url` for any other small instruct model in GGUF format.
 */
export const MODELS = {
  chat: {
    label: 'Qwen3 1.7B (Q4_K_M)',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    approxMB: 1100,
  },
  embed: {
    label: 'nomic-embed-text v1.5 (Q8_0)',
    file: 'nomic-embed-text-v1.5.Q8_0.gguf',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf',
    approxMB: 140,
  },
} as const;

export type ModelKind = keyof typeof MODELS;

const modelDir = () => new Directory(Paths.document, 'models');

export function modelFile(kind: ModelKind): File {
  return new File(modelDir(), MODELS[kind].file);
}

export function isDownloaded(kind: ModelKind): boolean {
  return modelFile(kind).exists;
}

export async function download(kind: ModelKind): Promise<void> {
  const dir = modelDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const target = modelFile(kind);
  if (target.exists) return;
  await File.downloadFileAsync(MODELS[kind].url, target);
}
