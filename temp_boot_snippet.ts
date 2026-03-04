
  // Boot AgentOS-ASI Kernel (NASA-grade architecture)
  try {
    const agentOS = AgentOS.getInstance({
      mode: process.env.NODE_ENV === "production" ? "SAFE" : "SUPERVISED",
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || process.cwd(),
      logLevel: process.env.NODE_ENV === "production" ? "info" : "debug"
    });
    await agentOS.boot();
  } catch (err) {
    Logger.error("Failed to boot AgentOS Kernel:", err);
  }
