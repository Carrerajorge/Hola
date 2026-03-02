import { Dt as theme, v as defaultRuntime } from "./entry.js";
import "./auth-profiles-Do5usXx5.js";
import "./agent-scope-BUKPOSoo.js";
import "./exec-G9-WTRVN.js";
import "./github-copilot-token-RNgXBxZS.js";
import "./host-env-security-DyQuUnEd.js";
import "./frontmatter-17nP3KZr.js";
import "./skills-BY60SMEv.js";
import "./manifest-registry-BPlNBgie.js";
import "./config-Bkwnzpys.js";
import "./env-vars-iFkEK4MO.js";
import "./dock-CIOFikxK.js";
import "./message-channel-CIQTys4Q.js";
import "./sessions-ECFvKx1f.js";
import "./plugins-DiQVUE1V.js";
import "./accounts-PH1dKbVZ.js";
import "./accounts-BTB26Iiz.js";
import "./accounts-B2H0iPgD.js";
import "./bindings-DieZWR44.js";
import "./logging-CFvkxgcX.js";
import "./paths-Dvmk_rXi.js";
import "./chat-envelope-BG_U_muK.js";
import "./client-BYCxouRm.js";
import "./call-BMTeFRaA.js";
import "./pairing-token-qLzAsGdq.js";
import "./net-BEAjYacy.js";
import "./ip-m9Sjsn1o.js";
import "./tailnet-BOWO-AaH.js";
import "./image-ops-CdtmwUCR.js";
import "./pi-embedded-helpers-CuapwR3w.js";
import "./sandbox-CphQTZ8D.js";
import "./tool-catalog-CgUG8wjb.js";
import "./chrome-CHcnoCue.js";
import "./tailscale-B21pc9dr.js";
import "./auth-Dw00sIWu.js";
import "./server-context-BpiGFhJz.js";
import "./redact-CjuqjXFe.js";
import "./errors-DjnYuRJy.js";
import "./fs-safe-CRRUKIv2.js";
import "./trash-z9Vvqm2l.js";
import "./ssrf-BZES7RNw.js";
import "./store-B12_ELOe.js";
import "./ports-Do_TimBK.js";
import "./server-middleware-C9d3rgNn.js";
import "./tool-images-SVHV_pjn.js";
import "./thinking-DW6CKWyf.js";
import "./commands-DoesZR2k.js";
import "./commands-registry-BH0UPGo4.js";
import "./tool-display-DVVqZPLw.js";
import { t as parseTimeoutMs } from "./parse-timeout-cOhkPW_X.js";
import { t as formatDocsLink } from "./links-XNJ1dvk5.js";
import { t as runTui } from "./tui-D_GjpK3J.js";

//#region src/cli/tui-cli.ts
function registerTuiCli(program) {
	program.command("tui").description("Open a terminal UI connected to the Gateway").option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)").option("--token <token>", "Gateway token (if required)").option("--password <password>", "Gateway password (if required)").option("--session <key>", "Session key (default: \"main\", or \"global\" when scope is global)").option("--deliver", "Deliver assistant replies", false).option("--thinking <level>", "Thinking level override").option("--message <text>", "Send an initial message after connecting").option("--timeout-ms <ms>", "Agent timeout in ms (defaults to agents.defaults.timeoutSeconds)").option("--history-limit <n>", "History entries to load", "200").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/tui", "docs.openclaw.ai/cli/tui")}\n`).action(async (opts) => {
		try {
			const timeoutMs = parseTimeoutMs(opts.timeoutMs);
			if (opts.timeoutMs !== void 0 && timeoutMs === void 0) defaultRuntime.error(`warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`);
			const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
			await runTui({
				url: opts.url,
				token: opts.token,
				password: opts.password,
				session: opts.session,
				deliver: Boolean(opts.deliver),
				thinking: opts.thinking,
				message: opts.message,
				timeoutMs,
				historyLimit: Number.isNaN(historyLimit) ? void 0 : historyLimit
			});
		} catch (err) {
			defaultRuntime.error(String(err));
			defaultRuntime.exit(1);
		}
	});
}

//#endregion
export { registerTuiCli };