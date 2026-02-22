import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { readFileSync } from "fs";

async function main() {
    const connectionString = "postgresql://postgres:postgres@localhost:5432/iliagpt";
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool);

    console.log("Running migrations...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations applied successfully.");
    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
