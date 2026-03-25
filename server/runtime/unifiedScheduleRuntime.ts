import type { ScheduleRuntime } from "./contracts";
import type { RuntimeHealth, UnifiedScheduleDefinition } from "./types";
import { ChatScheduleAdapter } from "./adapters/ChatScheduleAdapter";

export class UnifiedScheduleRuntime implements ScheduleRuntime {
  constructor(private readonly scheduleAdapter = new ChatScheduleAdapter()) {}

  async health(): Promise<RuntimeHealth> {
    return {
      engine: "schedule-runner",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { facade: "UnifiedScheduleRuntime" },
    };
  }

  async list(userId: string, options?: Record<string, unknown>): Promise<UnifiedScheduleDefinition[]> {
    return this.scheduleAdapter.list(userId, options);
  }

  async create(userId: string, input: Record<string, unknown>): Promise<UnifiedScheduleDefinition> {
    return this.scheduleAdapter.create(userId, input);
  }

  async cancel(userId: string, scheduleId: string): Promise<boolean> {
    return this.scheduleAdapter.cancel(userId, scheduleId);
  }

  async runNow(userId: string, scheduleId: string): Promise<boolean> {
    return this.scheduleAdapter.runNow?.(userId, scheduleId) ?? false;
  }
}
