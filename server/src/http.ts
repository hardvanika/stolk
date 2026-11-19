import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const bad = (message: string) => new HttpError(400, 'bad_request', message);

export type Query = URLSearchParams;
export interface Ctx {
  params: Record<string, string>;
  query: Query;
  body: any;
  /** "127.0.0.1:PORT" as the client addressed us; used to build OAuth redirect URIs. */
  host: string;
}

/** Return this from a handler to answer with a small HTML page instead of JSON. */
export class Html {
  constructor(public html: string, public status = 200) {}
}
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Route {
  method: Method;
  parts: string[];
  handler: Handler;
  public: boolean;
}

export class Router {
  private routes: Route[] = [];
  add(method: Method, path: string, handler: Handler, opts: { public?: boolean } = {}) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler, public: !!opts.public });
    return this;
  }
  get(p: string, h: Handler, o?: { public?: boolean }) { return this.add('GET', p, h, o); }
  post(p: string, h: Handler) { return this.add('POST', p, h); }
  put(p: string, h: Handler) { return this.add('PUT', p, h); }
  patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.add('DELETE', p, h); }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = segs[i];
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}

const MAX_BODY = 1_000_000;

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Body too large');
    chunks.push(c as Buffer);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bad('Body is not valid JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  if (status === 204 || body === undefined) {
    res.writeHead(status === 200 ? 204 : status, extra);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(json);
}

function tokenOk(header: string | undefined, token: string) {
  if (!header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApiServer(router: Router, token: string): Server {
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Only the file:// renderer (Origin: null) or non-browser clients (no Origin) may call us.
    if (origin !== undefined && origin !== 'null') return send(res, 403, { error: { code: 'origin', message: 'Origin not allowed' } });
    const cors: Record<string, string> = origin === 'null' ? { 'Access-Control-Allow-Origin': 'null', Vary: 'Origin' } : {};

    const port = (server.address() as { port: number } | null)?.port;
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return send(res, 403, { error: { code: 'host', message: 'Host not allowed' } }, cors);
    }

    if (req.method === 'OPTIONS') {
      return send(res, 204, undefined, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }

    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      const m = router.match(req.method ?? 'GET', url.pathname);
      if (m === null) throw notFound(`No route for ${url.pathname}`);
      if (m === 'method') throw new HttpError(405, 'method', 'Method not allowed');
      if (!m.route.public && !tokenOk(req.headers.authorization, token)) {
        throw new HttpError(401, 'unauthorized', 'Missing or wrong bearer token');
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method!) ? await readBody(req) : undefined;
      const out = await m.route.handler({ params: m.params, query: url.searchParams, body: body ?? {}, host });
      if (out instanceof Html) {
        res.writeHead(out.status, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        return void res.end(out.html);
      }
      send(res, req.method === 'POST' && out !== undefined ? 201 : out === undefined ? 204 : 200, out, cors);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } }, cors);
      const msg = e instanceof Error ? e.message : String(e);
      if (/constraint failed/i.test(msg)) return send(res, 409, { error: { code: 'constraint', message: msg } }, cors);
      console.error(e);
      send(res, 500, { error: { code: 'internal', message: 'Internal error' } }, cors);
    }
  });
  return server;
}
