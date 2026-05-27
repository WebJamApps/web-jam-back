/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal supertest-shaped wrapper using native fetch + an ephemeral HTTP server.
// Replaces supertest in this repo's tests; covers the .get/.post/.put/.delete +
// .set/.send/.query chain that the existing tests use.

import http from 'node:http';
import type { Express } from 'express';

export interface ApiResponse {
  status: number;
  body: any;
  headers: Record<string, string>;
}

interface BoundServer {
  server: http.Server;
  baseUrl: string;
}

const cache = new WeakMap<Express, Promise<BoundServer>>();

function getServer(app: Express): Promise<BoundServer> {
  let p = cache.get(app);
  if (p) return p;
  p = new Promise((resolve, reject) => {
    const server = http.createServer(app as unknown as http.RequestListener);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind ephemeral port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
  cache.set(app, p);
  return p;
}

class ApiRequest implements PromiseLike<ApiResponse> {
  private headers: Record<string, string> = {};

  private body: unknown = undefined;

  private bodyIsRaw = false;

  private queryParams: Record<string, string> = {};

  constructor(
    private readonly app: Express,
    private readonly method: string,
    private readonly path: string,
  ) {}

  set(headers: Record<string, string>): this;
  set(name: string, value: string): this;
  set(arg1: string | Record<string, string>, arg2?: string): this {
    if (typeof arg1 === 'string') {
      this.headers[arg1] = arg2 as string;
    } else {
      for (const [k, v] of Object.entries(arg1)) this.headers[k] = v;
    }
    return this;
  }

  send(body: unknown): this {
    this.body = body;
    this.bodyIsRaw = typeof body === 'string';
    return this;
  }

  query(q: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(q)) this.queryParams[k] = String(v);
    return this;
  }

  private async execute(): Promise<ApiResponse> {
    const { baseUrl } = await getServer(this.app);
    let url = baseUrl + this.path;
    const qs = new URLSearchParams(this.queryParams).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;

    const init: RequestInit = { method: this.method, headers: { ...this.headers } };
    if (this.body !== undefined) {
      if (this.bodyIsRaw) {
        init.body = this.body as string;
      } else {
        init.body = JSON.stringify(this.body);
        const h = init.headers as Record<string, string>;
        if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
          h['Content-Type'] = 'application/json';
        }
      }
    }

    const res = await fetch(url, init);
    const ct = res.headers.get('content-type') || '';
    let body: any;
    if (ct.includes('application/json')) {
      body = await res.json().catch(() => undefined);
    } else {
      const text = await res.text();
      body = text === '' ? undefined : text;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, body, headers };
  }

  then<TResolve = ApiResponse, TReject = never>(
    onFulfilled?: ((value: ApiResponse) => TResolve | PromiseLike<TResolve>) | null,
    onRejected?: ((reason: any) => TReject | PromiseLike<TReject>) | null,
  ): Promise<TResolve | TReject> {
    return this.execute().then(onFulfilled, onRejected);
  }
}

export default function request(app: Express) {
  return {
    get: (path: string) => new ApiRequest(app, 'GET', path),
    post: (path: string) => new ApiRequest(app, 'POST', path),
    put: (path: string) => new ApiRequest(app, 'PUT', path),
    delete: (path: string) => new ApiRequest(app, 'DELETE', path),
    patch: (path: string) => new ApiRequest(app, 'PATCH', path),
  };
}
