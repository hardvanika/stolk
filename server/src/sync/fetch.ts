export type Fetch = typeof fetch;

export class RemoteError extends Error {
  constructor(public service: string, public status: number, message: string) {
    super(`${service}: ${message}`);
  }
}

/** JSON request with a timeout. Error bodies are summarised, never echoed with credentials. */
export async function fetchJson(
  f: Fetch, service: string, url: string, init: RequestInit & { timeoutMs?: number } = {},
): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await f(url, { ...init, signal: ctl.signal });
  } catch (e) {
    throw new RemoteError(service, 0, (e as Error).name === 'AbortError' ? 'timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.error_description ?? body?.message ?? (typeof body?.error === 'string' ? body.error : '') ?? '';
    throw new RemoteError(service, res.status, `HTTP ${res.status}${msg ? ` – ${String(msg).slice(0, 200)}` : ''}`);
  }
  return body;
}
