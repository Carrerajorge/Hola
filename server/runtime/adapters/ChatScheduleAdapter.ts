import type { ScheduleRuntime } from "../contracts";
import type { RuntimeHealth, UnifiedScheduleDefinition } from "../types";

export class ChatScheduleAdapter implements ScheduleRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "schedule-runner",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  async list(_userId: string, _options?: Record<string, unknown>): Promise<UnifiedScheduleDefinition[]> {
    throw new Error("TODO: read chatSchedules");
  }

  async create(_userId: string, _input: Record<string, unknown>): Promise<UnifiedScheduleDefinition> {
    throw new Error("TODO: create schedule in current chat schedule system");
  }

  async cancel(_userId: string, _scheduleId: string): Promise<boolean> {
    throw new Error("TODO: disable current chat schedule");
  }

  async runNow(_userId: string, _scheduleId: string): Promise<boolean> {
    throw new Error("TODO: support immediate scheduled execution");
  }
}
