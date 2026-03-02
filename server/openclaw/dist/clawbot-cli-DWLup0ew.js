import "./paths-B4BZAPZh.js";
import { B as theme } from "./utils-DCtXtPui.js";
import "./agent-scope-CetJgM-R.js";
import "./subsystem-DkqfG4LL.js";
import "./exec-BvIdloyw.js";
import "./model-selection-BGu7OGe6.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-BxJiM21b.js";
import "./host-env-security-ljCLeQmh.js";
import "./config-Cix160T5.js";
import "./env-vars-CvvqezS9.js";
import "./manifest-registry-UIPJjw6g.js";
import "./ip-D0zgNmBV.js";
import { t as formatDocsLink } from "./links-DLmGbegT.js";
import { n as registerQrCli } from "./qr-cli-CWscZn_U.js";

//#region src/cli/clawbot-cli.ts
function registerClawbotCli(program) {
	registerQrCli(program.command("clawbot").description("Legacy clawbot command aliases").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/clawbot", "docs.openclaw.ai/cli/clawbot")}\n`));
}

//#endregion
export { registerClawbotCli };