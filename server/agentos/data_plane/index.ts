import { BasePlane } from "../base_plane";
import { EventStore } from "./event_store";
import { AgentOSEvent } from "./schemas";

export class DataPlane extends BasePlane {
  public store: EventStore;

  constructor(os: any) {
    super(os);
    this.store = new EventStore();
  }

  async initialize() {
    console.log("[DataPlane] Connecting Event Sourcing Backbone...");
    // Verify DB connection or event stream health
  }

  async record(event: AgentOSEvent) {
    await this.store.append(event);
  }
}
