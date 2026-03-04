import { BasePlane } from "../base_plane";
import { ModelRouter } from "./router";
import { llmGateway } from "../../lib/llmGateway";

export class ModelPlane extends BasePlane {
  public router: ModelRouter;

  constructor(os: any) {
    super(os);
    this.router = new ModelRouter();
  }

  async initialize() {
    console.log("[ModelPlane] Warming up Router & Cost Manager...");
    
    // Inject our governed router into the main gateway
    // This intercepts all traffic (chat, stream, background jobs)
    if (typeof llmGateway.setRouter === 'function') {
      llmGateway.setRouter(this.router);
      console.log("[ModelPlane] ✅ Intercepted LLMGateway traffic");
    } else {
      console.warn("[ModelPlane] ⚠️ LLMGateway does not support router injection yet");
    }
  }
}
