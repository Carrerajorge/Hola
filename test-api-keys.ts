import { config } from "dotenv";
config();
import { getIntegrationSnapshot, isModelEligibleForPublic } from "./server/services/modelIntegration";

console.log("Integration Snapshot:");
console.dir(getIntegrationSnapshot(), { depth: null });

const testModel = {
    provider: "google",
    modelId: "gemini-1.5-flash",
    modelType: "chat",
    status: "active",
    isEnabled: "true"
};

console.log("\nIs model eligible? ", isModelEligibleForPublic(testModel));
