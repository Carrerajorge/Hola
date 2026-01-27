/**
 * Robustness Services Index
 *
 * Central export for all robustness and resilience services.
 * These services implement improvements 101-200 for system robustness.
 */

// Core Services
export { networkResilience, NetworkResilienceService } from "./NetworkResilience";
export { dataProcessing, DataProcessingService } from "./DataProcessing";
export { performanceOptimizer, PerformanceOptimizerService } from "./PerformanceOptimizer";
export { realtimeCommunication, RealtimeCommunicationService } from "./RealtimeCommunication";
export { advancedAnalytics, AdvancedAnalyticsService } from "./AdvancedAnalytics";

/**
 * Initialize all robustness services
 */
export async function initializeRobustness(): Promise<void> {
    const { performanceOptimizer } = await import("./PerformanceOptimizer");
    const { realtimeCommunication } = await import("./RealtimeCommunication");
    const { advancedAnalytics } = await import("./AdvancedAnalytics");

    console.log("[Robustness] Initializing robustness services...");

    // Start services
    performanceOptimizer.start();
    realtimeCommunication.start();
    advancedAnalytics.start();

    // Wire up events
    performanceOptimizer.on("memory_critical", (data) => {
        console.warn("[Robustness] Memory critical alert:", data);
        advancedAnalytics.trackSystemEvent("memory_critical", data);
    });

    realtimeCommunication.on("message", (data) => {
        advancedAnalytics.trackSystemEvent("realtime_message", { channel: data.message.channel });
    });

    console.log("[Robustness] All robustness services initialized");
}

/**
 * Shutdown all robustness services gracefully
 */
export async function shutdownRobustness(): Promise<void> {
    const { performanceOptimizer } = await import("./PerformanceOptimizer");
    const { realtimeCommunication } = await import("./RealtimeCommunication");
    const { advancedAnalytics } = await import("./AdvancedAnalytics");
    const { dataProcessing } = await import("./DataProcessing");
    const { networkResilience } = await import("./NetworkResilience");

    console.log("[Robustness] Shutting down robustness services...");

    // Stop services
    advancedAnalytics.stop();
    realtimeCommunication.stop();
    performanceOptimizer.stop();
    dataProcessing.stop();
    networkResilience.stop();

    console.log("[Robustness] All robustness services stopped");
}

/**
 * Get comprehensive robustness status
 */
export async function getRobustnessStatus(): Promise<{
    healthy: boolean;
    services: Record<string, any>;
    metrics: Record<string, any>;
}> {
    const { networkResilience } = await import("./NetworkResilience");
    const { dataProcessing } = await import("./DataProcessing");
    const { performanceOptimizer } = await import("./PerformanceOptimizer");
    const { realtimeCommunication } = await import("./RealtimeCommunication");
    const { advancedAnalytics } = await import("./AdvancedAnalytics");

    const performanceReport = performanceOptimizer.getComprehensiveReport();
    const isHealthy = performanceReport.memory.percentUsed < 0.9 &&
                      !performanceReport.memory.oomPrediction.willOOM;

    return {
        healthy: isHealthy,
        services: {
            network: {
                stats: networkResilience.getStats(),
                circuits: networkResilience.getCircuitStatus(),
                queue: networkResilience.getQueueStatus()
            },
            data: {
                stats: dataProcessing.getStats()
            },
            performance: {
                memory: performanceReport.memory,
                slowQueries: performanceReport.slowQueries.length,
                slowEndpoints: performanceReport.slowEndpoints.length
            },
            realtime: realtimeCommunication.getStats(),
            analytics: advancedAnalytics.getStats()
        },
        metrics: {
            recommendations: performanceReport.recommendations
        }
    };
}

export default {
    initializeRobustness,
    shutdownRobustness,
    getRobustnessStatus
};
