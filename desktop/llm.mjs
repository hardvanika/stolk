// Local models on the desktop via node-llama-cpp (llama.cpp, same GGUF files as the phone).
import { getLlama, LlamaChatSession } from 'node-llama-cpp';

let llamaP = null;
const llama = () => (llamaP ??= getLlama());

let chat = null; // { path, ctx: Promise<LlamaContext> }
let embed = null; // { path, ctx: Promise<LlamaEmbeddingContext> }

function chatContext(path) {
  if (chat?.path !== path) {
    chat = { path, ctx: llama().then((l) => l.loadModel({ modelPath: path })).then((m) => m.createContext({ contextSize: 4096 })) };
  }
  return chat.ctx;
}

function embedContext(path) {
  if (embed?.path !== path) {
    embed = { path, ctx: llama().then((l) => l.loadModel({ modelPath: path })).then((m) => m.createEmbeddingContext({ contextSize: 2048 })) };
  }
  return embed.ctx;
}

// One chat context, one sequence: run prompts one at a time.
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function withSession(path, systemPrompt, fn) {
  const ctx = await chatContext(path);
  const sequence = ctx.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt });
  try {
    return await fn(session);
  } finally {
    session.dispose();
    sequence.dispose();
  }
}

// Qwen3 "thinks" by default; the phone disables it with enable_thinking: false.
const NO_THINKING = { budgets: { thoughtTokens: 0 } };

/** JSON constrained by a schema (turned into a grammar, so the output always parses). */
export function completeJson(path, prompt, schema) {
  return serial(async () => {
    const grammar = await (await llama()).createGrammarForJsonSchema(schema);
    const text = await withSession(path, undefined, (s) =>
      s.prompt(prompt, { ...NO_THINKING, grammar, temperature: 0, maxTokens: 256 }),
    );
    return grammar.parse(text);
  });
}

/** `messages` is [system, user] as built by src/rag/answer.ts. */
export function completeChat(path, messages, onToken) {
  return serial(async () => {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const text = await withSession(path, system || undefined, (s) =>
      s.prompt(user, { ...NO_THINKING, temperature: 0.2, maxTokens: 400, onTextChunk: onToken }),
    );
    return text.trim();
  });
}

export async function embedText(path, text) {
  const { vector } = await (await embedContext(path)).getEmbeddingFor(text);
  return Array.from(vector);
}
