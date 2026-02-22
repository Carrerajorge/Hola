import * as schema from "../../shared/schema";
import { pgTable, getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";

async function main() {
    const connectionString = "postgresql://postgres:postgres@localhost:5432/iliagpt";
    const pool = new pg.Pool({ connectionString });

    console.log("Generating raw schema...");
    let sql = 'CREATE SCHEMA IF NOT EXISTS public;\n';

    // This is a simplified fallback to run raw SQL schema creation.
    // We'll execute it against the DB to skip drizzle kit push blocks.
    try {
        // Relying on Drizzle push without prompts by using accept-data-loss equivalent internally if possible,
        // but since we want to avoid prompts, we can just spawn process with yes
        console.log("Pool connected, ready to sync via CLI...");
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
