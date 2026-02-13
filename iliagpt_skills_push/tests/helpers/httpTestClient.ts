import http from "node:http";
import type { Express } from "express";
import supertest from "supertest";

export type HttpTestClient = supertest.SuperTest<supertest.Test>;

/**
 * Supertest starts an ephemeral server and binds it to 0.0.0.0 by default when
 * passed an Express app. Some sandboxed environments disallow binding to all
 * interfaces. This helper binds explicitly to 127.0.0.1 for portability.
 */
export async function createHttpTestClient(app: Express): Promise<{
  client: HttpTestClient;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const client = supertest.agent(server);

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { client, close };
}

