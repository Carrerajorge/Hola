import { Client } from 'pg';

const client = new Client({
    connectionString: "postgres://postgres:postgres@127.0.0.1:5432/iliagpt"
});

async function run() {
    await client.connect();
    console.log("Connected, dropping schema...");
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    console.log("Schema dropped.");
    await client.end();
}

run().catch(console.error);
