import { initLlama, type LlamaContext } from 'llama.rn';
import { modelFile, isDownloaded } from './models';
import { EMBED_DIM } from '../db/schema';

let chatCtx: Promise<LlamaContext> | null = null;
let embedCtx: Promise<LlamaContext> | null = null;

const STOP = ['<|im_end|>', '<|endoftext|>', '</s>', '<|eot_id|>'];

export const chatReady = () => isDownloaded('chat');
export const embedReady = () => isDownloaded('embed');

function chat(): Promise<LlamaContext> {
  chatCtx ??= initLlama({ model: modelFile('chat').uri, n_ctx: 4096, n_gpu_layers: 99, use_mlock: true });
  return chatCtx;
}

function embedder(): Promise<LlamaContext> {
  embedCtx ??= initLlama({ model: modelFile('embed').uri, embedding: true, n_ctx: 2048, n_gpu_layers: 99 });
  return embedCtx;
}

// nomic-embed expects task prefixes.
async function embedWith(prefix: string, text: string): Promise<number[]> {
  const { embedding } = await (await embedder()).embedding(prefix + text);
  if (embedding.length !== EMBED_DIM) throw new Error(`Embedding has ${embedding.length} dims, expected ${EMBED_DIM}`);
  return embedding;
}
export const embedDocument = (t: string) => embedWith('search_document: ', t);
export const embedQuery = (t: string) => embedWith('search_query: ', t);

/** JSON constrained by a schema (llama.cpp turns it into a grammar, so output always parses). */
export async function completeJson(prompt: string, schema: object): Promise<unknown> {
  const r = await (await chat()).completion({
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_schema', json_schema: { strict: true, schema } },
    enable_thinking: false,
    temperature: 0,
    n_predict: 256,
    stop: STOP,
  });
  return JSON.parse(r.text);
}

export async function completeChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onToken?: (t: string) => void,
): Promise<string> {
  const r = await (await chat()).completion(
    { messages, enable_thinking: false, temperature: 0.2, n_predict: 400, stop: STOP },
    (d) => onToken?.(d.token),
  );
  return r.text.trim();
}
