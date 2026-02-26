import "./paths-B4BZAPZh.js";
import { B as theme, S as shortenHomePath } from "./utils-DCtXtPui.js";
import { h as DEFAULT_AGENT_WORKSPACE_DIR, w as ensureAgentWorkspace } from "./agent-scope-CetJgM-R.js";
import { f as defaultRuntime } from "./subsystem-DkqfG4LL.js";
import "./exec-BvIdloyw.js";
import "./model-selection-BGu7OGe6.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-BxJiM21b.js";
import "./host-env-security-ljCLeQmh.js";
import "./message-channel-D8ATLuBC.js";
import { l as writeConfigFile, r as createConfigIO } from "./config-Cix160T5.js";
import "./env-vars-CvvqezS9.js";
import "./manifest-registry-UIPJjw6g.js";
import "./dock-D5PDfAsH.js";
import "./ip-D0zgNmBV.js";
import "./tailnet-CEudzG0i.js";
import "./ws-BTdBA7Dw.js";
import "./redact-BfiIp21N.js";
import "./errors-ClPOHMgX.js";
import "./sessions-B9yXoHO1.js";
import "./plugins-D4Ns2yTE.js";
import "./accounts-DFYKAwz0.js";
import "./accounts-Bw3VhFrr.js";
import "./accounts-Bs5Igj-6.js";
import "./bindings-CfY5TcJm.js";
import "./logging-B-Pt-Wis.js";
import { s as resolveSessionTranscriptsDir } from "./paths-DI5fQaUg.js";
import "./chat-envelope-CurikSJo.js";
import "./client-DLeBHbKS.js";
import "./call-CkzT-T4d.js";
import "./pairing-token-CQhr9eIv.js";
import { t as formatDocsLink } from "./links-DLmGbegT.js";
import { n as runCommandWithRuntime } from "./cli-utils-Ca0KE-dW.js";
import "./progress-ICIHPEsE.js";
import "./onboard-helpers-WQ9I7CYo.js";
import "./prompt-style-y4tpYJ-5.js";
import "./runtime-guard-DKdqEY_Y.js";
import { t as hasExplicitOptions } from "./command-options-SlegyIOk.js";
import "./note-Dw6fFJmx.js";
import "./clack-prompter-CVtAwtc6.js";
import "./onboarding-MDcRMQE0.js";
import { n as logConfigUpdated, t as formatConfigPath } from "./logging-mGzP9ZHZ.js";
import { t as onboardCommand } from "./onboard-UvRZfblp.js";
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