import { Dt as theme, lt as shortenHomePath, v as defaultRuntime } from "./entry.js";
import "./auth-profiles-Do5usXx5.js";
import { h as DEFAULT_AGENT_WORKSPACE_DIR, w as ensureAgentWorkspace } from "./agent-scope-BUKPOSoo.js";
import "./exec-G9-WTRVN.js";
import "./github-copilot-token-RNgXBxZS.js";
import "./host-env-security-DyQuUnEd.js";
import "./manifest-registry-BPlNBgie.js";
import { l as writeConfigFile, r as createConfigIO } from "./config-Bkwnzpys.js";
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
import { s as resolveSessionTranscriptsDir } from "./paths-Dvmk_rXi.js";
import "./chat-envelope-BG_U_muK.js";
import "./client-BYCxouRm.js";
import "./call-BMTeFRaA.js";
import "./pairing-token-qLzAsGdq.js";
import "./net-BEAjYacy.js";
import "./ip-m9Sjsn1o.js";
import "./tailnet-BOWO-AaH.js";
import "./redact-CjuqjXFe.js";
import "./errors-DjnYuRJy.js";
import { t as formatDocsLink } from "./links-XNJ1dvk5.js";
import { n as runCommandWithRuntime } from "./cli-utils-fSG_7xFh.js";
import "./progress-uJ7y1rnQ.js";
import "./onboard-helpers-BOg7ooqj.js";
import "./prompt-style-GlggG8xB.js";
import { t as hasExplicitOptions } from "./command-options-f3s5QES5.js";
import "./note-Cu03Pnds.js";
import "./clack-prompter-BG34y93f.js";
import "./runtime-guard-B-3UHLnL.js";
import "./onboarding-Cqv7HYLx.js";
import { n as logConfigUpdated, t as formatConfigPath } from "./logging-BwnxXHZs.js";
import { t as onboardCommand } from "./onboard-7Ne5irdl.js";
import JSON5 from "json5";
import fs from "node:fs/promises";

//#region src/commands/setup.ts
async function readConfigFileRaw(configPath) {
	try {
		const raw = await fs.readFile(configPath, "utf-8");
		const parsed = JSON5.parse(raw);
		if (parsed && typeof parsed === "object") return {
			exists: true,
			parsed
		};
		return {
			exists: true,
			parsed: {}
		};
	} catch {
		return {
			exists: false,
			parsed: {}
		};
	}
}
async function setupCommand(opts, runtime = defaultRuntime) {
	const desiredWorkspace = typeof opts?.workspace === "string" && opts.workspace.trim() ? opts.workspace.trim() : void 0;
	const configPath = createConfigIO().configPath;
	const existingRaw = await readConfigFileRaw(configPath);
	const cfg = existingRaw.parsed;
	const defaults = cfg.agents?.defaults ?? {};
	const workspace = desiredWorkspace ?? defaults.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
	const next = {
		...cfg,
		agents: {
			...cfg.agents,
			defaults: {
				...defaults,
				workspace
			}
		}
	};
	if (!existingRaw.exists || defaults.workspace !== workspace) {
		await writeConfigFile(next);
		if (!existingRaw.exists) runtime.log(`Wrote ${formatConfigPath(configPath)}`);
		else logConfigUpdated(runtime, {
			path: configPath,
			suffix: "(set agents.defaults.workspace)"
		});
	} else runtime.log(`Config OK: ${formatConfigPath(configPath)}`);
	const ws = await ensureAgentWorkspace({
		dir: workspace,
		ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap
	});
	runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);
	const sessionsDir = resolveSessionTranscriptsDir();
	await fs.mkdir(sessionsDir, { recursive: true });
	runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}

//#endregion
//#region src/cli/program/register.setup.ts
function registerSetupCommand(program) {
	program.command("setup").description("Initialize ~/.openclaw/openclaw.json and the agent workspace").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/setup", "docs.openclaw.ai/cli/setup")}\n`).option("--workspace <dir>", "Agent workspace directory (default: ~/.openclaw/workspace; stored as agents.defaults.workspace)").option("--wizard", "Run the interactive onboarding wizard", false).option("--non-interactive", "Run the wizard without prompts", false).option("--mode <mode>", "Wizard mode: local|remote").option("--remote-url <url>", "Remote Gateway WebSocket URL").option("--remote-token <token>", "Remote Gateway token (optional)").action(async (opts, command) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			const hasWizardFlags = hasExplicitOptions(command, [
				"wizard",
				"nonInteractive",
				"mode",
				"remoteUrl",
				"remoteToken"
			]);
			if (opts.wizard || hasWizardFlags) {
				await onboardCommand({
					workspace: opts.workspace,
					nonInteractive: Boolean(opts.nonInteractive),
					mode: opts.mode,
					remoteUrl: opts.remoteUrl,
					remoteToken: opts.remoteToken
				}, defaultRuntime);
				return;
			}
			await setupCommand({ workspace: opts.workspace }, defaultRuntime);
		});
	});
}

//#endregion
export { registerSetupCommand };