import { BasePlane } from "../base_plane";

export class VoicePlane extends BasePlane {
  async initialize() {
    console.log("[VoicePlane] Initializing TTS/STT services...");
  }
}
