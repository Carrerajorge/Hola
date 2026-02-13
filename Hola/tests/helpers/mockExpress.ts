import type { NextFunction } from "express";

type HeaderValue = string | string[] | undefined;

export type MiddlewareLike = (req: any, res: any, next: NextFunction) => any;

export interface MockReqInit {
  method?: string;
  path?: string;
  url?: string;
  headers?: Record<string, HeaderValue>;
  body?: any;
  ip?: string;
  socketRemoteAddress?: string;
  user?: any;
  params?: Record<string, any>;
  query?: Record<string, any>;
}

export interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  ended: boolean;
  setHeader: (name: string, value: any) => void;
  getHeader: (name: string) => string | undefined;
  status: (code: number) => MockRes;
  json: (payload: any) => MockRes;
  send: (payload: any) => MockRes;
  end: () => void;
}

function normalizeHeaders(headers: Record<string, HeaderValue> | undefined): Record<string, HeaderValue> {
  const out: Record<string, HeaderValue> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

export function createMockReq(init: MockReqInit = {}): any {
  const path = init.path ?? "/";
  const url = init.url ?? path;
  return {
    method: init.method ?? "GET",
    path,
    url,
    originalUrl: url,
    headers: normalizeHeaders(init.headers),
    body: init.body ?? {},
    ip: init.ip ?? init.socketRemoteAddress ?? "127.0.0.1",
    socket: {
      remoteAddress: init.socketRemoteAddress ?? init.ip ?? "127.0.0.1",
    },
    user: init.user ?? undefined,
    params: init.params ?? {},
    query: init.query ?? {},
  };
}

export function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name: string, value: any) {
      res.headers[name.toLowerCase()] = String(value);
    },
    getHeader(name: string) {
      return res.headers[name.toLowerCase()];
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      res.ended = true;
      return res;
    },
    send(payload: any) {
      res.body = payload;
      res.ended = true;
      return res;
    },
    end() {
      res.ended = true;
    },
  };
  return res;
}

export async function runMiddlewares(req: any, res: MockRes, middlewares: MiddlewareLike[]): Promise<void> {
  for (const mw of middlewares) {
    if (res.ended) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const next: NextFunction = (err?: any) => {
        if (settled) return;
        settled = true;
        if (err) return reject(err);
        resolve();
      };

      try {
        const ret = mw(req, res as any, next);

        if (ret && typeof ret.then === "function") {
          (ret as Promise<any>).then(() => {
            if (settled) return;
            settled = true;
            resolve();
          }).catch((err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
          return;
        }

        // Synchronous middleware that ended the response without calling next()
        if (res.ended && !settled) {
          settled = true;
          resolve();
        }
      } catch (err) {
        if (settled) return;
        settled = true;
        reject(err);
      }
    });
  }
}

