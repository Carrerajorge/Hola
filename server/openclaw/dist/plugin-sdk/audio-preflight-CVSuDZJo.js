import "./accounts-BKKD4hJZ.js";
import "./paths-DVWx7USN.js";
import "./github-copilot-token-Cg0YPPSu.js";
import "./plugins-BcZyqZ2i.js";
import { Z as logVerbose, et as shouldLogVerbose } from "./subsystem-DDlKm7JR.js";
import "./config-0er5lK-Y.js";
import "./command-format-CSkgHwwD.js";
import "./model-selection-CfBXvztJ.js";
import "./agent-scope-S0PcYLol.js";
import "./manifest-registry-J3QGS9aQ.js";
import "./dock-xRpcIf4o.js";
import "./redact-CuKhE6Uz.js";
import "./errors-CYhifFbz.js";
import "./image-ops-DukJmgIX.js";
import "./ssrf-DPlHrEn9.js";
import "./fetch-guard-C8dbOA2p.js";
import "./local-roots-3Xef4JBF.js";
import "./message-channel-CkSgoFcf.js";
import "./bindings-CYy12UhO.js";
import "./tool-images-DTG_6Hc_.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, t as buildProviderRegistry, u as isAudioAttachment } from "./runner-CgiBc1IJ.js";
import "./skills-5iUBhaef.js";
import "./chrome-CANCfwVi.js";
import "./accounts-2gm1zJtg.js";
import "./accounts-sa6LdGmg.js";
import "./sessions-CUeRK6_V.js";
import "./paths-B-NY-HdV.js";
import "./store-CC2fFkbE.js";
import "./pi-embedded-helpers-CCie0w1M.js";
import "./thinking-BpFZfHN9.js";
import "./image-Cq1KSeA8.js";
import "./pi-model-discovery-CNP1dAqt.js";
import "./api-key-rotation-BsGZZy-M.js";

//#region src/media-understanding/audio-preflight.ts
/**
* Transcribes the first audio attachment BEFORE mention checking.
* This allows voice notes to be processed in group chats with requireMention: true.
* Returns the transcript or undefined if transcription fails or no audio is found.
*/
async function transcribeFirstAudio(params) {
	const { ctx, cfg } = params;
	const audioConfig = cfg.tools?.media?.audio;
	if (!audioConfig || audioConfig.enabled === false) return;
	const attachments = normalizeMediaAttachments(ctx);
	if (!attachments || attachments.length === 0) return;
	const firstAudio = attachments.find((att) => att && isAudioAttachment(att) && !att.alreadyTranscribed);
	if (!firstAudio) return;
	if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribing attachment ${firstAudio.index} for mention check`);
	const providerRegistry = buildProviderRegistry(params.providers);
	const cache = createMediaAttachmentCache(attachments, { localPathRoots: resolveMediaAttachmentLocalRoots({
		cfg,
		ctx
	}) });
	try {
		const result = await runCapability({
			capability: "audio",
			cfg,
			ctx,
			attachments: cache,
			media: attachments,
			agentDir: params.agentDir,
			providerRegistry,
			config: audioConfig,
			activeModel: params.activeModel
		});
		if (!result || result.outputs.length === 0) return;
		const audioOutput = result.outputs.find((output) => output.kind === "audio.transcription");
		if (!audioOutput || !audioOutput.text) return;
		firstAudio.alreadyTranscribed = true;
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribed ${audioOutput.text.length} chars from attachment ${firstAudio.index}`);
		return audioOutput.text;
	} catch (err) {
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcription failed: ${String(err)}`);
		return;
	} finally {
		await cache.cleanup();
	}
}

//#endregion
export { transcribeFirstAudio };