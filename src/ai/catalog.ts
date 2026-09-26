/**
 * GGUF models run by llama.cpp on the device. They are downloaded once (or copied in by hand);
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
