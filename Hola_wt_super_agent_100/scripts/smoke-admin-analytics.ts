/**
 * Smoke test for Admin Analytics endpoints.
 *
 * Usage (server must be running):
 *   BASE_URL=http://localhost:5000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/smoke-admin-analytics.ts
 */

type Json = any;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getSetCookie(headers: Headers): string[] {
  // Node/undici supports getSetCookie(); browsers don't.
  const anyHeaders = headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const sc = headers.get("set-cookie");
  return sc ? [sc] : [];
}

function cookieHeaderFromSetCookie(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function fetchJson(url: string, init: RequestInit & { cookie?: string } = {}): Promise<{ status: number; json: Json }> {
  const headers = new Headers(init.headers || {});
  if (init.cookie) headers.set("cookie", init.cookie);
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
  return { status: res.status, json };
}

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const baseUrl = (process.env.BASE_URL || "http://localhost:5000").replace(/\\/$/, "");
  const email = requireEnv("ADMIN_EMAIL");
  const password = requireEnv("ADMIN_PASSWORD");

  // 1) Login as admin and capture session cookies.
  const loginRes = await fetch(`${baseUrl}/api/auth/admin-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = getSetCookie(loginRes.headers);
  const cookie = cookieHeaderFromSetCookie(setCookies);
  assert(loginRes.ok, `Admin login failed: status=${loginRes.status}`);
  assert(cookie.length > 0, "Admin login did not return any Set-Cookie headers");

  // 2) Hit analytics endpoints and validate response shapes.
  const endpoints: Array<{ name: string; path: string; validate: (j: Json) => void }> = [
    {
      name: "kpi",
      path: "/api/admin/analytics/kpi",
      validate: (j) => {
        assert(typeof j.activeUsers === "number", "kpi.activeUsers missing/invalid");
        assert(typeof j.queriesPerMinute === "number", "kpi.queriesPerMinute missing/invalid");
        assert(typeof j.tokensConsumed === "number", "kpi.tokensConsumed missing/invalid");
        assert(typeof j.revenueToday === "number", "kpi.revenueToday missing/invalid");
        assert(typeof j.avgLatency === "number", "kpi.avgLatency missing/invalid");
        assert(typeof j.errorRate === "number", "kpi.errorRate missing/invalid");
      },
    },
    {
      name: "charts",
      path: "/api/admin/analytics/charts?granularity=24h",
      validate: (j) => {
        assert(Array.isArray(j.userGrowth), "charts.userGrowth missing/invalid");
        assert(Array.isArray(j.revenueTrend), "charts.revenueTrend missing/invalid");
        assert(Array.isArray(j.modelUsage), "charts.modelUsage missing/invalid");
        assert(Array.isArray(j.latencyByProvider), "charts.latencyByProvider missing/invalid");
        assert(Array.isArray(j.errorRate), "charts.errorRate missing/invalid");
        assert(Array.isArray(j.tokenConsumption), "charts.tokenConsumption missing/invalid");
      },
    },
    {
      name: "performance",
      path: "/api/admin/analytics/performance",
      validate: (j) => assert(Array.isArray(j), "performance response should be an array"),
    },
    {
      name: "costs",
      path: "/api/admin/analytics/costs",
      validate: (j) => assert(Array.isArray(j), "costs response should be an array"),
    },
    {
      name: "logs",
      path: "/api/admin/analytics/logs?page=1&limit=5",
      validate: (j) => {
        assert(Array.isArray(j.logs), "logs.logs missing/invalid");
        assert(typeof j.totalPages === "number", "logs.totalPages missing/invalid");
        assert(typeof j.page === "number", "logs.page missing/invalid");
        assert(typeof j.limit === "number", "logs.limit missing/invalid");
      },
    },
    {
      name: "heatmap",
      path: "/api/admin/analytics/heatmap",
      validate: (j) => {
        assert(Array.isArray(j.data) || Array.isArray(j.heatmap), "heatmap.data missing/invalid");
      },
    },
  ];

  for (const e of endpoints) {
    const { status, json } = await fetchJson(`${baseUrl}${e.path}`, { method: "GET", cookie });
    assert(status >= 200 && status < 300, `GET ${e.path} failed: status=${status}`);
    e.validate(json);
    console.log(`[OK] ${e.name}`);
  }

  console.log("Admin Analytics smoke test passed.");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});

