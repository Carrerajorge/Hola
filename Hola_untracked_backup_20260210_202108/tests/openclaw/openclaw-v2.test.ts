import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

import openClawRouter from '../../server/routes/openClawRouter';
import { createHttpTestClient, type HttpTestClient } from '../helpers/httpTestClient';

describe('OpenClaw v2 API', () => {
  let client: HttpTestClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/openclaw', openClawRouter);

    const bound = await createHttpTestClient(app);
    client = bound.client;
    close = bound.close;
  });

  afterAll(async () => {
    await close?.();
  });

  it('GET /api/openclaw/v2/stats returns unified 1000 stats', async () => {
    const res = await client.get('/api/openclaw/v2/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1000);
    expect(typeof res.body.coveragePercent).toBe('number');
    expect(typeof res.body.promptsLoaded).toBe('number');
  });

  it('GET /api/openclaw/v2/prompt/1 returns a prompt payload', async () => {
    const res = await client.get('/api/openclaw/v2/prompt/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.prompt).toBeTruthy();
    expect(res.body.prompt.id).toBe(1);
  });

  it('GET /api/openclaw/v2/report includes roadmap', async () => {
    const res = await client.get('/api/openclaw/v2/report');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report).toBeTruthy();
    expect(res.body.report.roadmap).toBeTruthy();
    expect(res.body.report.roadmap.summary).toBeTruthy();
  });
});
