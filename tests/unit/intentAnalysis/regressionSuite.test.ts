/**
 * Regression Suite: Pinned Intent Classifications
 *
 * These prompts must NEVER change their classification.
 * Run on CI with every commit to catch regressions.
 */

import { describe, it, expect } from "vitest";
import { detectIntent } from "../../../server/agent/requestSpec";

describe("Intent Classification - Regression Suite (pinned)", () => {
  // These are critical paths that must never break

  it("reservations always route to web_automation", () => {
    const cases = [
      "Reserva en restaurante Cala para 2 personas",
      "Haz una reserva en el restaurante La Mar para mañana",
      "Reserva mesa para 4 el viernes a las 8pm",
      "Booking at restaurant for tomorrow",
    ];
    for (const msg of cases) {
      const result = detectIntent(msg, []);
      expect(result.intent, `"${msg}" should be web_automation`).toBe("web_automation");
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("URL navigation always routes to web_automation", () => {
    const cases = [
      "Navega a google.com",
      "Abre youtube.com y busca videos",
      "Visita a wikipedia.org",
      "Ve a amazon.com",
    ];
    for (const msg of cases) {
      const result = detectIntent(msg, []);
      expect(result.intent, `"${msg}" should be web_automation`).toBe("web_automation");
    }
  });

  it("document creation routes to document_generation", () => {
    const cases = [
      "Crea un documento sobre energía solar",
      "Escribe un informe de ventas",
      "Redacta una carta formal",
    ];
    for (const msg of cases) {
      const result = detectIntent(msg, []);
      expect(result.intent, `"${msg}" should be document_generation`).toBe("document_generation");
    }
  });

  it("presentation requests route to presentation_creation", () => {
    const cases = [
      "Crea una presentación sobre marketing",
      "Hazme un PowerPoint de 10 slides",
      "Genera diapositivas sobre historia",
    ];
    for (const msg of cases) {
      const result = detectIntent(msg, []);
      expect(result.intent, `"${msg}" should be presentation_creation`).toBe("presentation_creation");
    }
  });

  it("short greetings route to chat", () => {
    const cases = ["Hola", "Buenos días", "Hey", "Ok"];
    for (const msg of cases) {
      const result = detectIntent(msg, []);
      expect(result.intent, `"${msg}" should be chat`).toBe("chat");
    }
  });

  it("research + document combo routes to multi_step_task", () => {
    const result = detectIntent("Investiga sobre blockchain y crea un documento Word", []);
    expect(result.intent).toBe("multi_step_task");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("document attachments route to document_analysis", () => {
    const result = detectIntent("Analiza este archivo", [
      { id: "1", name: "report.pdf", mimeType: "application/pdf" },
    ]);
    expect(result.intent).toBe("document_analysis");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("code requests route to code_generation", () => {
    const result = detectIntent("Crea una función en Python para ordenar listas", []);
    expect(result.intent).toBe("code_generation");
  });

  it("image requests route to image_generation", () => {
    const result = detectIntent("Genera una imagen de un paisaje", []);
    expect(result.intent).toBe("image_generation");
  });

  it("excel requests route to spreadsheet_creation", () => {
    const result = detectIntent("Crea un Excel con datos de ventas", []);
    expect(result.intent).toBe("spreadsheet_creation");
  });
});
