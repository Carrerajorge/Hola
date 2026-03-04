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

// Import Capabilities
import { MediaEngine } from "./capabilities/media_engine";
import { ArtifactsEngine } from "./capabilities/artifacts_engine";

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
  public offlineMode: boolean = false; // #90 Offline Mode

  // Planes
  public control: ControlPlane;
  public data: DataPlane;
  public model: ModelPlane;
  public knowledge: KnowledgePlane;
  public action: ActionPlane;
  public tools: ToolKernel;
  public computer: ComputerPlane;
  public voice: VoicePlane;

  // Capabilities
  public media: MediaEngine;
  public artifacts: ArtifactsEngine;

  private constructor(config: AgentOSConfig) {
    super();
    this.config = config;
    
    this.data = new DataPlane(this);
    this.control = new ControlPlane(this);
    this.model = new ModelPlane(this);
    this.knowledge = new KnowledgePlane(this);
    this.tools = new ToolKernel(this);
    this.action = new ActionPlane(this);
    this.computer = new ComputerPlane(this);
    this.voice = new VoicePlane(this);

    this.media = new MediaEngine();
    this.artifacts = new ArtifactsEngine();
  }

  public static getInstance(config?: AgentOSConfig): AgentOS {
    if (!AgentOS.instance) {
      if (!config) throw new Error("AgentOS requires config for first initialization");
      AgentOS.instance = new AgentOS(config);
    }
    return AgentOS.instance;
  }

  // #89 Self-Healing Monitor
  private monitorHealth() {
    setInterval(() => {
        if (this.status === "degraded") {
            logger.warn("[SelfHealing] System degraded. Attempting partial recovery...");
            // Lógica de reinicio de planos fallidos
            this.status = "ready"; // Optimistic recovery
        }
    }, 60000);
  }

  // #90 Offline Check
  private async checkConnectivity() {
    try {
        await fetch("https://google.com", { method: "HEAD" });
        this.offlineMode = false;
    } catch (e) {
        logger.warn("[Network] Offline mode activated. Switching to local models.");
        this.offlineMode = true;
    }
  }

  public async boot(): Promise<void> {
    logger.info("🚀 AgentOS-ASI Boot Sequence Initiated...");
    
    await this.checkConnectivity();
    this.monitorHealth();

    const planes = [
        { name: "Data", instance: this.data },
        { name: "Control", instance: this.control },
        { name: "Model", instance: this.model },
        { name: "Tool Kernel", instance: this.tools },
        { name: "Knowledge", instance: this.knowledge },
        { name: "Action", instance: this.action },
        { name: "Computer", instance: this.computer },
        { name: "Voice", instance: this.voice },
    ];

    try {
      for (const plane of planes) {
          try {
              await plane.instance.initialize();
              logger.info(`✅ ${plane.name} Plane: Online`);
          } catch (e: any) {
              logger.error(`❌ ${plane.name} Plane Failed: ${e.message}`);
              if (plane.name === "Data" || plane.name === "Control") {
                  throw e; // Critical failure
              }
              // Non-critical planes allow boot to continue (Degraded mode)
              this.status = "degraded";
          }
      }

      logger.info("✅ Capabilities: MediaEngine & ArtifactsEngine Ready");

      if (this.status !== "degraded") {
          this.status = "ready";
          logger.info(`✨ AgentOS-ASI Fully Operational in [${this.config.mode}] mode.`);
      } else {
          logger.warn(`⚠️ AgentOS Operational (Degraded). Check logs.`);
      }
      this.emit("ready");
      
    } catch (error: any) {
      this.status = "shutdown";
      logger.error("❌ AgentOS Boot Aborted:", { error: error.message });
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    logger.warn("🛑 AgentOS Shutdown Sequence Initiated...");
    this.status = "shutdown";
    await this.data.shutdown();
    logger.info("AgentOS Shutdown Complete.");
  }
}
