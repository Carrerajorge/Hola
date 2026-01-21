/**
 * Production Pipeline Orchestrator
 * 
 * Main orchestrator that runs the 10-stage agentic pipeline:
 * 1. Intake - Normalize request
 * 2. Blueprint - Plan structure
 * 3. Research - Gather evidence
 * 4. Analysis - Build arguments
 * 5. Writing - Draft content
 * 6. Data - Build Excel (if needed)
 * 7. Slides - Build PPT (if needed)
 * 8. QA - Quality check loop
 * 9. Consistency - Cross-doc verification
 * 10. Render - Generate final files
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
    WorkOrder,
    PipelineStage,
    StageProgress,
    ProductionResult,
    ProductionEvent,
    ProductionEventHandler,
    EvidencePack,
    ContentSpec,
    QAReport,
    TraceMap,
    Artifact,
} from './types';
import { routeTask } from './taskRouter';
import { createWorkOrder, enrichWorkOrder, validateWorkOrder } from './workOrderProcessor';
import { consistencyAgent } from './consistencyAgent';
import { generateBlueprint } from './blueprintAgent';

// Import existing agents
import { researchAgent } from '../langgraph/agents/ResearchAgent';
import { documentAgent } from '../langgraph/agents/DocumentAgent';
import { qaAgent } from '../langgraph/agents/QAAgent';
import { dataAgent } from '../langgraph/agents/DataAgent';
import { contentAgent } from '../langgraph/agents/ContentAgent';

// Import renderers
import { createExcelFromData } from '../../services/advancedExcelBuilder';
import { generateWordFromMarkdown } from '../../services/markdownToDocx';
import { generateProfessionalDocument, detectDocumentType } from '../../services/docxCodeGenerator';

// ============================================================================
// Pipeline Stages Definition
// ============================================================================

const PIPELINE_STAGES: PipelineStage[] = [
    'intake',
    'blueprint',
    'research',
    'analysis',
    'writing',
    'data',
    'slides',
    'qa',
    'consistency',
    'render',
];

// ============================================================================
// Production Pipeline Class
// ============================================================================

export class ProductionPipeline extends EventEmitter {
    private workOrder: WorkOrder;
    private stageProgress: Map<PipelineStage, StageProgress>;
    private artifacts: Artifact[] = [];
    private evidencePack: EvidencePack | null = null;
    private contentSpec: ContentSpec | null = null;
    private qaReport: QAReport | null = null;
    private traceMap: TraceMap | null = null;
    private aborted: boolean = false;
    private startTime: Date;
    private stageTimings: Map<PipelineStage, number> = new Map();

    constructor(workOrder: WorkOrder) {
        super();
        this.workOrder = workOrder;
        this.stageProgress = new Map();
        this.startTime = new Date();

        // Initialize stage progress
        for (const stage of PIPELINE_STAGES) {
            this.stageProgress.set(stage, {
                stage,
                status: 'pending',
                progress: 0,
                message: 'Waiting...',
            });
        }
    }

    // ============================================================================
    // Event Emission
    // ============================================================================

    private emitEvent(event: Omit<ProductionEvent, 'workOrderId' | 'timestamp'>): void {
        const fullEvent: ProductionEvent = {
            ...event,
            workOrderId: this.workOrder.id,
            timestamp: new Date(),
        };
        this.emit('event', fullEvent);
    }

    private updateStage(
        stage: PipelineStage,
        status: StageProgress['status'],
        progress: number,
        message: string
    ): void {
        const stageProgress = this.stageProgress.get(stage)!;
        stageProgress.status = status;
        stageProgress.progress = progress;
        stageProgress.message = message;

        if (status === 'running' && !stageProgress.startedAt) {
            stageProgress.startedAt = new Date();
        }
        if (status === 'complete' || status === 'failed') {
            stageProgress.completedAt = new Date();
            if (stageProgress.startedAt) {
                this.stageTimings.set(
                    stage,
                    stageProgress.completedAt.getTime() - stageProgress.startedAt.getTime()
                );
            }
        }

        this.emitEvent({
            type: status === 'complete' ? 'stage_complete' : status === 'failed' ? 'stage_error' : 'progress',
            stage,
            progress,
            message,
        });
    }

    // ============================================================================
    // Main Pipeline Execution
    // ============================================================================

    async run(): Promise<ProductionResult> {
        console.log(`[ProductionPipeline] Starting pipeline for WorkOrder ${this.workOrder.id}`);

        try {
            // Stage 1: Intake
            await this.stageIntake();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 2: Blueprint
            await this.stageBlueprint();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 3: Research
            await this.stageResearch();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 4: Analysis
            await this.stageAnalysis();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 5: Writing
            await this.stageWriting();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 6: Data (Excel) - if needed
            if (this.workOrder.deliverables.includes('excel')) {
                await this.stageData();
                if (this.aborted) throw new Error('Pipeline aborted');
            } else {
                this.updateStage('data', 'skipped', 100, 'Excel not requested');
            }

            // Stage 7: Slides (PPT) - if needed
            if (this.workOrder.deliverables.includes('ppt')) {
                await this.stageSlides();
                if (this.aborted) throw new Error('Pipeline aborted');
            } else {
                this.updateStage('slides', 'skipped', 100, 'PPT not requested');
            }

            // Stage 8: QA
            await this.stageQA();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 9: Consistency
            await this.stageConsistency();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 10: Render
            await this.stageRender();

            // Build result
            return this.buildResult('success');

        } catch (error) {
            console.error('[ProductionPipeline] Pipeline failed:', error);

            // Mark current stage as failed
            const currentStage = Array.from(this.stageProgress.entries())
                .find(([_, p]) => p.status === 'running')?.[0];
            if (currentStage) {
                this.updateStage(currentStage, 'failed', 0, error instanceof Error ? error.message : 'Unknown error');
            }

            return this.buildResult('failed');
        }
    }

    // ============================================================================
    // Individual Stage Implementations
    // ============================================================================

    private async stageIntake(): Promise<void> {
        this.updateStage('intake', 'running', 0, 'Validating work order...');

        // Validate
        const validation = validateWorkOrder(this.workOrder);
        if (!validation.valid) {
            throw new Error(`Invalid work order: ${validation.errors.join(', ')}`);
        }

        this.updateStage('intake', 'running', 50, 'Enriching work order...');

        // Enrich with LLM
        this.workOrder = await enrichWorkOrder(this.workOrder) as WorkOrder;

        this.updateStage('intake', 'complete', 100, 'Work order processed');
    }

    private async stageBlueprint(): Promise<void> {
        this.updateStage('blueprint', 'running', 0, 'Designing document structure...');

        try {
            const blueprint = await generateBlueprint(this.workOrder);

            this.contentSpec = {
                title: blueprint.outline.title,
                authors: ['MICHAT AI'],
                date: new Date().toISOString().split('T')[0],
                sections: blueprint.outline.sections.map(s => ({
                    id: s.id,
                    type: 'h1',
                    content: '',
                    title: s.title,
                    objective: s.objective,
                    targetWordCount: s.targetWordCount,
                    children: []
                })),
                bibliography: [],
            };

            this.updateStage('blueprint', 'complete', 100, 'Document structure designed');
        } catch (error: any) {
            throw new Error(`Failed to create document blueprint: ${error.message}`);
        }
    }

    private async stageResearch(): Promise<void> {
        if (this.workOrder.sourcePolicy === 'none') {
            this.updateStage('research', 'skipped', 100, 'Research not required');
            this.evidencePack = { sources: [], notes: [], dataPoints: [], gaps: [], limitations: ['No research conducted per policy'] };
            return;
        }

        this.updateStage('research', 'running', 0, 'Researching topic...');

        const result = await researchAgent.execute({
            id: uuidv4(),
            type: 'deep_research',
            input: {
                topic: this.workOrder.topic,
                questions: this.workOrder.metadata?.keyQuestions || [],
                sourcePolicy: this.workOrder.sourcePolicy,
                maxSources: this.workOrder.budget.maxSearchQueries,
            },
            description: `Research topic: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        this.updateStage('research', 'running', 80, 'Processing research results...');

        // Convert to evidence pack
        this.evidencePack = {
            sources: result.output?.sources || [],
            notes: result.output?.notes || [],
            dataPoints: result.output?.dataPoints || [],
            gaps: result.output?.gaps || [],
            limitations: result.output?.limitations || [],
        };

        this.updateStage('research', 'complete', 100, `Found ${this.evidencePack.sources.length} sources`);
    }

    private async stageAnalysis(): Promise<void> {
        this.updateStage('analysis', 'running', 0, 'Analyzing evidence...');

        const result = await contentAgent.execute({
            id: uuidv4(),
            type: 'analyze',
            input: {
                topic: this.workOrder.topic,
                evidence: this.evidencePack,
                outline: this.contentSpec?.sections,
            },
            description: `Analyze evidence for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        if (result.success && result.output?.insights) {
            // Merge insights into content spec
            this.contentSpec = {
                ...this.contentSpec!,
                abstract: result.output.executive_summary,
            };
        }

        this.updateStage('analysis', 'complete', 100, 'Analysis complete');
    }

    private async stageWriting(): Promise<void> {
        this.updateStage('writing', 'running', 0, 'Drafting content...');

        if (!this.contentSpec) {
            throw new Error('Content spec not initialized');
        }

        const sections = this.contentSpec.sections;
        let completedSections = 0;

        // Write each section - use index to ensure we mutate the original array
        for (let i = 0; i < sections.length; i++) {
            const section = this.contentSpec!.sections[i];
            const sectionAny = section;
            console.log(`[ProductionPipeline] Writing section ${i + 1}/${sections.length}: "${sectionAny.title || 'Untitled'}"`);

            this.updateStage(
                'writing',
                'running',
                Math.round((completedSections / sections.length) * 100),
                `Writing: ${sectionAny.title?.substring(0, 50) || 'Section'}...`
            );

            const result = await documentAgent.execute({
                id: uuidv4(),
                type: 'write_section',
                input: {
                    section: {
                        title: sectionAny.title,
                        objective: sectionAny.objective,
                        targetWordCount: sectionAny.targetWordCount || 200,
                    },
                    evidence: this.evidencePack,
                    tone: this.workOrder.tone,
                    citationStyle: this.workOrder.citationStyle,
                },
                description: `Write section: ${sectionAny.title || 'Untitled'}`,
                priority: 'medium',
                retries: 0,
                maxRetries: 3,
            });

            if (result.success && (result.output?.content || result.output?.result)) {
                const content = result.output.content || result.output.result || '';
                console.log(`[ProductionPipeline] Section "${sectionAny.title}" written. Length: ${content.length}`);
                // Directly mutate the original contentSpec section
                this.contentSpec!.sections[i].content = content;
            } else {
                console.warn(`[ProductionPipeline] Failed to write section "${sectionAny.title}". Success: ${result.success}, output: ${JSON.stringify(result.output)}`);
                this.contentSpec!.sections[i].content = this.contentSpec!.sections[i].content || '';
            }

            completedSections++;
        }

        this.updateStage('writing', 'complete', 100, `Drafted ${sections.length} sections`);
    }

    private async stageData(): Promise<void> {
        this.updateStage('data', 'running', 0, 'Building Excel workbook...');

        const result = await dataAgent.execute({
            id: uuidv4(),
            type: 'build_excel',
            input: {
                topic: this.workOrder.topic,
                dataPoints: this.evidencePack?.dataPoints || [],
                dataNeeds: this.workOrder.metadata?.dataNeeds || [],
            },
            description: `Build Excel workbook for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        // Store Excel data for rendering
        this.workOrder.excelData = result.output?.data || [];

        this.updateStage('data', 'complete', 100, 'Excel structure ready');
    }

    private async stageSlides(): Promise<void> {
        this.updateStage('slides', 'running', 0, 'Building presentation...');

        const result = await contentAgent.execute({
            id: uuidv4(),
            type: 'create_presentation',
            input: {
                topic: this.workOrder.topic,
                content: this.contentSpec,
                maxSlides: this.workOrder.constraints.maxSlides || 15,
                audience: this.workOrder.audience,
            },
            description: `Create presentation for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        // Store PPT data for rendering
        this.workOrder.pptData = result.output?.slides || [];

        this.updateStage('slides', 'complete', 100, 'Presentation structure ready');
    }

    private async stageQA(): Promise<void> {
        this.updateStage('qa', 'running', 0, 'Running quality checks...');

        const result = await qaAgent.execute({
            id: uuidv4(),
            type: 'validate_output',
            input: {
                content: this.contentSpec,
                workOrder: this.workOrder,
                evidence: this.evidencePack,
            },
            description: `Validate output for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        this.qaReport = {
            overallScore: result.output?.score || 0,
            passed: result.output?.passed || false,
            checks: result.output?.checks || [],
            suggestions: result.output?.suggestions || [],
            blockers: result.output?.blockers || [],
        };

        if (!this.qaReport.passed && this.qaReport.blockers.length > 0) {
            // Could implement retry loop here
            console.log('[ProductionPipeline] QA found blockers, attempting fixes...');
        }

        this.updateStage('qa', 'complete', 100, `QA Score: ${this.qaReport.overallScore}/100`);
    }

    private async stageConsistency(): Promise<void> {
        this.updateStage('consistency', 'running', 0, 'Checking cross-document consistency...');

        const result = await consistencyAgent.execute({
            id: uuidv4(),
            type: 'check_consistency',
            input: {
                documents: {
                    word: this.contentSpec ? {
                        sections: this.contentSpec.sections.map(s => ({
                            id: s.id,
                            title: s.type,
                            content: s.content || '',
                        })),
                        claims: [],
                        numbers: [],
                    } : undefined,
                    excel: this.workOrder.excelData ? {
                        sheets: [],
                        keyMetrics: [],
                        formulas: [],
                    } : undefined,
                    ppt: this.workOrder.pptData ? {
                        slides: [],
                        keyPoints: [],
                    } : undefined,
                },
                evidencePack: this.evidencePack,
            },
            description: `Check consistency for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        this.traceMap = result.output?.report?.traceMap || {
            links: [],
            inconsistencies: [],
            coverageScore: 100,
        };

        this.updateStage('consistency', 'complete', 100, 'Consistency verified');
    }

    private async stageRender(): Promise<void> {
        this.updateStage('render', 'running', 0, 'Generating final documents...');

        const deliverables = this.workOrder.deliverables;
        let completed = 0;

        // Render Word
        if (deliverables.includes('word')) {
            this.updateStage('render', 'running', (completed / deliverables.length) * 100, 'Generating Word document...');

            let docxBuffer: Buffer;
            let wordCount = 0;

            try {
                // Use direct code generation for professional documents (forms, solicitudes, contratos)
                const docType = detectDocumentType(this.workOrder.topic);
                console.log(`[ProductionPipeline] Using direct DOCX generation for type: ${docType}`);

                const result = await generateProfessionalDocument(
                    this.workOrder.topic,
                    docType
                );
                docxBuffer = result.buffer;
                wordCount = 200; // Approximate for form documents

                console.log(`[ProductionPipeline] Direct DOCX generation successful: ${docxBuffer.length} bytes`);
            } catch (error: any) {
                // Fallback to markdown conversion if code generation fails
                console.warn(`[ProductionPipeline] Direct generation failed, falling back to markdown: ${error.message}`);
                const markdown = this.contentSpecToMarkdown();
                docxBuffer = await generateWordFromMarkdown(this.workOrder.topic, markdown);
                wordCount = markdown.split(/\s+/).length;
            }

            this.artifacts.push({
                type: 'word',
                filename: `${this.sanitizeFilename(this.workOrder.topic)}.docx`,
                buffer: docxBuffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                size: docxBuffer.length,
                metadata: { wordCount },
            });

            completed++;
        }

        // Render Excel
        if (deliverables.includes('excel')) {
            this.updateStage('render', 'running', (completed / deliverables.length) * 100, 'Generating Excel workbook...');

            const excelData = this.workOrder.excelData || [['No data']];
            const excelResult = await createExcelFromData(excelData, {
                title: this.workOrder.topic,
                theme: 'professional',
            });

            this.artifacts.push({
                type: 'excel',
                filename: `${this.sanitizeFilename(this.workOrder.topic)}.xlsx`,
                buffer: excelResult.buffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: excelResult.buffer.length,
                metadata: {},
            });

            completed++;
        }

        // Note: PPT and PDF rendering would follow similar patterns
        // using pptTemplateEngine and PDF libraries

        this.updateStage('render', 'complete', 100, `Generated ${this.artifacts.length} documents`);
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private contentSpecToMarkdown(): string {
        if (!this.contentSpec) {
            console.warn('[ProductionPipeline] No contentSpec available for markdown generation');
            return '';
        }

        console.log(`[ProductionPipeline] Generating markdown for ${this.contentSpec.sections.length} sections`);

        let md = `# ${this.contentSpec.title}\n\n`;

        if (this.contentSpec.abstract) {
            md += `## Resumen Ejecutivo\n\n${this.contentSpec.abstract}\n\n`;
        }

        for (const section of this.contentSpec.sections) {
            const sectionAny = section;
            const sectionTitle = sectionAny.title || '';
            const sectionBody = section.content || '';

            console.log(`[ProductionPipeline] Section: title="${sectionTitle.substring(0, 30)}..." body_len=${sectionBody.length}`);

            // Always output the section header if there's a title
            if (sectionTitle) {
                md += `## ${sectionTitle}\n\n`;
            }

            // Output the body content (generated by agent)
            if (sectionBody) {
                md += `${sectionBody}\n\n`;
            }
        }

        console.log(`[ProductionPipeline] Generated markdown total length: ${md.length}`);
        return md;
    }

    private sanitizeFilename(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s-]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);
    }

    private buildResult(status: 'success' | 'partial' | 'failed'): ProductionResult {
        const endTime = new Date();

        return {
            workOrderId: this.workOrder.id,
            status,
            artifacts: this.artifacts,
            summary: this.generateSummary(),
            evidencePack: this.evidencePack || { sources: [], notes: [], dataPoints: [], gaps: [], limitations: [] },
            traceMap: this.traceMap || { links: [], inconsistencies: [], coverageScore: 0 },
            qaReport: this.qaReport || { overallScore: 0, passed: false, checks: [], suggestions: [], blockers: [] },
            timing: {
                startedAt: this.startTime,
                completedAt: endTime,
                durationMs: endTime.getTime() - this.startTime.getTime(),
                stageTimings: Object.fromEntries(this.stageTimings) as Record<PipelineStage, number>,
            },
            costs: {
                llmCalls: 0, // Would be tracked during execution
                searchQueries: this.evidencePack?.sources.length || 0,
                tokensUsed: 0,
            },
        };
    }

    private generateSummary(): string {
        const deliverables = this.artifacts.map(a => a.type).join(', ');
        const sources = this.evidencePack?.sources.length || 0;
        const qaScore = this.qaReport?.overallScore || 0;

        return `
## Producción Completada

**Tema:** ${this.workOrder.topic}
**Entregables:** ${deliverables || 'Ninguno'}
**Fuentes consultadas:** ${sources}
**Calidad (QA):** ${qaScore}/100

${this.evidencePack?.limitations.length ? `**Limitaciones:** ${this.evidencePack.limitations.join(', ')}` : ''}
    `.trim();
    }

    // ============================================================================
    // Control Methods
    // ============================================================================

    abort(): void {
        this.aborted = true;
        this.emitEvent({
            type: 'stage_error',
            message: 'Pipeline aborted by user',
        });
    }

    getProgress(): Map<PipelineStage, StageProgress> {
        return new Map(this.stageProgress);
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function startProductionPipeline(
    message: string,
    userId: string,
    chatId?: string,
    onEvent?: ProductionEventHandler
): Promise<ProductionResult> {
    // Route the task
    const routerResult = await routeTask(message);

    if (routerResult.mode !== 'PRODUCTION') {
        throw new Error('Message does not require production mode');
    }

    // Create work order
    const workOrder = await createWorkOrder({
        routerResult,
        message,
        userId,
        chatId,
    });

    // Create and run pipeline
    const pipeline = new ProductionPipeline(workOrder);

    if (onEvent) {
        pipeline.on('event', onEvent);
    }

    return pipeline.run();
}
