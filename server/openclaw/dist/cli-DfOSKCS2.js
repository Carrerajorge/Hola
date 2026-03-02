import "./paths-B4BZAPZh.js";
import "./utils-DCtXtPui.js";
import "./thinking-EAliFiVK.js";
import { vt as loadOpenClawPlugins } from "./reply-D-ejYZny.js";
import { l as resolveAgentWorkspaceDir, u as resolveDefaultAgentId } from "./agent-scope-CetJgM-R.js";
import { t as createSubsystemLogger } from "./subsystem-DkqfG4LL.js";
import "./exec-BvIdloyw.js";
import "./model-selection-BGu7OGe6.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-BxJiM21b.js";
import "./host-env-security-ljCLeQmh.js";
import "./message-channel-D8ATLuBC.js";
import "./send-BrArH7TL.js";
import { i as loadConfig } from "./config-Cix160T5.js";
import "./env-vars-CvvqezS9.js";
import "./manifest-registry-UIPJjw6g.js";
import "./dock-D5PDfAsH.js";
import "./runner-BWvU_k4C.js";
import "./image-BHMJslE2.js";
import "./models-config-BatVPulR.js";
import "./pi-model-discovery-Bakt-Qrp.js";
import "./pi-embedded-helpers-CBr7pp25.js";
import "./sandbox-C2dWVofh.js";
import "./tool-catalog-Df2IQWtF.js";
import "./chrome-CsmLRBaw.js";
import "./tailscale-Dm3fN1ZW.js";
import "./ip-D0zgNmBV.js";
import "./tailnet-CEudzG0i.js";
import "./ws-BTdBA7Dw.js";
import "./auth-ZSL4jmG7.js";
import "./server-context-Dmvcq24T.js";
import "./frontmatter-DR47FZL2.js";
import "./skills-zC8MIn-b.js";
import "./redact-BfiIp21N.js";
import "./errors-ClPOHMgX.js";
import "./fs-safe-DmYE85G9.js";
import "./trash-CFAwvdBs.js";
import "./ssrf-XOYV4WGH.js";
import "./image-ops-DLkGOG0C.js";
import "./store-q4Ob_mrK.js";
import "./ports-DJup96n1.js";
import "./server-middleware-CQ0JmE7W.js";
import "./sessions-B9yXoHO1.js";
import "./plugins-D4Ns2yTE.js";
import "./accounts-DFYKAwz0.js";
import "./accounts-Bw3VhFrr.js";
import "./accounts-Bs5Igj-6.js";
import "./bindings-CfY5TcJm.js";
import "./logging-B-Pt-Wis.js";
import "./send-to1qzJJa.js";
import "./paths-DI5fQaUg.js";
import "./chat-envelope-CurikSJo.js";
import "./tool-images-Dw_AqSiB.js";
import "./tool-display-BNnsnxQh.js";
import "./fetch-guard-Dh7-G6dE.js";
import "./api-key-rotation-C-Ymilxh.js";
import "./local-roots-DfZXlYAW.js";
import "./query-expansion-BLv24Ra3.js";
import "./model-catalog-0q2XBRrT.js";
import "./tokens-ClHH1F0w.js";
import "./with-timeout-DEZ-HGUx.js";
import "./deliver-K3v4weUV.js";
import "./diagnostic-BixZKFP-.js";
import "./diagnostic-session-state-Dw-KXCxN.js";
import "./send-CihQKNMw.js";
import "./model-BJ_FlRZw.js";
import "./exec-approvals-allowlist-C0Op7MQw.js";
import "./exec-safe-bin-runtime-policy-oxr3WBPn.js";
import "./reply-prefix-CSzC653S.js";
import "./memory-cli-Cwd4VrBr.js";
import "./manager-SEIDyiNv.js";
import "./retry-CZ0l8o0f.js";
import "./target-errors-B8VFqjnH.js";
import "./chunk-DLZjHO7W.js";
import "./markdown-tables-teIjybF6.js";
import "./ir-BeqX2GW9.js";
import "./render-CC7dS9Xb.js";
import "./commands-DpNf2wmR.js";
import "./commands-registry-BAdaU3pl.js";
import "./client-DLeBHbKS.js";
import "./call-CkzT-T4d.js";
import "./pairing-token-CQhr9eIv.js";
import "./channel-activity-AdlU2JvS.js";
import "./fetch-D4W31Tu1.js";
import "./tables-CDtQBeAL.js";
import "./send-4T-nsTvj.js";
import "./pairing-store-UpJPgxa1.js";
import "./proxy-CLRUdShp.js";
import "./links-DLmGbegT.js";
import "./cli-utils-Ca0KE-dW.js";
import "./help-format-BiGlS7JG.js";
import "./progress-ICIHPEsE.js";
import "./resolve-route-L5y-jIZP.js";
import "./replies-D-DEd1dE.js";
import "./skill-commands-SajRuDuc.js";
import "./workspace-dirs-BmlBC0wD.js";
import "./channel-selection-B2sYOPKv.js";
import "./outbound-attachment-BDcbjS4s.js";
import "./delivery-queue-BpNLh26f.js";
import "./session-cost-usage-B6kNUrh3.js";
import "./send-DDixrYWr.js";
import "./onboard-helpers-WQ9I7CYo.js";
import "./prompt-style-y4tpYJ-5.js";
import "./pairing-labels-BjZjJjuL.js";
import "./exec-approvals-Dabk4W5H.js";
import "./nodes-screen-lyeHywsr.js";
import "./server-lifecycle-DQQu2exx.js";
import "./stagger-C9cy2z6C.js";
import "./pi-tools.policy-CLSPVIV0.js";

//#region src/plugins/cli.ts
const log = createSubsystemLogger("plugins");
function registerPluginCliCommands(program, cfg) {
	const config = cfg ?? loadConfig();
	const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
	const logger = {
		info: (msg) => log.info(msg),
		warn: (msg) => log.warn(msg),
		error: (msg) => log.error(msg),
		debug: (msg) => log.debug(msg)
	};
	const registry = loadOpenClawPlugins({
		config,
		workspaceDir,
		logger
	});
	const existingCommands = new Set(program.commands.map((cmd) => cmd.name()));
	for (const entry of registry.cliRegistrars) {
		if (entry.commands.length > 0) {
			const overlaps = entry.commands.filter((command) => existingCommands.has(command));
			if (overlaps.length > 0) {
				log.debug(`plugin CLI register skipped (${entry.pluginId}): command already registered (${overlaps.join(", ")})`);
				continue;
			}
		}
		try {
			const result = entry.register({
				program,
				config,
				workspaceDir,
				logger
			});
			if (result && typeof result.then === "function") result.catch((err) => {
				log.warn(`plugin CLI register failed (${entry.pluginId}): ${String(err)}`);
			});
			for (const command of entry.commands) existingCommands.add(command);
		} catch (err) {
			log.warn(`plugin CLI register failed (${entry.pluginId}): ${String(err)}`);
		}
	}
}

//#endregion
export { registerPluginCliCommands };