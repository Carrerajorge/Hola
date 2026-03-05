import { toolRegistry } from "../server/agent/toolRegistry";
import { contextManager } from "../server/agent/context";
import { selfExpandCapability } from "../server/agent/selfExpand/selfExpandService";

const runId = `self_expand_${Date.now()}`;
const userId = "local_user";
const chatId = "local_chat";

const context = contextManager.getOrCreate({ runId, userId, chatId });

async function main() {
  const capability = "escape_string_regexp";
  const toolName = capability;
  const args = { text: "hello.*(world)? + test" };

  console.log(`[SelfExpandTest] RunId=${runId} tool=${toolName}`);
  console.log("[SelfExpandTest] Step 1: execute missing tool to detect gap");
  const missingResult = await toolRegistry.execute(toolName, args, {
    userId,
    chatId,
    runId,
    sharedContext: context,
  });
  console.log("[SelfExpandTest] Missing result:", missingResult.error?.code || missingResult.success);

  if (missingResult.success || missingResult.error?.code !== "TOOL_NOT_FOUND") {
    console.log("[SelfExpandTest] Tool already available or unexpected error.");
  } else {
    console.log("[SelfExpandTest] Step 2: self_expand capability from catalog");
    const expand = await selfExpandCapability(
      {
        capability,
        description: "Escape strings for safe RegExp usage.",
        allowNetwork: process.env.SELF_EXPAND_ALLOW_NETWORK === "true",
      },
      { userId, chatId, runId, sharedContext: context },
    );
    console.log("[SelfExpandTest] Self-expand status:", expand.status);
    console.log("[SelfExpandTest] Selected candidate:", expand.selectedCandidate?.name || "none");

    console.log("[SelfExpandTest] Step 3: execute fused tool");
    const fusedResult = await toolRegistry.execute(toolName, args, {
      userId,
      chatId,
      runId,
      sharedContext: context,
    });
    console.log("[SelfExpandTest] Fused result:", fusedResult.success ? fusedResult.output : fusedResult.error);
  }

  const snapshot = contextManager.snapshot(runId);
  console.log("[SelfExpandTest] Context capability state:", snapshot?.capabilityState?.[toolName] || "none");
}

main().catch((err) => {
  console.error("[SelfExpandTest] Failed:", err);
  process.exit(1);
});
