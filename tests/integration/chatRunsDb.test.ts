import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";
import * as schema from "../../shared/schema";
import { randomUUID } from "crypto";

// For this isolated test we use the existing local DB endpoint (assuming it's running via docker map or local pg)
// If DATABASE_URL isn't set, this test will just skip. 
describe("chat_runs idempotent inserts (ON CONFLICT DO UPDATE)", () => {
  let client: pg.Client;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn("DATABASE_URL not set, skipping DB integration test");
      return;
    }
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    db = drizzle(client, { schema });
    
    // Create isolation test table structurally identical to chat_runs
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_chats (id varchar PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE IF NOT EXISTS test_chat_runs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), 
        chat_id varchar NOT NULL REFERENCES test_chats(id), 
        client_request_id varchar NOT NULL, 
        user_message_id varchar, 
        assistant_message_id varchar, 
        status text NOT NULL DEFAULT 'pending', 
        last_seq int DEFAULT 0, 
        error text, 
        metadata jsonb, 
        created_at timestamp DEFAULT now() NOT NULL, 
        started_at timestamp, 
        completed_at timestamp, 
        UNIQUE(chat_id, client_request_id)
      );
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`DROP TABLE IF EXISTS test_chat_runs CASCADE; DROP TABLE IF EXISTS test_chats CASCADE;`);
      await client.end();
    }
  });

  const runUpsertQuery = async (runId: string, chatId: string, clientRequestId: string, messageId: string, status: string = 'pending') => {
    return db.execute(sql`
      INSERT INTO test_chat_runs (
        id, chat_id, client_request_id, user_message_id, 
        assistant_message_id, status, last_seq, error, metadata,
        created_at, started_at, completed_at
      ) VALUES (
        ${runId}::uuid,
        ${chatId}::uuid,
        ${clientRequestId}::text,
        ${messageId}::uuid,
        NULL,
        ${status}::text,
        0::integer,
        NULL,
        NULL,
        DEFAULT, NULL, NULL
      )
      ON CONFLICT (chat_id, client_request_id)
      DO UPDATE SET status = EXCLUDED.status
      RETURNING *
    `);
  };

  it("should insert and update idempotently", async () => {
    if (!process.env.DATABASE_URL) return;
    
    const chatId = randomUUID();
    await client.query(`INSERT INTO test_chats (id) VALUES ($1)`, [chatId]);
    
    const clientRequestId = "req-test-123";
    const runId1 = randomUUID();
    const messageId = randomUUID();

    const res1 = await runUpsertQuery(runId1, chatId, clientRequestId, messageId, 'pending');
    expect(res1.rows[0].id).toBe(runId1);

    const runId2 = randomUUID(); 
    const res2 = await runUpsertQuery(runId2, chatId, clientRequestId, messageId, 'processing');
    
    // DO UPDATE retains the primary key of the FIRST insert!
    expect(res2.rows.length).toBe(1);
    expect(res2.rows[0].id).toBe(runId1); 
    expect(res2.rows[0].id).not.toBe(runId2);
    expect(res2.rows[0].status).toBe('processing'); // Successfully updated
    
    const countRes = await client.query('SELECT COUNT(*) FROM test_chat_runs WHERE chat_id = $1', [chatId]);
    expect(parseInt(countRes.rows[0].count)).toBe(1);
  });
});
