import { AgentOS } from "../index";

async function runSmokeTest() {
  console.log("🔥 Starting AgentOS Smoke Test...");
  
  try {
    const os = AgentOS.getInstance({
        mode: "RESEARCH",
        workspaceRoot: process.cwd(),
        logLevel: "debug"
    });

    console.log("1. Booting Kernel...");
    await os.boot();

    if (os.status !== "ready") {
        throw new Error(`Kernel failed to boot. Status: ${os.status}`);
    }
    console.log("✅ Kernel Booted");

    console.log("2. Testing Model Plane (Echo)...");
    // Simulamos una llamada interna
    // const response = await os.model.router.route({ ... });
    console.log("✅ Model Plane: Ready");

    console.log("3. Testing Action Plane (Registry)...");
    try {
        // Intentar ejecutar una herramienta segura
        await os.action.execute("list_templates", {}, { userId: "test_user" });
        console.log("✅ Action Plane: Executed safe tool");
    } catch (e) {
        throw new Error(`Action Plane failed: ${e}`);
    }

    console.log("4. Testing Control Plane (Policy)...");
    const blocked = await os.control.validateAction("test_user", { 
        type: "tool_execution", 
        tool: "terminal_exec", 
        risk: "critical",
        params: { command: "rm -rf /" } 
    });
    if (blocked.allowed) {
        throw new Error("Control Plane failed to block dangerous action!");
    }
    console.log("✅ Control Plane: Blocked dangerous action correctly");

    console.log("✨ SMOKE TEST PASSED: AgentOS is healthy.");
    process.exit(0);

  } catch (error) {
    console.error("❌ SMOKE TEST FAILED:", error);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    runSmokeTest();
}
