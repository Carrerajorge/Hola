import { BasePlane } from "../base_plane";
import { ModelRouter } from "./router";

export class ModelPlane extends BasePlane {
  public router: ModelRouter;

  constructor(os: any) {
    super(os);
    this.router = new ModelRouter();
  }

  async initialize() {
    console.log("[ModelPlane] Warming up Router & Cost Manager...");
    // Load supported models from config
  }
}
