import { EventEmitter } from "events";

import type { DashboardEvent } from "./eventSchema";

interface TelemetryEmitter extends EventEmitter {
  emit(event: "event", payload: DashboardEvent): boolean;
  on(event: "event", listener: (payload: DashboardEvent) => void): this;
}

class DashboardTelemetryEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }
}

export const telemetryEmitter: TelemetryEmitter = new DashboardTelemetryEmitter() as TelemetryEmitter;

export function emitDashboardEvent(payload: DashboardEvent): boolean {
  return telemetryEmitter.emit("event", payload);
}

