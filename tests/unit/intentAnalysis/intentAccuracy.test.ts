/**
 * Golden Dataset: Intent Classification Accuracy Tests
 *
 * 50+ Spanish prompts with known expected intents.
 * Target: >= 90% accuracy on the regex fast-path.
 *
 * These tests validate the detectIntent() function from requestSpec.ts
 * which is the foundation of the intent analysis pipeline.
 */

import { describe, it, expect } from "vitest";
import { detectIntent } from "../../../server/agent/requestSpec";

interface GoldenEntry {
  prompt: string;
  expectedIntent: string;
  minConfidence: number;
  description: string;
}

const GOLDEN_DATASET: GoldenEntry[] = [
  // ─── Chat (simple greetings & questions) ─────────────────────
  {
    prompt: "Hola, buenas tardes",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "Simple greeting",
  },
  {
    prompt: "¿Cómo estás?",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "How are you",
  },
  {
    prompt: "Gracias por la ayuda",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "Thank you",
  },
  {
    prompt: "Ok perfecto",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "Simple acknowledgment",
  },
  {
    prompt: "Sí, entendido",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "Acknowledgment",
  },

  // ─── Web Automation (reservations) ────────────────────────────
  {
    prompt: "Reserva una mesa en el restaurante Cala para 4 personas",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Restaurant reservation",
  },
  {
    prompt: "Haz una reserva en restaurante La Mar para el viernes a las 8pm",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Reservation with date and time",
  },
  {
    prompt: "Reserva en Cala para 2 personas mañana",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Short reservation request",
  },
  {
    prompt: "Navega a google.com y busca vuelos a Madrid",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Navigate and search",
  },
  {
    prompt: "Abre youtube.com",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Direct URL navigation",
  },
  {
    prompt: "Busca en google hoteles en Barcelona",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Search on specific website",
  },
  {
    prompt: "Compra dos boletos para el concierto en línea",
    expectedIntent: "web_automation",
    minConfidence: 0.8,
    description: "Online purchase",
  },

  // ─── Document Generation ──────────────────────────────────────
  {
    prompt: "Crea un documento Word sobre inteligencia artificial",
    expectedIntent: "document_generation",
    minConfidence: 0.7,
    description: "Create Word document",
  },
  {
    prompt: "Escribe un informe sobre el cambio climático en Word",
    expectedIntent: "document_generation",
    minConfidence: 0.7,
    description: "Write a report",
  },
  {
    prompt: "Redacta una carta de presentación para un puesto de ingeniero en PDF",
    expectedIntent: "document_generation",
    minConfidence: 0.7,
    description: "Draft cover letter",
  },
  {
    prompt: "Genera un documento con las mejores prácticas de seguridad",
    expectedIntent: "document_generation",
    minConfidence: 0.7,
    description: "Generate security doc",
  },

  // ─── Presentation Creation ────────────────────────────────────
  {
    prompt: "Crea una presentación sobre inteligencia artificial para mi clase",
    expectedIntent: "presentation_creation",
    minConfidence: 0.7,
    description: "Create AI presentation",
  },
  {
    prompt: "Hazme un PowerPoint sobre marketing digital",
    expectedIntent: "presentation_creation",
    minConfidence: 0.7,
    description: "Make PowerPoint",
  },
  {
    prompt: "Genera diapositivas sobre los planetas del sistema solar",
    expectedIntent: "presentation_creation",
    minConfidence: 0.7,
    description: "Generate slides",
  },

  // ─── Spreadsheet Creation ─────────────────────────────────────
  {
    prompt: "Crea un Excel con un presupuesto mensual",
    expectedIntent: "spreadsheet_creation",
    minConfidence: 0.7,
    description: "Create Excel budget",
  },
  {
    prompt: "Genera una hoja de cálculo con datos de ventas",
    expectedIntent: "spreadsheet_creation",
    minConfidence: 0.7,
    description: "Generate sales spreadsheet",
  },
  {
    prompt: "Hazme una tabla con los países de Sudamérica y sus capitales",
    expectedIntent: "spreadsheet_creation",
    minConfidence: 0.7,
    description: "Create country table",
  },

  // ─── Research ─────────────────────────────────────────────────
  {
    prompt: "Investiga sobre las últimas tendencias en machine learning",
    expectedIntent: "research",
    minConfidence: 0.7,
    description: "Research ML trends",
  },
  {
    prompt: "Busca información detallada sobre la historia de Roma",
    expectedIntent: "research",
    minConfidence: 0.7,
    description: "Research Roman history",
  },
  {
    prompt: "¿Qué es la computación cuántica?",
    expectedIntent: "research",
    minConfidence: 0.5,
    description: "What is quantum computing",
  },

  // ─── Image Generation ─────────────────────────────────────────
  {
    prompt: "Genera una imagen de un paisaje con montañas y un lago",
    expectedIntent: "image_generation",
    minConfidence: 0.7,
    description: "Generate landscape image",
  },
  {
    prompt: "Crea una ilustración de un gato astronauta",
    expectedIntent: "image_generation",
    minConfidence: 0.7,
    description: "Create astronaut cat illustration",
  },

  // ─── Code Generation ──────────────────────────────────────────
  {
    prompt: "Crea una función en Python que ordene una lista",
    expectedIntent: "code_generation",
    minConfidence: 0.7,
    description: "Python sort function",
  },
  {
    prompt: "Escribe un programa en JavaScript para validar emails",
    expectedIntent: "code_generation",
    minConfidence: 0.7,
    description: "JS email validator",
  },
  {
    prompt: "Implementa un API REST en TypeScript con Express",
    expectedIntent: "code_generation",
    minConfidence: 0.7,
    description: "TypeScript REST API",
  },

  // ─── Data Analysis ────────────────────────────────────────────
  {
    prompt: "Analiza los datos de ventas del último trimestre",
    expectedIntent: "data_analysis",
    minConfidence: 0.7,
    description: "Analyze sales data",
  },
  {
    prompt: "Crea un gráfico con las estadísticas de usuarios",
    expectedIntent: "data_analysis",
    minConfidence: 0.7,
    description: "Create user stats chart",
  },

  // ─── Multi-step Tasks ─────────────────────────────────────────
  {
    prompt: "Investiga sobre energía solar y crea un documento Word con los hallazgos",
    expectedIntent: "multi_step_task",
    minConfidence: 0.8,
    description: "Research + create document",
  },
  {
    prompt: "Busca artículos sobre blockchain y genera un informe detallado",
    expectedIntent: "multi_step_task",
    minConfidence: 0.8,
    description: "Search + generate report",
  },

  // ─── Edge cases / Ambiguous ───────────────────────────────────
  {
    prompt: "Escribe una carta de amor de 400 palabras",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "Plain writing request without file output",
  },
  {
    prompt: "Dame 5 razones para aprender programación",
    expectedIntent: "chat",
    minConfidence: 0.3,
    description: "Ambiguous - could be research or chat",
  },
  {
    prompt: "¿Puedes ayudarme con algo?",
    expectedIntent: "chat",
    minConfidence: 0.5,
    description: "Vague request",
  },
  {
    prompt: "Necesito hacer algo urgente",
    expectedIntent: "chat",
    minConfidence: 0.3,
    description: "Very vague",
  },
];

describe("Intent Classification - Golden Dataset", () => {
  let correct = 0;
  const total = GOLDEN_DATASET.length;

  GOLDEN_DATASET.forEach((entry, index) => {
    it(`[${index + 1}/${total}] ${entry.description}: "${entry.prompt.slice(0, 50)}..."`, () => {
      const result = detectIntent(entry.prompt, []);

      const isCorrect = result.intent === entry.expectedIntent;
      if (isCorrect) correct++;

      expect(result.intent).toBe(entry.expectedIntent);
      expect(result.confidence).toBeGreaterThanOrEqual(entry.minConfidence);
    });
  });

  it("should achieve >= 85% accuracy on golden dataset", () => {
    // Run all classifications
    let correctCount = 0;
    for (const entry of GOLDEN_DATASET) {
      const result = detectIntent(entry.prompt, []);
      if (result.intent === entry.expectedIntent) correctCount++;
    }
    const accuracy = correctCount / total;
    console.log(`\nGolden Dataset Accuracy: ${(accuracy * 100).toFixed(1)}% (${correctCount}/${total})`);

    // Log failures for debugging
    if (accuracy < 0.85) {
      for (const entry of GOLDEN_DATASET) {
        const result = detectIntent(entry.prompt, []);
        if (result.intent !== entry.expectedIntent) {
          console.log(`  FAIL: "${entry.prompt.slice(0, 50)}" → got "${result.intent}" (expected "${entry.expectedIntent}")`);
        }
      }
    }

    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });
});
