// A minimal MCP server over stdio (newline-delimited JSON-RPC 2.0): tools and prompts, nothing else.
// Small enough to keep by hand, so the bundle needs no extra dependencies.
import { ToolError, type ToolDef } from './tools.js';

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface PromptDef { name: string; title: string; description: string; text: string }
export interface McpOptions {
  name: string;
  version: string;
  instructions: string;
  tools: ToolDef[];
  prompts: PromptDef[];
  log?: (msg: string) => void;
}

type Msg = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any };

const err = (code: number, message: string) => ({ error: { code, message } });

/** Handles one JSON-RPC message. Returns the response object, or undefined for notifications. */
export async function handleMessage(o: McpOptions, msg: Msg): Promise<object | undefined> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  const reply = (body: object) => (isRequest ? { jsonrpc: '2.0', id: msg.id, ...body } : undefined);
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return reply(err(-32600, 'Invalid request'));

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: o.name, title: 'Stölk', version: o.version },
          instructions: o.instructions,
        },
      });
    }
    case 'ping':
      return reply({ result: {} });
    case 'tools/list':
      return reply({
        result: {
          tools: o.tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) })),
        },
      });
    case 'tools/call': {
      const tool = o.tools.find((t) => t.name === msg.params?.name);
      if (!tool) return reply(err(-32602, `Unknown tool: ${msg.params?.name}`));
      try {
        const out = await tool.run(msg.params?.arguments ?? {});
        return reply({ result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
      } catch (e) {
        // Mistakes Claude can fix come back as a tool error it can read; anything else is logged too.
        if (!(e instanceof ToolError)) o.log?.(`tool ${tool.name} failed: ${e instanceof Error ? e.stack : e}`);
        const text = e instanceof Error ? e.message : String(e);
        return reply({ result: { content: [{ type: 'text', text }], isError: true } });
      }
    }
    case 'prompts/list':
      return reply({ result: { prompts: o.prompts.map(({ name, title, description }) => ({ name, title, description, arguments: [] })) } });
    case 'prompts/get': {
      const p = o.prompts.find((x) => x.name === msg.params?.name);
      if (!p) return reply(err(-32602, `Unknown prompt: ${msg.params?.name}`));
      return reply({ result: { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text } }] } });
    }
    default:
      // Notifications (initialized, cancelled, ...) need no answer.
      if (msg.method.startsWith('notifications/')) return undefined;
      return reply(err(-32601, `Method not found: ${msg.method}`));
  }
}

/** Reads newline-delimited JSON-RPC from input and writes responses to output. Resolves when input ends. */
export function serveStdio(o: McpOptions, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve) => {
    let buf = '';
    let chain = Promise.resolve();
    const handleLine = async (line: string) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, ...err(-32700, 'Parse error') }) + '\n');
        return;
      }
      const batch = Array.isArray(msg) ? msg : [msg];
      for (const m of batch) {
        const res = await handleMessage(o, m);
        if (res) output.write(JSON.stringify(res) + '\n');
      }
    };
    input.setEncoding?.('utf8');
    input.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        // One at a time, in order: the database is synchronous anyway.
        if (line) chain = chain.then(() => handleLine(line));
      }
    });
    input.on('end', () => { chain.then(() => resolve()); });
  });
}
