import pg from "pg";
import { readFileSync } from "fs";

async function main() {
    const envContent = readFileSync(".env", "utf-8");
    const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
    if (!dbUrlMatch) {
        throw new Error("DATABASE_URL not found in .env");
    }

    const url = dbUrlMatch[1].trim();
    const { Client } = pg;
    const client = new Client({ connectionString: url });

    try {
        await client.connect();
        console.log("Connected, dropping schema public...");
        await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
        console.log("Schema reset successfully.");
    } finally {
        await client.end();
    }
}

main().catch(console.error);
