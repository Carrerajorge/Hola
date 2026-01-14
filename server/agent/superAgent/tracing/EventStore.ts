import { TraceEvent } from "./types";
import { db } from "../../../db";
import { sql } from "drizzle-orm";

interface EventStoreOptions {
  tableName?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class EventStore {
  private buffer: TraceEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private options: Required<EventStoreOptions>;
  private initialized: boolean = false;

  constructor(options: EventStoreOptions = {}) {
    this.options = {
      tableName: options.tableName ?? "trace_events",
      batchSize: options.batchSize ?? 100,
      flushIntervalMs: options.flushIntervalMs ?? 500,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trace_events (
        id SERIAL PRIMARY KEY,
        run_id VARCHAR(64) NOT NULL,
        seq INTEGER NOT NULL,
        trace_id VARCHAR(64) NOT NULL,
        span_id VARCHAR(64) NOT NULL,
        parent_span_id VARCHAR(64),
        node_id VARCHAR(255) NOT NULL,
        attempt_id INTEGER DEFAULT 1,
        agent VARCHAR(100) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        phase VARCHAR(50),
        message TEXT,
        status VARCHAR(20),
        progress DECIMAL(5,2),
        metrics JSONB,
        evidence JSONB,
        ts BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(run_id, seq)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_trace_events_run_id ON trace_events(run_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events(run_id, seq)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_trace_events_span_id ON trace_events(span_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_trace_events_event_type ON trace_events(event_type)
    `);

    this.initialized = true;
    this.startFlushTimer();
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.options.flushIntervalMs);
  }

  async append(event: TraceEvent): Promise<void> {
    this.buffer.push(event);
    
    if (this.buffer.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  async appendBatch(events: TraceEvent[]): Promise<void> {
    this.buffer.push(...events);
    
    if (this.buffer.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        for (const event of events) {
          await db.execute(sql`
            INSERT INTO trace_events (
              run_id, seq, trace_id, span_id, parent_span_id, node_id,
              attempt_id, agent, event_type, phase, message, status,
              progress, metrics, evidence, ts
            ) VALUES (
              ${event.run_id},
              ${event.seq},
              ${event.trace_id},
              ${event.span_id},
              ${event.parent_span_id},
              ${event.node_id},
              ${event.attempt_id},
              ${event.agent},
              ${event.event_type},
              ${event.phase ?? null},
              ${event.message},
              ${event.status ?? null},
              ${event.progress ?? null},
              ${JSON.stringify(event.metrics ?? {})},
              ${JSON.stringify(event.evidence ?? {})},
              ${event.ts}
            )
            ON CONFLICT (run_id, seq) DO NOTHING
          `);
        }
        return;
      } catch (error: any) {
        lastError = error;
        const isConnectionError = error?.code === '57P01' || 
          error?.message?.includes('terminating connection') ||
          error?.message?.includes('Connection terminated');
        
        if (isConnectionError && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 100;
          console.warn(`[EventStore] Connection error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
    }

    console.error("[EventStore] Flush failed after retries:", lastError?.message || lastError);
    this.buffer.unshift(...events);
  }

  async getEvents(runId: string, fromSeq: number = 0, limit: number = 1000): Promise<TraceEvent[]> {
    const result = await db.execute(sql`
      SELECT 
        run_id, seq, trace_id, span_id, parent_span_id, node_id,
        attempt_id, agent, event_type, phase, message, status,
        progress, metrics, evidence, ts
      FROM trace_events
      WHERE run_id = ${runId} AND seq > ${fromSeq}
      ORDER BY seq ASC
      LIMIT ${limit}
    `);

    return result.rows.map((row: any) => ({
      schema_version: "v1" as const,
      run_id: row.run_id,
      seq: row.seq,
      trace_id: row.trace_id,
      span_id: row.span_id,
      parent_span_id: row.parent_span_id,
      node_id: row.node_id,
      attempt_id: row.attempt_id ?? 1,
      agent: row.agent,
      event_type: row.event_type,
      phase: row.phase,
      message: row.message,
      status: row.status,
      progress: row.progress ? Number(row.progress) : undefined,
      metrics: typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics,
      evidence: typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence,
      ts: Number(row.ts),
    }));
  }

  async getLastSeq(runId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT MAX(seq) as max_seq FROM trace_events WHERE run_id = ${runId}
    `);
    return result.rows[0]?.max_seq ?? 0;
  }

  async getRunSummary(runId: string): Promise<{
    totalEvents: number;
    phases: string[];
    status: string;
    duration_ms: number;
  } | null> {
    const events = await this.getEvents(runId, 0, 10000);
    if (events.length === 0) return null;

    const phases = [...new Set(events.filter(e => e.phase).map(e => e.phase!))];
    const startEvent = events.find(e => e.event_type === "run_started");
    const endEvent = events.find(e => e.event_type === "run_completed" || e.event_type === "run_failed");
    
    return {
      totalEvents: events.length,
      phases,
      status: endEvent?.event_type === "run_completed" ? "completed" : 
              endEvent?.event_type === "run_failed" ? "failed" : "running",
      duration_ms: endEvent && startEvent ? endEvent.ts - startEvent.ts : Date.now() - (startEvent?.ts ?? Date.now()),
    };
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

let eventStoreInstance: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    eventStoreInstance = new EventStore();
  }
  return eventStoreInstance;
}

export async function initializeEventStore(): Promise<EventStore> {
  const store = getEventStore();
  await store.initialize();
  return store;
}
