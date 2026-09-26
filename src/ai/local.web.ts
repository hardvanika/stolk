import { desktop } from '../desktop/bridge';
import { MODELS } from './catalog';
import { isDownloaded } from './models';
import { EMBED_DIM } from '../db/schema';

// Desktop: the same GGUF models, run by node-llama-cpp in the Electron main process (desktop/llm.mjs).

export const chatReady = () => isDownloaded('chat');
export const embedReady = () => isDownloaded('embed');

// nomic-embed expects task prefixes.
async function embedWith(prefix: string, text: string): Promise<number[]> {
  const embedding = await desktop().embed(MODELS.embed.file, prefix + text);
  if (embedding.length !== EMBED_DIM) throw new Error(`Embedding has ${embedding.length} dims, expected ${EMBED_DIM}`);
  return embedding;
}
export const embedDocument = (t: string) => embedWith('search_document: ', t);
export const embedQuery = (t: string) => embedWith('search_query: ', t);

export function completeJson(prompt: string, schema: object): Promise<unknown> {
  return desktop().completeJson(MODELS.chat.file, prompt, schema);
}

export function completeChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onToken?: (t: string) => void,
): Promise<string> {
  return desktop().completeChat(MODELS.chat.file, messages, onToken);
}
