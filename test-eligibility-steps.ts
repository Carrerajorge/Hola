import { config } from "dotenv";
config();
import {
  isModelProviderIntegrated,
  isChatModelCapable,
  isModelEligibleForPublic,
  normalizeModelProviderToRuntime,
  isChatModelType,
  isChatModelIdCompatible
} from "./server/services/modelIntegration";

const m = {
    provider: "google",
    modelId: "gemini-1.5-flash",
    modelType: "chat",
    status: "active",
    isEnabled: "true"
};

console.log("isEnabled == true?", m.isEnabled === "true");
console.log("status == active?", m.status === "active");
console.log("isModelProviderIntegrated?", isModelProviderIntegrated(m.provider));

const runtime = normalizeModelProviderToRuntime(m.provider);
console.log("runtime mapping:", runtime);
console.log("isChatModelType:", isChatModelType(m.modelType));
console.log("isChatModelIdCompatible:", isChatModelIdCompatible(runtime, m.modelId));

