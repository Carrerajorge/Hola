/**
 * Blueprint Agent
 * 
 * Diseñador de plan y estructura. Crea:
 * - OutlineSpec (índice jerárquico)
 * - ResearchPlan (queries de investigación)
 * - QARubric (criterios de calidad)
 * - DeliverableMap (qué va a cada formato)
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { WorkOrder, DocumentIntent, Audience } from './types';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

const MODEL = 'grok-4-1-fast-non-reasoning';

// ============================================================================
// Schemas
// ============================================================================

const KNOWN_SECTION_TYPES = [
    'executive_summary',
    'introduction',
    'methodology',
    'context',
    'analysis',
    'findings',
    'results',
    'discussion',
    'conclusions',
    'recommendations',
    'appendix',
    'bibliography',
    'custom'
] as const;

export const SectionSchema = z.object({
    id: z.string().catch('s0'),
    title: z.string(),
    level: z.coerce.number().min(1).max(4).catch(1),
    type: z.enum(KNOWN_SECTION_TYPES).catch('custom'),
    objective: z.string().catch(''),
    targetWordCount: z.coerce.number().catch(500),
    requiresResearch: z.coerce.boolean().catch(false),
    requiresData: z.coerce.boolean().catch(false),
    children: z.array(z.lazy(() => SectionSchema)).optional().catch(undefined),
});
export type Section = z.infer<typeof SectionSchema>;

export const OutlineSpecSchema = z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    abstract: z.string().optional(),
    sections: z.array(SectionSchema).catch([]),
    totalTargetWords: z.coerce.number().catch(3000),
    estimatedPages: z.coerce.number().catch(8),
});
export type OutlineSpec = z.infer<typeof OutlineSpecSchema>;

export const ResearchQuerySchema = z.object({
    id: z.string().catch('q0'),
    query: z.string(),
    purpose: z.string().catch(''),
    targetSections: z.array(z.string()).catch([]),
    sourceType: z.enum(['web', 'internal', 'academic', 'any']).catch('any'),
    priority: z.enum(['critical', 'important', 'optional']).catch('optional'),
});
export type ResearchQuery = z.infer<typeof ResearchQuerySchema>;

export const ResearchPlanSchema = z.object({
    queries: z.array(ResearchQuerySchema).catch([]),
    expectedSources: z.coerce.number().catch(0),
    researchScope: z.string().catch(''),
    limitations: z.array(z.string()).catch([]),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export const QACriterionSchema = z.object({
    id: z.string().catch('c0'),
    name: z.string(),
    description: z.string().catch(''),
    weight: z.coerce.number().min(0).max(1).catch(0.5),
    checkType: z.enum(['automated', 'llm', 'manual']).catch('llm'),
    threshold: z.coerce.number().min(0).max(100).catch(70),
});
export type QACriterion = z.infer<typeof QACriterionSchema>;

export const QARubricSchema = z.object({
    criteria: z.array(QACriterionSchema).catch([]),
    passingScore: z.coerce.number().catch(70),
    criticalCriteria: z.array(z.string()).catch([]),
});
export type QARubric = z.infer<typeof QARubricSchema>;

export const DeliverableItemSchema = z.object({
    sectionId: z.string(),
    includeInWord: z.coerce.boolean().catch(true),
    includeInPpt: z.coerce.boolean().catch(false),
    includeInPptAs: z.enum(['slide', 'bullet', 'skip']).optional().catch(undefined),
    includeInExcel: z.coerce.boolean().catch(false),
    excelSheetName: z.string().optional().catch(undefined),
});
export type DeliverableItem = z.infer<typeof DeliverableItemSchema>;

export const DeliverableMapSchema = z.object({
    items: z.array(DeliverableItemSchema).catch([]),
    wordConfig: z.object({
        includeToc: z.coerce.boolean().catch(true),
        includeExecutiveSummary: z.coerce.boolean().catch(true),
        includeBibliography: z.coerce.boolean().catch(true),
    }).catch({ includeToc: true, includeExecutiveSummary: true, includeBibliography: true }),
    pptConfig: z.object({
        totalSlides: z.coerce.number().catch(10),
        includeAgenda: z.coerce.boolean().catch(true),
        includeConclusion: z.coerce.boolean().catch(true),
        storyArc: z.array(z.string()).catch([]),
    }).catch({ totalSlides: 10, includeAgenda: true, includeConclusion: true, storyArc: [] }),
    excelConfig: z.object({
        sheets: z.array(z.string()).catch([]),
        includeDataDictionary: z.coerce.boolean().catch(false),
        includeCharts: z.coerce.boolean().catch(false),
    }).catch({ sheets: [], includeDataDictionary: false, includeCharts: false }),
});
export type DeliverableMap = z.infer<typeof DeliverableMapSchema>;

export interface BlueprintResult {
    outline: OutlineSpec;
    researchPlan: ResearchPlan;
    qaRubric: QARubric;
    deliverableMap: DeliverableMap;
}

// ============================================================================
// Templates Library
// ============================================================================

const DOCUMENT_TEMPLATES: Record<DocumentIntent, Partial<OutlineSpec>> = {
    report: {
        sections: [
            { id: 's1', title: 'Resumen Ejecutivo', level: 1, type: 'executive_summary', objective: 'Síntesis de hallazgos clave', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Introducción', level: 1, type: 'introduction', objective: 'Contexto y objetivos', targetWordCount: 400, requiresResearch: true, requiresData: false },
            { id: 's3', title: 'Metodología', level: 1, type: 'methodology', objective: 'Enfoque y fuentes', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's4', title: 'Análisis', level: 1, type: 'analysis', objective: 'Análisis detallado', targetWordCount: 1200, requiresResearch: true, requiresData: true },
            { id: 's5', title: 'Hallazgos', level: 1, type: 'findings', objective: 'Resultados principales', targetWordCount: 800, requiresResearch: true, requiresData: true },
            { id: 's6', title: 'Conclusiones', level: 1, type: 'conclusions', objective: 'Síntesis final', targetWordCount: 400, requiresResearch: false, requiresData: false },
            { id: 's7', title: 'Recomendaciones', level: 1, type: 'recommendations', objective: 'Acciones sugeridas', targetWordCount: 400, requiresResearch: false, requiresData: false },
        ],
    },
    thesis: {
        sections: [
            { id: 's1', title: 'Abstract', level: 1, type: 'executive_summary', objective: 'Resumen académico', targetWordCount: 250, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Introducción', level: 1, type: 'introduction', objective: 'Planteamiento del problema', targetWordCount: 1500, requiresResearch: true, requiresData: false },
            { id: 's3', title: 'Marco Teórico', level: 1, type: 'context', objective: 'Revisión de literatura', targetWordCount: 3000, requiresResearch: true, requiresData: false },
            { id: 's4', title: 'Metodología', level: 1, type: 'methodology', objective: 'Diseño de investigación', targetWordCount: 1500, requiresResearch: false, requiresData: true },
            { id: 's5', title: 'Resultados', level: 1, type: 'results', objective: 'Datos y análisis', targetWordCount: 2500, requiresResearch: false, requiresData: true },
            { id: 's6', title: 'Discusión', level: 1, type: 'discussion', objective: 'Interpretación', targetWordCount: 2000, requiresResearch: true, requiresData: false },
            { id: 's7', title: 'Conclusiones', level: 1, type: 'conclusions', objective: 'Contribuciones', targetWordCount: 1000, requiresResearch: false, requiresData: false },
            { id: 's8', title: 'Bibliografía', level: 1, type: 'bibliography', objective: 'Referencias', targetWordCount: 0, requiresResearch: false, requiresData: false },
        ],
    },
    proposal: {
        sections: [
            { id: 's1', title: 'Resumen Ejecutivo', level: 1, type: 'executive_summary', objective: 'Propuesta en síntesis', targetWordCount: 400, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Contexto y Problema', level: 1, type: 'introduction', objective: 'Situación actual', targetWordCount: 600, requiresResearch: true, requiresData: false },
            { id: 's3', title: 'Solución Propuesta', level: 1, type: 'analysis', objective: 'Descripción de la solución', targetWordCount: 1000, requiresResearch: false, requiresData: false },
            { id: 's4', title: 'Plan de Implementación', level: 1, type: 'methodology', objective: 'Cronograma y recursos', targetWordCount: 800, requiresResearch: false, requiresData: true },
            { id: 's5', title: 'Inversión y ROI', level: 1, type: 'findings', objective: 'Costos y beneficios', targetWordCount: 600, requiresResearch: false, requiresData: true },
            { id: 's6', title: 'Próximos Pasos', level: 1, type: 'recommendations', objective: 'Acciones inmediatas', targetWordCount: 300, requiresResearch: false, requiresData: false },
        ],
    },
    analysis: {
        sections: [
            { id: 's1', title: 'Resumen', level: 1, type: 'executive_summary', objective: 'Hallazgos clave', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Contexto', level: 1, type: 'context', objective: 'Antecedentes', targetWordCount: 500, requiresResearch: true, requiresData: false },
            { id: 's3', title: 'Datos y Metodología', level: 1, type: 'methodology', objective: 'Fuentes de datos', targetWordCount: 400, requiresResearch: false, requiresData: true },
            { id: 's4', title: 'Análisis Detallado', level: 1, type: 'analysis', objective: 'Examen profundo', targetWordCount: 1500, requiresResearch: true, requiresData: true },
            { id: 's5', title: 'Hallazgos', level: 1, type: 'findings', objective: 'Resultados', targetWordCount: 800, requiresResearch: false, requiresData: true },
            { id: 's6', title: 'Implicaciones', level: 1, type: 'conclusions', objective: 'Significado', targetWordCount: 500, requiresResearch: false, requiresData: false },
        ],
    },
    presentation: {
        sections: [
            { id: 's1', title: 'Título', level: 1, type: 'executive_summary', objective: 'Portada', targetWordCount: 50, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Agenda', level: 1, type: 'introduction', objective: 'Estructura', targetWordCount: 100, requiresResearch: false, requiresData: false },
            { id: 's3', title: 'Contexto', level: 1, type: 'context', objective: 'Situación', targetWordCount: 200, requiresResearch: true, requiresData: false },
            { id: 's4', title: 'Hallazgos Clave', level: 1, type: 'findings', objective: 'Insights principales', targetWordCount: 400, requiresResearch: true, requiresData: true },
            { id: 's5', title: 'Recomendaciones', level: 1, type: 'recommendations', objective: 'Acciones', targetWordCount: 200, requiresResearch: false, requiresData: false },
            { id: 's6', title: 'Cierre', level: 1, type: 'conclusions', objective: 'Resumen y Q&A', targetWordCount: 100, requiresResearch: false, requiresData: false },
        ],
    },
    plan: {
        sections: [
            { id: 's1', title: 'Visión General', level: 1, type: 'executive_summary', objective: 'Objetivo del plan', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Situación Actual', level: 1, type: 'context', objective: 'Diagnóstico', targetWordCount: 500, requiresResearch: true, requiresData: true },
            { id: 's3', title: 'Objetivos', level: 1, type: 'findings', objective: 'Metas SMART', targetWordCount: 400, requiresResearch: false, requiresData: false },
            { id: 's4', title: 'Estrategia', level: 1, type: 'analysis', objective: 'Enfoque', targetWordCount: 600, requiresResearch: false, requiresData: false },
            { id: 's5', title: 'Cronograma', level: 1, type: 'methodology', objective: 'Timeline', targetWordCount: 400, requiresResearch: false, requiresData: true },
            { id: 's6', title: 'Recursos', level: 1, type: 'recommendations', objective: 'Presupuesto', targetWordCount: 400, requiresResearch: false, requiresData: true },
            { id: 's7', title: 'KPIs', level: 1, type: 'conclusions', objective: 'Métricas', targetWordCount: 300, requiresResearch: false, requiresData: true },
        ],
    },
    audit: {
        sections: [
            { id: 's1', title: 'Resumen Ejecutivo', level: 1, type: 'executive_summary', objective: 'Conclusiones clave', targetWordCount: 400, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Alcance', level: 1, type: 'introduction', objective: 'Áreas auditadas', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's3', title: 'Metodología', level: 1, type: 'methodology', objective: 'Criterios de auditoría', targetWordCount: 400, requiresResearch: false, requiresData: false },
            { id: 's4', title: 'Hallazgos', level: 1, type: 'findings', objective: 'Observaciones', targetWordCount: 1500, requiresResearch: true, requiresData: true },
            { id: 's5', title: 'Análisis de Riesgos', level: 1, type: 'analysis', objective: 'Evaluación', targetWordCount: 800, requiresResearch: false, requiresData: true },
            { id: 's6', title: 'Recomendaciones', level: 1, type: 'recommendations', objective: 'Acciones correctivas', targetWordCount: 600, requiresResearch: false, requiresData: false },
        ],
    },
    comparison: {
        sections: [
            { id: 's1', title: 'Resumen', level: 1, type: 'executive_summary', objective: 'Conclusión comparativa', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's2', title: 'Criterios de Comparación', level: 1, type: 'methodology', objective: 'Dimensiones', targetWordCount: 400, requiresResearch: false, requiresData: false },
            { id: 's3', title: 'Análisis Comparativo', level: 1, type: 'analysis', objective: 'Comparación detallada', targetWordCount: 1200, requiresResearch: true, requiresData: true },
            { id: 's4', title: 'Matriz Comparativa', level: 1, type: 'findings', objective: 'Tabla resumen', targetWordCount: 300, requiresResearch: false, requiresData: true },
            { id: 's5', title: 'Recomendación', level: 1, type: 'recommendations', objective: 'Mejor opción', targetWordCount: 400, requiresResearch: false, requiresData: false },
        ],
    },
    executive_summary: {
        sections: [
            { id: 's1', title: 'Contexto', level: 1, type: 'context', objective: 'Situación', targetWordCount: 200, requiresResearch: true, requiresData: false },
            { id: 's2', title: 'Hallazgos Clave', level: 1, type: 'findings', objective: 'Insights', targetWordCount: 400, requiresResearch: true, requiresData: true },
            { id: 's3', title: 'Implicaciones', level: 1, type: 'analysis', objective: 'Significado', targetWordCount: 300, requiresResearch: false, requiresData: false },
            { id: 's4', title: 'Recomendaciones', level: 1, type: 'recommendations', objective: 'Acciones', targetWordCount: 300, requiresResearch: false, requiresData: false },
        ],
    },
};

// ============================================================================
// Default QA Rubric
// ============================================================================

const DEFAULT_QA_CRITERIA: QACriterion[] = [
    { id: 'structure', name: 'Estructura Completa', description: 'Todas las secciones requeridas están presentes', weight: 0.15, checkType: 'automated', threshold: 100 },
    { id: 'coherence', name: 'Coherencia Lógica', description: 'El documento sigue un flujo lógico', weight: 0.15, checkType: 'llm', threshold: 75 },
    { id: 'citations', name: 'Citas Válidas', description: 'Las afirmaciones tienen soporte', weight: 0.15, checkType: 'automated', threshold: 80 },
    { id: 'completeness', name: 'Completitud', description: 'Cada sección cumple su objetivo', weight: 0.15, checkType: 'llm', threshold: 70 },
    { id: 'consistency', name: 'Consistencia Cruzada', description: 'Word, Excel y PPT son coherentes', weight: 0.20, checkType: 'automated', threshold: 90 },
    { id: 'tone', name: 'Tono Apropiado', description: 'El tono es adecuado para la audiencia', weight: 0.10, checkType: 'llm', threshold: 75 },
    { id: 'length', name: 'Extensión Adecuada', description: 'Cumple los límites de longitud', weight: 0.10, checkType: 'automated', threshold: 85 },
];

// ============================================================================
// Blueprint Agent
// ============================================================================

export async function generateBlueprint(workOrder: WorkOrder): Promise<BlueprintResult> {
    console.log(`[BlueprintAgent] Generating blueprint for: ${workOrder.topic}`);

    // 1. Get base template
    const baseTemplate = DOCUMENT_TEMPLATES[workOrder.intent];

    // 2. Customize outline with LLM
    const outline = await customizeOutline(workOrder, baseTemplate);

    // 3. Generate research plan
    const researchPlan = await generateResearchPlan(workOrder, outline);

    // 4. Build QA rubric
    const qaRubric = buildQARubric(workOrder);

    // 5. Create deliverable map
    const deliverableMap = createDeliverableMap(workOrder, outline);

    return {
        outline,
        researchPlan,
        qaRubric,
        deliverableMap,
    };
}

async function customizeOutline(
    workOrder: WorkOrder,
    baseTemplate: Partial<OutlineSpec>
): Promise<OutlineSpec> {
    const prompt = `Personaliza esta estructura de documento para el siguiente trabajo:

TEMA: ${workOrder.topic}
TIPO: ${workOrder.intent}
AUDIENCIA: ${workOrder.audience}
TONO: ${workOrder.tone}
LÍMITE: ${workOrder.constraints.maxPages || 20} páginas

ESTRUCTURA BASE:
${JSON.stringify(baseTemplate.sections, null, 2)}

Responde en JSON con:
{
  "title": "Título del documento",
  "subtitle": "Subtítulo opcional",
  "sections": [
    {
      "id": "s1",
      "title": "Título de sección",
      "level": 1,
      "type": "tipo de sección",
      "objective": "Qué debe lograr esta sección",
      "targetWordCount": número,
      "requiresResearch": boolean,
      "requiresData": boolean,
      "children": [] // subsecciones opcionales
    }
  ],
  "totalTargetWords": número total,
  "estimatedPages": número de páginas
}

Adapta los títulos y objetivos al tema específico. Añade subsecciones si es necesario.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 2000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            return OutlineSpecSchema.parse(parsed);
        }
    } catch (error) {
        console.error('[BlueprintAgent] Failed to customize outline:', error);
    }

    // Fallback to base template
    return {
        title: workOrder.topic,
        sections: baseTemplate.sections as Section[],
        totalTargetWords: baseTemplate.sections?.reduce((acc, s) => acc + (s.targetWordCount || 0), 0) || 3000,
        estimatedPages: Math.ceil((baseTemplate.sections?.reduce((acc, s) => acc + (s.targetWordCount || 0), 0) || 3000) / 400),
    };
}

async function generateResearchPlan(
    workOrder: WorkOrder,
    outline: OutlineSpec
): Promise<ResearchPlan> {
    if (workOrder.sourcePolicy === 'none') {
        return {
            queries: [],
            expectedSources: 0,
            researchScope: 'Sin investigación (síntesis basada en conocimiento general)',
            limitations: ['Este documento no incluye investigación de fuentes externas'],
        };
    }

    const sectionsNeedingResearch = outline.sections.filter(s => s.requiresResearch);

    const prompt = `Genera un plan de investigación para este documento:

TEMA: ${workOrder.topic}
SECCIONES QUE REQUIEREN INVESTIGACIÓN:
${sectionsNeedingResearch.map(s => `- ${s.title}: ${s.objective}`).join('\n')}

POLÍTICA DE FUENTES: ${workOrder.sourcePolicy}

Responde en JSON:
{
  "queries": [
    {
      "id": "q1",
      "query": "búsqueda concreta",
      "purpose": "para qué sirve",
      "targetSections": ["s1", "s2"],
      "sourceType": "web|internal|academic|any",
      "priority": "critical|important|optional"
    }
  ],
  "expectedSources": número de fuentes esperadas,
  "researchScope": "descripción del alcance",
  "limitations": ["limitación 1", "limitación 2"]
}

Genera entre 5-15 queries específicas y buscables.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 1500,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            return ResearchPlanSchema.parse(JSON.parse(content));
        }
    } catch (error) {
        console.error('[BlueprintAgent] Failed to generate research plan:', error);
    }

    // Fallback
    return {
        queries: [{
            id: 'q1',
            query: workOrder.topic,
            purpose: 'Investigación general del tema',
            targetSections: sectionsNeedingResearch.map(s => s.id),
            sourceType: 'any',
            priority: 'critical',
        }],
        expectedSources: 5,
        researchScope: 'Investigación general',
        limitations: ['Plan de investigación generado automáticamente'],
    };
}

function buildQARubric(workOrder: WorkOrder): QARubric {
    const criteria = [...DEFAULT_QA_CRITERIA];

    // Adjust based on document type
    if (workOrder.intent === 'thesis') {
        criteria.find(c => c.id === 'citations')!.weight = 0.25;
        criteria.find(c => c.id === 'citations')!.threshold = 90;
    }

    if (workOrder.intent === 'presentation') {
        criteria.find(c => c.id === 'length')!.weight = 0.20;
        criteria.push({
            id: 'visual_density',
            name: 'Densidad Visual',
            description: 'Slides no sobrecargados',
            weight: 0.10,
            checkType: 'automated',
            threshold: 80,
        });
    }

    // Critical criteria
    const criticalCriteria = ['structure', 'consistency'];
    if (workOrder.citationStyle !== 'none') {
        criticalCriteria.push('citations');
    }

    return {
        criteria,
        passingScore: 70,
        criticalCriteria,
    };
}

function createDeliverableMap(workOrder: WorkOrder, outline: OutlineSpec): DeliverableMap {
    const items: DeliverableItem[] = outline.sections.map(section => ({
        sectionId: section.id,
        includeInWord: workOrder.deliverables.includes('word'),
        includeInPpt: workOrder.deliverables.includes('ppt') && section.type !== 'bibliography',
        includeInPptAs: getPptSlideType(section),
        includeInExcel: workOrder.deliverables.includes('excel') && section.requiresData,
        excelSheetName: section.requiresData ? `Datos_${section.title.substring(0, 20)}` : undefined,
    }));

    // PPT story arc
    const storyArc = [
        'Título y Contexto',
        'Problema/Oportunidad',
        'Análisis y Evidencia',
        'Hallazgos Clave',
        'Implicaciones',
        'Recomendaciones',
        'Cierre y Q&A',
    ];

    return {
        items,
        wordConfig: {
            includeToc: outline.sections.length > 5,
            includeExecutiveSummary: outline.sections.some(s => s.type === 'executive_summary'),
            includeBibliography: workOrder.citationStyle !== 'none',
        },
        pptConfig: {
            totalSlides: Math.min(workOrder.constraints.maxSlides || 15, 20),
            includeAgenda: true,
            includeConclusion: true,
            storyArc,
        },
        excelConfig: {
            sheets: outline.sections.filter(s => s.requiresData).map(s => s.title),
            includeDataDictionary: true,
            includeCharts: true,
        },
    };
}

function getPptSlideType(section: Section): 'slide' | 'bullet' | 'skip' {
    switch (section.type) {
        case 'executive_summary':
        case 'introduction':
        case 'findings':
        case 'conclusions':
        case 'recommendations':
            return 'slide';
        case 'methodology':
        case 'context':
        case 'analysis':
            return 'bullet';
        case 'bibliography':
        case 'appendix':
            return 'skip';
        default:
            return 'bullet';
    }
}

export { DOCUMENT_TEMPLATES, DEFAULT_QA_CRITERIA };
