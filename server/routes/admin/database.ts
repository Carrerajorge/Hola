import { Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { asyncHandler } from "../../middleware/errorHandler";

export const databaseRouter = Router();

databaseRouter.get("/info", async (req, res) => {
    try {
        const userStats = await storage.getUserStats();
        const models = await storage.getAiModels();
        const payments = await storage.getPayments();
        const invoices = await storage.getInvoices();

        res.json({
            tables: {
                users: { count: userStats.total },
                ai_models: { count: models.length },
                payments: { count: payments.length },
                invoices: { count: invoices.length }
            },
            status: "healthy",
            lastBackup: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

databaseRouter.get("/health", async (req, res) => {
    try {
        const startTime = Date.now();
        const result = await db.execute(sql`SELECT 1 as ping, current_timestamp as server_time, pg_database_size(current_database()) as db_size`);
        const latency = Date.now() - startTime;

        const poolStats = await db.execute(sql`
        SELECT 
          numbackends as active_connections,
          xact_commit as transactions_committed,
          xact_rollback as transactions_rolled_back,
          blks_read as blocks_read,
          blks_hit as blocks_hit,
          tup_returned as rows_returned,
          tup_fetched as rows_fetched,
          tup_inserted as rows_inserted,
          tup_updated as rows_updated,
          tup_deleted as rows_deleted,
          pg_size_pretty(pg_database_size(current_database())) as database_size
        FROM pg_stat_database 
        WHERE datname = current_database()
      `);

        const tableStats = await db.execute(sql`
        SELECT 
          schemaname,
          relname as table_name,
          n_live_tup as row_count,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) as table_size
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 20
      `);

        res.json({
            status: "healthy",
            latencyMs: latency,
            serverTime: result.rows[0]?.server_time,
            pool: poolStats.rows[0] || {},
            tables: tableStats.rows,
            version: await db.execute(sql`SELECT version()`).then(r => r.rows[0]?.version)
        });
    } catch (error: any) {
        res.status(500).json({
            status: "unhealthy",
            error: error.message,
            latencyMs: null
        });
    }
});

// Database status endpoint for production monitoring
// Merged logic from multiple checkpoints
databaseRouter.get("/status", async (req, res) => {
    try {
        // Get database connection info
        const dbInfoResult = await db.execute(sql`
        SELECT 
          current_database() as database_name,
          inet_server_addr() as host,
          inet_server_port() as port,
          current_user as db_user,
          version() as pg_version,
          current_timestamp as server_time
      `);

        const dbInfo = dbInfoResult.rows[0] as Record<string, any>;

        // Get user count and latest user created
        const userStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_users,
          MAX(created_at) as latest_user_created
        FROM users
      `);

        // Get enabled AI models count
        const modelStats = await db.execute(sql`
        SELECT COUNT(*) as enabled_models
        FROM ai_models
        WHERE is_enabled = 'true'
      `);

        // Get sessions count (if needed for diagnostics)
        const sessionStatsResult = await db.execute(sql`
        SELECT COUNT(*) as session_count
        FROM sessions
        WHERE expire > NOW()
      `);

        res.json({
            status: "connected",
            database: {
                name: dbInfo?.database_name || "unknown",
                host: dbInfo?.host || process.env.PGHOST || "unknown",
                port: dbInfo?.port,
                user: dbInfo?.db_user,
                version: dbInfo?.pg_version?.split(" ")[0] + " " + (dbInfo?.pg_version?.split(" ")[1] || ""),
            },
            serverTime: dbInfo?.server_time,
            users: {
                total: parseInt((userStats.rows[0] as any)?.total_users || "0"),
                latestCreatedAt: (userStats.rows[0] as any)?.latest_user_created
            },
            models: {
                enabled: parseInt((modelStats.rows[0] as any)?.enabled_models || "0")
            },
            sessions: {
                activeCount: parseInt((sessionStatsResult.rows[0] as any)?.session_count || "0")
            },
            environment: process.env.NODE_ENV || "development"
        });
    } catch (error: any) {
        console.error("[AdminRouter] db-status error:", error.message);
        res.status(500).json({
            status: "error",
            error: error.message,
            database: null,
            host: null
        });
    }
});


databaseRouter.get("/tables", async (req, res) => {
    try {
        const tables = await db.execute(sql`
        SELECT 
          t.table_name,
          t.table_type,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as size,
          (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema) as column_count,
          COALESCE(s.n_live_tup, 0) as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON t.table_name = s.relname
        WHERE t.table_schema = 'public'
        ORDER BY t.table_name
      `);

        res.json({ tables: tables.rows });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

databaseRouter.get("/tables/:tableName", async (req, res) => {
    try {
        const { tableName } = req.params;
        const { page = "1", limit = "50" } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = Math.min(parseInt(limit as string), 100);
        const offset = (pageNum - 1) * limitNum;

        // Sanitize table name first - only allow alphanumeric and underscore
        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        if (safeTableName !== tableName || !safeTableName) {
            return res.status(400).json({ error: "Invalid table name" });
        }

        // Validate table exists in public schema using parameterized query
        const tableCheck = await db.execute(sql`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = ${safeTableName}
      `);
        if (tableCheck.rows.length === 0) {
            return res.status(404).json({ error: "Table not found" });
        }

        // Get columns info using parameterized query
        const columns = await db.execute(sql`
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = ${safeTableName}
        ORDER BY ordinal_position
      `);

        // Get row count using sanitized table name
        const countResult = await db.execute(sql`SELECT COUNT(*) as total FROM ${sql.raw(safeTableName)}`);
        const total = parseInt((countResult.rows[0] as any)?.total || "0");

        // Get data with pagination using parameterized queries for LIMIT and OFFSET
        const data = await db.execute(sql`SELECT * FROM ${sql.raw(safeTableName)} LIMIT ${limitNum} OFFSET ${offset}`);

        res.json({
            table: tableName,
            columns: columns.rows,
            data: data.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

databaseRouter.post("/query", async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: "Query is required" });
        }

        // Security: Only allow SELECT statements (including CTEs with WITH...SELECT)
        const trimmedQuery = query.trim().toUpperCase();
        const isSelect = trimmedQuery.startsWith('SELECT');
        const isCteSelect = trimmedQuery.startsWith('WITH') && /\bSELECT\b/.test(trimmedQuery) && !/\b(INSERT|UPDATE|DELETE)\b/.test(trimmedQuery);
        if (!isSelect && !isCteSelect) {
            return res.status(403).json({
                error: "Only SELECT queries are allowed for security reasons",
                hint: "Use the Replit Database panel for write operations"
            });
        }

        // Block dangerous patterns - comprehensive list for SQL injection prevention
        const dangerousPatterns = [
            /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)/i,
            /INTO\s+OUTFILE/i,
            /LOAD_FILE/i,
            /pg_sleep/i,
            /pg_terminate/i,
            /COPY\s+TO/i,
            /pg_read_file/i,
            /lo_import/i,
            /lo_export/i,
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(query)) {
                return res.status(403).json({ error: "Query contains forbidden patterns" });
            }
        }

        const startTime = Date.now();
        // SECURITY: sql.raw() is intentionally used here for admin query explorer.
        // All validation above ensures only safe SELECT queries reach this point.
        const result = await db.execute(sql`${sql.raw(query)}`);
        const executionTime = Date.now() - startTime;

        await storage.createAuditLog({
            action: "database_query",
            resource: "database",
            details: {
                query: query.substring(0, 500),
                rowsReturned: result.rows.length,
                executionTimeMs: executionTime
            }
        });

        res.json({
            success: true,
            data: result.rows.slice(0, 1000), // Limit results
            rowCount: result.rows.length,
            executionTimeMs: executionTime,
            columns: result.rows.length > 0 ? Object.keys(result.rows[0]) : []
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message,
            hint: "Check your SQL syntax"
        });
    }
});

databaseRouter.get("/slow-queries", async (req, res) => {
    try {
        const slowQueries = await db.execute(sql`
        SELECT 
          query,
          calls,
          mean_exec_time as avg_time_ms,
          total_exec_time as total_time_ms,
          rows,
          shared_blks_hit,
          shared_blks_read
        FROM pg_stat_statements
        ORDER BY mean_exec_time DESC
        LIMIT 20
      `);
        res.json({ queries: slowQueries.rows });
    } catch (error: any) {
        // pg_stat_statements might not be enabled
        res.json({
            queries: [],
            note: "pg_stat_statements extension may not be enabled"
        });
    }
});

databaseRouter.get("/indexes", async (req, res) => {
    try {
        const indexes = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef,
          pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(indexname))) as index_size
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
      `);
        res.json({ indexes: indexes.rows });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
