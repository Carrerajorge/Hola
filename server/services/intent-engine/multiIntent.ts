import type {
  IntentType,
  OutputFormat,
  Slots,
  SingleIntentResult,
  PlanStep,
  MultiIntentResult
} from "../../../shared/schemas/intent";

const MULTI_INTENT_PATTERNS: Array<{
  pattern: RegExp;
  separator: "and" | "then" | "list";
}> = [
  { pattern: /\b(y\s+tambien|y\s+también|and\s+also|and\s+then|puis|und\s+dann)\b/i, separator: "and" },
  { pattern: /\b(despues|después|then|after\s+that|ensuite|danach|poi)\b/i, separator: "then" },
  { pattern: /\b(primero.*(?:segundo|luego)|first.*(?:second|then)|d'abord.*ensuite|zuerst.*dann)\b/i, separator: "then" },
  { pattern: /\d+\)\s+.*\d+\)\s+/m, separator: "list" },
  { pattern: /[-•]\s+.*[-•]\s+/m, separator: "list" }
];

const INTENT_COMBINATIONS: Array<{
  patterns: RegExp[];
  intents: IntentType[];
}> = [
  {
    patterns: [/\b(busca|search|recherch)\b/i, /\b(presenta|presentation|pptx?)\b/i],
    intents: ["SEARCH_WEB", "CREATE_PRESENTATION"]
  },
  {
    patterns: [/\b(analiz|analy[sz]e|examin)\b/i, /\b(resum|summar)\b/i],
    intents: ["ANALYZE_DOCUMENT", "SUMMARIZE"]
  },
  {
    patterns: [/\b(traduc|translat)\b/i, /\b(document|word|docx?)\b/i],
    intents: ["TRANSLATE", "CREATE_DOCUMENT"]
  },
  {
    patterns: [/\b(busca|search)\b/i, /\b(excel|spreadsheet|tabla)\b/i],
    intents: ["SEARCH_WEB", "CREATE_SPREADSHEET"]
  }
];

export interface MultiIntentDetectionResult {
  isMultiIntent: boolean;
  detectedIntents: IntentType[];
  separatorType: "and" | "then" | "list" | "implicit" | null;
  segments: string[];
  requiresSequentialExecution: boolean;
}

export function detectMultiIntent(normalizedText: string): MultiIntentDetectionResult {
  for (const combo of INTENT_COMBINATIONS) {
    const allMatch = combo.patterns.every(p => p.test(normalizedText));
    if (allMatch) {
      return {
        isMultiIntent: true,
        detectedIntents: combo.intents,
        separatorType: "implicit",
        segments: [normalizedText],
        requiresSequentialExecution: combo.intents[0] === "SEARCH_WEB"
      };
    }
  }

  for (const { pattern, separator } of MULTI_INTENT_PATTERNS) {
    if (pattern.test(normalizedText)) {
      let segments: string[] = [];
      
      if (separator === "list") {
        segments = normalizedText.split(/(?:\d+\)|[-•])\s+/).filter(s => s.trim());
      } else {
        const splitPattern = separator === "and"
          ? /\s+(?:y\s+tambien|y\s+también|and\s+also|and\s+then|puis|und\s+dann)\s+/i
          : /\s+(?:despues|después|then|after\s+that|ensuite|danach|poi)\s+/i;
        segments = normalizedText.split(splitPattern).filter(s => s.trim());
      }

      if (segments.length > 1) {
        return {
          isMultiIntent: true,
          detectedIntents: [],
          separatorType: separator,
          segments,
          requiresSequentialExecution: separator === "then"
        };
      }
    }
  }

  return {
    isMultiIntent: false,
    detectedIntents: [],
    separatorType: null,
    segments: [normalizedText],
    requiresSequentialExecution: false
  };
}

export function buildExecutionPlan(
  intents: SingleIntentResult[]
): MultiIntentResult["plan"] {
  if (intents.length === 0) {
    return { steps: [], execution_order: [] };
  }

  const steps: PlanStep[] = [];
  const dependencies = new Map<number, number[]>();

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    const step: PlanStep = {
      step_id: i + 1,
      intent: intent.intent,
      output_format: intent.output_format,
      slots: intent.slots,
      depends_on: []
    };

    if (intent.intent === "CREATE_PRESENTATION" || 
        intent.intent === "CREATE_DOCUMENT" || 
        intent.intent === "CREATE_SPREADSHEET") {
      
      for (let j = 0; j < i; j++) {
        if (intents[j].intent === "SEARCH_WEB" || intents[j].intent === "ANALYZE_DOCUMENT") {
          step.depends_on = step.depends_on || [];
          step.depends_on.push(j + 1);
        }
      }
    }

    steps.push(step);
    dependencies.set(i + 1, step.depends_on || []);
  }

  const execution_order = topologicalSort(steps.length, dependencies);

  return { steps, execution_order };
}

function topologicalSort(n: number, deps: Map<number, number[]>): number[] {
  const inDegree = new Map<number, number>();
  const graph = new Map<number, number[]>();

  for (let i = 1; i <= n; i++) {
    inDegree.set(i, 0);
    graph.set(i, []);
  }

  for (const [node, dependencies] of deps) {
    for (const dep of dependencies) {
      graph.get(dep)?.push(node);
      inDegree.set(node, (inDegree.get(node) || 0) + 1);
    }
  }

  const queue: number[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const result: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of graph.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  return result.length === n ? result : Array.from({ length: n }, (_, i) => i + 1);
}

export function generateDisambiguationQuestion(
  detectedIntents: IntentType[],
  locale: string
): string {
  const questions: Record<string, Record<string, string>> = {
    format: {
      es: "¿En qué formato lo quieres? (PowerPoint, Word o Excel)",
      en: "What format would you like? (PowerPoint, Word, or Excel)",
      pt: "Em que formato você quer? (PowerPoint, Word ou Excel)",
      fr: "Quel format souhaitez-vous ? (PowerPoint, Word ou Excel)",
      de: "Welches Format möchten Sie? (PowerPoint, Word oder Excel)",
      it: "Quale formato preferisci? (PowerPoint, Word o Excel)"
    },
    order: {
      es: "¿Quieres que primero busque la información y luego cree el documento?",
      en: "Would you like me to search for information first and then create the document?",
      pt: "Quer que eu primeiro busque as informações e depois crie o documento?",
      fr: "Voulez-vous que je recherche d'abord les informations puis crée le document ?",
      de: "Möchten Sie, dass ich zuerst nach Informationen suche und dann das Dokument erstelle?",
      it: "Vuoi che prima cerchi le informazioni e poi crei il documento?"
    },
    priority: {
      es: "Detecto múltiples tareas. ¿Cuál te gustaría que haga primero?",
      en: "I detect multiple tasks. Which would you like me to do first?",
      pt: "Detecto múltiplas tarefas. Qual você gostaria que eu fizesse primeiro?",
      fr: "Je détecte plusieurs tâches. Laquelle voulez-vous que je fasse en premier ?",
      de: "Ich erkenne mehrere Aufgaben. Welche soll ich zuerst erledigen?",
      it: "Rilevo più attività. Quale vorresti che facessi prima?"
    }
  };

  const hasSearch = detectedIntents.includes("SEARCH_WEB");
  const hasCreate = detectedIntents.some(i => 
    i === "CREATE_PRESENTATION" || i === "CREATE_DOCUMENT" || i === "CREATE_SPREADSHEET"
  );

  if (hasSearch && hasCreate) {
    return questions.order[locale] || questions.order.en;
  }

  const createIntents = detectedIntents.filter(i =>
    i === "CREATE_PRESENTATION" || i === "CREATE_DOCUMENT" || i === "CREATE_SPREADSHEET"
  );

  if (createIntents.length > 1) {
    return questions.format[locale] || questions.format.en;
  }

  if (detectedIntents.length > 1) {
    return questions.priority[locale] || questions.priority.en;
  }

  return questions.format[locale] || questions.format.en;
}

export function mergeSlots(slotsArray: Slots[]): Slots {
  const merged: Slots = {};

  for (const slots of slotsArray) {
    for (const [key, value] of Object.entries(slots)) {
      if (value !== undefined && merged[key as keyof Slots] === undefined) {
        (merged as any)[key] = value;
      }
    }
  }

  return merged;
}
