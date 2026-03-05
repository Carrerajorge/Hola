import pg from "pg";

async function main() {
    console.log("Connecting to DB to wipe public schema...");
    const connectionString = "postgres://postgres:postgres@127.0.0.1:5432/iliagpt";
    const pool = new pg.Pool({ connectionString });

    try {
        await pool.query(`DROP SCHEMA public CASCADE;`);
        await pool.query(`CREATE SCHEMA public;`);
        console.log("Successfully wiped and recreated public schema.");
    } catch (e: any) {
        console.error("Error wiping DB: ", e.message);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
