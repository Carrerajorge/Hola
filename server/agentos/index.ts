import { createLogger } from "../lib/structuredLogger";
import { EventEmitter } from "events";

// Import Planes
import { ControlPlane } from "./control_plane";
import { DataPlane } from "./data_plane";
import { ModelPlane } from "./model_plane";
import { KnowledgePlane } from "./knowledge_plane";
import { ActionPlane } from "./action_plane";
import { ToolKernel } from "./tool_kernel";
import { ComputerPlane } from "./computer_plane";
import { VoicePlane } from "./voice_plane";

const logger = createLogger("AgentOS-Kernel");

export type AgentOSConfig = {
  mode: "SAFE" | "SUPERVISED" | "AUTOPILOT" | "RESEARCH" | "EMERGENCY-STOP";
  workspaceRoot: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export class AgentOS extends EventEmitter {
  private static instance: AgentOS;
  
  public config: AgentOSConfig;
  public status: "initializing" | "ready" | "degraded" | "shutdown" = "initializing";

  // Planes
  public control: ControlPlane;
  public data: DataPlane;
  public model: ModelPlane;
  public knowledge: KnowledgePlane;
  public action: ActionPlane;
  public tools: ToolKernel;
  public computer: ComputerPlane;
  public voice: VoicePlane;

  private constructor(config: AgentOSConfig) {
    super();
    this.config = config;
    
    // Initialize Planes
    this.data = new DataPlane(this); // Data plane first (Event Sourcing backbone)
    this.control = new ControlPlane(this); // Control plane second (Governance)
    this.model = new ModelPlane(this);
    this.knowledge = new KnowledgePlane(this);
    this.tools = new ToolKernel(this);
    this.action = new ActionPlane(this);
    this.computer = new ComputerPlane(this);
    this.voice = new VoicePlane(this);
  }

  public static getInstance(config?: AgentOSConfig): AgentOS {
    if (!AgentOS.instance) {
      if (!config) throw new Error("AgentOS requires config for first initialization");
      AgentOS.instance = new AgentOS(config);
    }
    return AgentOS.instance;
  }

  public async boot(): Promise<void> {
    logger.info("🚀 AgentOS-ASI Boot Sequence Initiated...");
    
    try {
      // 1. Data Plane (Memory & Audit)
      await this.data.initialize();
      logger.info("✅ Data Plane: Online (Event Sourcing Active)");

      // 2. Control Plane (Governance & Policy)
      await this.control.initialize();
      logger.info("✅ Control Plane: Online (Policy Engine Active)");

      // 3. Model Plane (Intelligence)
      await this.model.initialize();
      logger.info("✅ Model Plane: Online (Router Active)");

      // 4. Tool Kernel (Capabilities)
      await this.tools.initialize();
      logger.info("✅ Tool Kernel: Online (Registry Loaded)");

      // 5. Knowledge Plane (Long-term Memory)
      await this.knowledge.initialize();
      logger.info("✅ Knowledge Plane: Online (RAGFlow Connected)");

      // 6. Action & Computer Planes (Effectors)
      await Promise.all([
        this.action.initialize(),
        this.computer.initialize()
      ]);
      logger.info("✅ Action & Computer Planes: Online (Sandboxed)");

      // 7. Voice Plane (Interface)
      await this.voice.initialize();
      logger.info("✅ Voice Plane: Online");

      this.status = "ready";
      this.emit("ready");
      logger.info(`✨ AgentOS-ASI Fully Operational in [${this.config.mode}] mode.`);
      
    } catch (error: any) {
      this.status = "degraded";
      logger.error("❌ AgentOS Boot Failed:", { error: error.message, stack: error.stack });
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    logger.warn("🛑 AgentOS Shutdown Sequence Initiated...");
    this.status = "shutdown";
    // Graceful shutdown logic per plane
    await this.data.shutdown();
    logger.info("AgentOS Shutdown Complete.");
  }
}
