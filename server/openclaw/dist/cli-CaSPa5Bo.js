import { s as createSubsystemLogger } from "./entry.js";
import "./auth-profiles-Do5usXx5.js";
import { l as resolveAgentWorkspaceDir, u as resolveDefaultAgentId } from "./agent-scope-BUKPOSoo.js";
import "./exec-G9-WTRVN.js";
import "./github-copilot-token-RNgXBxZS.js";
import "./host-env-security-DyQuUnEd.js";
import "./model-DwWVwtsY.js";
import "./pi-model-discovery-CwESh4K1.js";
import "./frontmatter-17nP3KZr.js";
import "./skills-BY60SMEv.js";
import "./manifest-registry-BPlNBgie.js";
import { i as loadConfig } from "./config-Bkwnzpys.js";
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
import "./send-DkCCE1dy.js";
import "./send-CTwQ_dUk.js";
import { _ as loadOpenClawPlugins } from "./subagent-registry--qOHOvSD.js";
import "./paths-Dvmk_rXi.js";
import "./chat-envelope-BG_U_muK.js";
import "./client-BYCxouRm.js";
import "./call-BMTeFRaA.js";
import "./pairing-token-qLzAsGdq.js";
import "./net-BEAjYacy.js";
import "./ip-m9Sjsn1o.js";
import "./tailnet-BOWO-AaH.js";
import "./tokens-D60Twogq.js";
import "./with-timeout-CNcGRgMH.js";
import "./deliver-t508rlg0.js";
import "./diagnostic-J4rp2SRl.js";
import "./diagnostic-session-state-CT36_PCE.js";
import "./send-BHdBDBgV.js";
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
import "./models-config-Br-Jfk1e.js";
import "./exec-approvals-allowlist-CLwKD5NE.js";
import "./exec-safe-bin-runtime-policy-CIfIFAlq.js";
import "./reply-prefix-XSn4asPp.js";
import "./memory-cli-C_Ihzx4u.js";
import "./manager-ClH4Sdfs.js";
import "./gemini-auth-8rJrmPae.js";
import "./fetch-guard-Cu0jqikd.js";
import "./query-expansion-BI-SeFWF.js";
import "./retry-BpId8ooT.js";
import "./target-errors-DzFj0Ep8.js";
import "./chunk-DWC5_lg1.js";
import "./markdown-tables-B2x7OXFP.js";
import "./local-roots-DqSthK0T.js";
import "./ir-p1-obEhx.js";
import "./render-C1H8wE-4.js";
import "./commands-DoesZR2k.js";
import "./commands-registry-BH0UPGo4.js";
import "./image-oQ_7PD7w.js";
import "./tool-display-DVVqZPLw.js";
import "./runner-D2Q8tYn3.js";
import "./model-catalog-DeOJC3gy.js";
import "./session-utils-BYbH8Fsl.js";
import "./skill-commands-CWF3BV_E.js";
import "./workspace-dirs-CwBsWZoU.js";
import "./pairing-store-08-PAzXR.js";
import "./fetch-G_zevKM2.js";
import "./exec-approvals-eoetsTzS.js";
import "./nodes-screen-BFD50GSA.js";
import "./session-cost-usage-mpxdYjpK.js";
import "./channel-activity-elbmR4Fp.js";
import "./tables-BrLEcObE.js";
import "./server-lifecycle-B_2YRqeR.js";
import "./stagger-BJGKxryR.js";
import "./channel-selection-GAWZorkV.js";
import "./send-Cwc4yNLY.js";
import "./outbound-attachment-BGdwDS2g.js";
import "./delivery-queue-B3d6yaGl.js";
import "./send-NBkC-8TF.js";
import "./resolve-route-D77B5BAy.js";
import "./proxy-7hfM-QNi.js";
import "./links-XNJ1dvk5.js";
import "./cli-utils-fSG_7xFh.js";
import "./help-format-BucQ45AN.js";
import "./progress-uJ7y1rnQ.js";
import "./replies-Cpu7oY9H.js";
import "./onboard-helpers-BOg7ooqj.js";
import "./prompt-style-GlggG8xB.js";
import "./pairing-labels-6V2NMRi3.js";
import "./pi-tools.policy-CIY5LSeb.js";

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