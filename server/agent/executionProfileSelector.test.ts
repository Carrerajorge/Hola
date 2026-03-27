import { describe, expect, it } from "vitest";

import { selectAgentExecutionProfile } from "./executionProfileSelector";

describe("executionProfileSelector", () => {
  it("keeps requested marathon profiles intact", () => {
    const selection = selectAgentExecutionProfile({
      requestedProfile: "marathon_24h",
      message: "Construye una aplicación completa con backend, frontend y despliegue",
    });

    expect(selection.profile).toBe("marathon_24h");
    expect(selection.source).toBe("requested");
  });

  it("promotes complex software delivery tasks to marathon mode automatically", () => {
    const selection = selectAgentExecutionProfile({
      requestedProfile: "standard",
      message:
        "Programa un software completo tipo SaaS con arquitectura escalable, backend, frontend, autenticación, base de datos, CI/CD y despliegue a producción",
    });

    expect(selection.source).toBe("auto");
    expect(["marathon_12h", "marathon_24h"]).toContain(selection.profile);
  });

  it("promotes long-running orchestration requests for software work", () => {
    const selection = selectAgentExecutionProfile({
      message:
        "Quiero que la función interna del software orqueste tareas largas durante muchas horas cuando tengamos que programar un software, una web o algo muy completo",
    });

    expect(selection.source).toBe("auto");
    expect(["marathon_12h", "marathon_24h"]).toContain(selection.profile);
  });

  it("keeps simple requests on standard mode", () => {
    const selection = selectAgentExecutionProfile({
      requestedProfile: "standard",
      message: "Explícame qué es una API REST",
    });

    expect(selection.profile).toBe("standard");
    expect(selection.source).not.toBe("auto");
  });
});
