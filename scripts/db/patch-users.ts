import pg from "pg";

async function main() {
    const connectionString = "postgresql://postgres:postgres@localhost:5432/iliagpt";
    const pool = new pg.Pool({ connectionString });

    console.log("Adding missing column phone_verified to users...");
    try {
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified" text DEFAULT 'false';`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_requests_used" integer DEFAULT 0;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_requests_limit" integer DEFAULT 50;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_requests_reset_at" timestamp;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_count" integer DEFAULT 0;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_status" text;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_plan" text;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_period_end" timestamp;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_token_limit" integer;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_tokens_used" integer;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokens_reset_at" timestamp;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default';`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "network_access_enabled" boolean DEFAULT false;`);
        await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;`);
        console.log("Successfully injected auth fields.");
    } catch (e: any) {
        console.error("Column might already exist or table is missing: ", e.message);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
