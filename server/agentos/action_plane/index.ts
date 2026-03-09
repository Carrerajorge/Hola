import { BasePlane } from "../base_plane";

export class ActionPlane extends BasePlane {
  async initialize() {
    console.log("[ActionPlane] Launching Browser Control...");
  }
}
