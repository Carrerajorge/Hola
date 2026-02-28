import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Some dependencies still reference CommonJS globals (module/exports) even when bundled.
// When output format is ESM, these are not defined by Node.
// Provide a minimal shim to avoid runtime crashes like:
//   ReferenceError: module is not defined in ES module scope
const module = { exports: {} };
const exports = module.exports;

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{mb as c}from"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import{a as s}from"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";async function E(){let e=await c.connect();try{s.info("[FTS] Starting Full-Text Search setup..."),await e.query(`
      ALTER TABLE chat_messages 
      ADD COLUMN IF NOT EXISTS search_vector tsvector;
    `),await e.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_search_idx 
      ON chat_messages 
      USING GIN (search_vector);
    `),await e.query(`
      CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('spanish', coalesce(NEW.content, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `),await e.query(`
      DROP TRIGGER IF EXISTS messages_search_vector_update ON chat_messages;
      CREATE TRIGGER messages_search_vector_update
      BEFORE INSERT OR UPDATE ON chat_messages
      FOR EACH ROW
      EXECUTE PROCEDURE messages_search_vector_update();
    `);let{rows:t}=await e.query("SELECT COUNT(*) as count FROM chat_messages WHERE search_vector IS NULL"),a=parseInt(t[0].count,10);a>0?(s.info(`[FTS] Backfilling ${a} messages with null search_vector...`),await e.query(`
        UPDATE chat_messages 
        SET search_vector = to_tsvector('spanish', coalesce(content, ''))
        WHERE search_vector IS NULL;
      `),s.info("[FTS] Backfill complete.")):s.info("[FTS] No backfill needed."),s.info("[FTS] Setup complete.")}catch(t){s.error("[FTS] Setup failed:",t.message)}finally{e.release()}}export{E as setupFts};
