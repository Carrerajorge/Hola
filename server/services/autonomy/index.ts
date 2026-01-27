/**
 * Autonomy Services Index
 *
 * Central export for all autonomous system services.
 * These services implement the 100 improvements for system autonomy.
 */

// Core Services
export { selfHealing, SelfHealingService } from "./SelfHealing";
export { aiFailover, AIFailoverService } from "./AIFailover";
export { autoScaler, AutoScalerService } from "./AutoScaler";
export { intelligentMonitor, IntelligentMonitorService } from "./IntelligentMonitor";
export { securityGuard, SecurityGuardService } from "./SecurityGuard";
export { maintenanceManager, MaintenanceManagerService } from "./MaintenanceManager";
export { smartAI, SmartAIService } from "./SmartAI";
export { resourceManager, ResourceManagerService } from "./ResourceManager";
export { integrationHub, IntegrationHubService } from "./IntegrationHub";

// Types
export type { AIProvider, FailoverResult, ModelRequest } from "./AIFailover";

/**
 * Initialize all autonomy services
 */
export async function initializeAutonomy(): Promise<void> {
    const { selfHealing } = await import("./SelfHealing");
    const { autoScaler } = await import("./AutoScaler");
    const { intelligentMonitor } = await import("./IntelligentMonitor");
    const { maintenanceManager } = await import("./MaintenanceManager");
    const { resourceManager } = await import("./ResourceManager");
    const { integrationHub } = await import("./IntegrationHub");

    console.log("[Autonomy] Initializing autonomous systems...");

    // Start services
    selfHealing.start();
    autoScaler.start();
    intelligentMonitor.start();
    maintenanceManager.start();
    resourceManager.start();
    integrationHub.start();

    // Wire up events
    selfHealing.on("unhealthy", (data) => {
        intelligentMonitor.recordMetric(`health_${data.component}`, 0);
        intelligentMonitor.createAlert({
            severity: "warning",
            component: data.component,
            message: `Component unhealthy: ${data.error}`
        });
    });

    selfHealing.on("recovery_success", (data) => {
        intelligentMonitor.recordMetric(`health_${data.component}`, 100);
    });

    autoScaler.on("scale_up", (data) => {
        intelligentMonitor.createAlert({
            severity: "info",
            component: "autoscaler",
            message: `Scale up recommended for ${data.policy}: ${data.metric} = ${data.currentValue}`
        });
    });

    autoScaler.on("memory_critical", () => {
        resourceManager.forceCleanup();
    });

    console.log("[Autonomy] All autonomous systems initialized");
}

/**
 * Shutdown all autonomy services gracefully
 */
export async function shutdownAutonomy(): Promise<void> {
    const { selfHealing } = await import("./SelfHealing");
    const { autoScaler } = await import("./AutoScaler");
    const { intelligentMonitor } = await import("./IntelligentMonitor");
    const { maintenanceManager } = await import("./MaintenanceManager");
    const { resourceManager } = await import("./ResourceManager");
    const { integrationHub } = await import("./IntegrationHub");

    console.log("[Autonomy] Shutting down autonomous systems...");

    // Stop services in reverse order
    integrationHub.stop();
    resourceManager.stop();
    maintenanceManager.stop();
    intelligentMonitor.stop();
    autoScaler.stop();
    selfHealing.stop();

    // Graceful shutdown with timeout
    await maintenanceManager.gracefulShutdown(30000);

    console.log("[Autonomy] All autonomous systems stopped");
}

/**
 * Get comprehensive system status
 */
export async function getSystemStatus(): Promise<{
    healthy: boolean;
    services: Record<string, any>;
    metrics: Record<string, any>;
    alerts: any[];
}> {
    const { selfHealing } = await import("./SelfHealing");
    const { autoScaler } = await import("./AutoScaler");
    const { intelligentMonitor } = await import("./IntelligentMonitor");
    const { securityGuard } = await import("./SecurityGuard");
    const { maintenanceManager } = await import("./MaintenanceManager");
    const { resourceManager } = await import("./ResourceManager");

    const healthStatus = selfHealing.getHealthStatus();
    const scalerStatus = autoScaler.getStatus();
    const monitorData = intelligentMonitor.getDashboardData();
    const securityStatus = securityGuard.getSecurityStatus();
    const maintenanceStatus = maintenanceManager.getStatus();
    const resourceStatus = resourceManager.getStatus();

    const isHealthy = selfHealing.isHealthy() &&
        scalerStatus.healthy &&
        maintenanceStatus.healthStatus !== "critical";

    return {
        healthy: isHealthy,
        services: {
            selfHealing: {
                healthy: selfHealing.isHealthy(),
                components: Object.fromEntries(healthStatus)
            },
            autoScaler: scalerStatus,
            security: securityStatus,
            maintenance: maintenanceStatus,
            resources: resourceStatus
        },
        metrics: {
            memory: resourceStatus.memory,
            cache: resourceStatus.cache,
            costs: monitorData.costs,
            sla: monitorData.sla
        },
        alerts: monitorData.alerts
    };
}

export default {
    initializeAutonomy,
    shutdownAutonomy,
    getSystemStatus
};
