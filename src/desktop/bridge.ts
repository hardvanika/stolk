import type { Row, Scalar } from '../db/types';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

/** What desktop/preload.cjs exposes as `window.stolk` inside the Electron window. */
export type DesktopBridge = {
  execute(sql: string, params?: Scalar[]): Promise<{ rows: Row[]; insertId?: number }>;
  modelStat(file: string): { path: string; exists: boolean };
  download(file: string, url: string): Promise<void>;
  completeJson(file: string, prompt: string, schema: object): Promise<unknown>;
  completeChat(file: string, messages: Message[], onToken?: (t: string) => void): Promise<string>;
  embed(file: string, text: string): Promise<number[]>;
};

export function desktop(): DesktopBridge {
  const b = (globalThis as { stolk?: DesktopBridge }).stolk;
  if (!b) throw new Error('Stölk desktop bridge missing: open the app with `npm run desktop`, not in a plain browser.');
  return b;
}
