import "./paths-B4BZAPZh.js";
import "./utils-DCtXtPui.js";
import "./agent-scope-CetJgM-R.js";
import { t as createSubsystemLogger } from "./subsystem-DkqfG4LL.js";
import "./exec-BvIdloyw.js";
import "./model-selection-BGu7OGe6.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-BxJiM21b.js";
import "./host-env-security-ljCLeQmh.js";
import { i as loadConfig } from "./config-Cix160T5.js";
import "./env-vars-CvvqezS9.js";
import "./manifest-registry-UIPJjw6g.js";
import "./chrome-CsmLRBaw.js";
import "./tailscale-Dm3fN1ZW.js";
import "./ip-D0zgNmBV.js";
import "./tailnet-CEudzG0i.js";
import "./ws-BTdBA7Dw.js";
import "./auth-ZSL4jmG7.js";
import { i as resolveBrowserConfig, o as ensureBrowserControlAuth, r as registerBrowserRoutes, s as resolveBrowserControlAuth, t as createBrowserRouteContext } from "./server-context-Dmvcq24T.js";
import "./redact-BfiIp21N.js";
import "./errors-ClPOHMgX.js";
import "./fs-safe-DmYE85G9.js";
import "./trash-CFAwvdBs.js";
import "./ssrf-XOYV4WGH.js";
import "./image-ops-DLkGOG0C.js";
import "./store-q4Ob_mrK.js";
import "./ports-DJup96n1.js";
import { n as installBrowserCommonMiddleware, t as installBrowserAuthMiddleware } from "./server-middleware-CQ0JmE7W.js";
import { n as stopKnownBrowserProfiles, t as ensureExtensionRelayForProfiles } from "./server-lifecycle-DQQu2exx.js";
import { t as isPwAiLoaded } from "./tool-loop-detection-B6wcwGyZ.js";
import express from "express";

//#region src/browser/server.ts
let state = null;
const logServer = createSubsystemLogger("browser").child("server");
async function startBrowserControlServerFromConfig() {
	if (state) return state;
	const cfg = loadConfig();
	const resolved = resolveBrowserConfig(cfg.browser, cfg);
	if (!resolved.enabled) return null;
	let browserAuth = resolveBrowserControlAuth(cfg);
	try {
		const ensured = await ensureBrowserControlAuth({ cfg });
		browserAuth = ensured.auth;
		if (ensured.generatedToken) logServer.info("No browser auth configured; generated gateway.auth.token automatically.");
	} catch (err) {
		logServer.warn(`failed to auto-configure browser auth: ${String(err)}`);
	}
	const app = express();
	installBrowserCommonMiddleware(app);
	installBrowserAuthMiddleware(app, browserAuth);
	registerBrowserRoutes(app, createBrowserRouteContext({
		getState: () => state,
		refreshConfigFromDisk: true
	}));
	const port = resolved.controlPort;
	const server = await new Promise((resolve, reject) => {
		const s = app.listen(port, "127.0.0.1", () => resolve(s));
		s.once("error", reject);
	}).catch((err) => {
		logServer.error(`openclaw browser server failed to bind 127.0.0.1:${port}: ${String(err)}`);
		return null;
	});
	if (!server) return null;
	state = {
		server,
		port,
		resolved,
		profiles: /* @__PURE__ */ new Map()
	};
	await ensureExtensionRelayForProfiles({
		resolved,
		onWarn: (message) => logServer.warn(message)
	});
	const authMode = browserAuth.token ? "token" : browserAuth.password ? "password" : "off";
	logServer.info(`Browser control listening on http://127.0.0.1:${port}/ (auth=${authMode})`);
	return state;
}
async function stopBrowserControlServer() {
	const current = state;
	if (!current) return;
	await stopKnownBrowserProfiles({
		getState: () => state,
		onWarn: (message) => logServer.warn(message)
	});
	if (current.server) await new Promise((resolve) => {
		current.server?.close(() => resolve());
	});
	state = null;
	if (isPwAiLoaded()) try {
		await (await import("./pw-ai-DEX5wkab.js")).closePlaywrightBrowserConnection();
	} catch {}
}

//#endregion
export { startBrowserControlServerFromConfig, stopBrowserControlServer };