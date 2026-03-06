
import { AgentOS } from "../index";

export class BasePlane {
  protected os: AgentOS;
  
  constructor(os: AgentOS) {
    this.os = os;
  }

  async initialize(): Promise<void> {
    // Override in subclasses
  }

  async shutdown(): Promise<void> {
    // Override in subclasses
  }
}
