import { unifiedEventBus } from '../agent/unifiedEventBus';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';

export interface FrameAnalysis {
    windows: any[];
    uiElements: any[];
    textContent: Record<string, string>;
    semanticState: string;
    actionableItems: any[];
}

const FRAME_ANALYSIS_PROMPT = `
You are a precise desktop UI analyzer and OCR engine. Given this screenshot, extract a structured analysis.
Pay special attention to extracting ALL visible text content through OCR.
Respond ONLY with a valid JSON object matching the following schema exactly (no markdown blocks, just the raw JSON text):

{
  "windows": [{"appName": "string", "title": "string", "isFocused": boolean}],
  "uiElements": [{"type": "string", "text": "string", "bbox": [x,y,w,h]}],
  "textContent": {"region_or_element_description": "the exact OCR extracted text here"},
  "semanticState": "One-sentence description of the user's current activity",
  "actionableItems": [{"action": "click|type", "target": "element_description", "reason": "why"}]
}
`;

export class ElementDetector {
    private modelName = 'gemini-2.5-flash';

    async analyzeFrame(base64Frame: string, context?: any): Promise<FrameAnalysis> {
        try {
            const llm = new ChatGoogleGenerativeAI({
                model: this.modelName,
                temperature: 0.1,
            });

            const imageMessage = new HumanMessage({
                content: [
                    { type: "text", text: FRAME_ANALYSIS_PROMPT },
                    {
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${base64Frame}` }
                    }
                ]
            });

            const response = await llm.invoke([imageMessage]);
            let contentStr = response.content as string;

            // Limpieza básica de backticks en caso de que el LLM devuelva markdown JSON
            if (contentStr.startsWith('```json')) {
                contentStr = contentStr.replace(/```json\n?/, '').replace(/```\n?$/, '');
            } else if (contentStr.startsWith('```')) {
                contentStr = contentStr.replace(/```\n?/, '').replace(/```\n?$/, '');
            }

            const analysis: FrameAnalysis = JSON.parse(contentStr.trim());

            // Dispatch async
            unifiedEventBus.emit('trace', {
                type: 'vision.frame.analyzed',
                runId: 'system-vision-loop',
                timestamp: Date.now(),
                metadata: { analysis }
            });

            return analysis;
        } catch (e: any) {
            console.error("[ElementDetector] Fallo de inferencia VLM:", e.message);
            // Default robusto para mantener el loop vivo
            return {
                windows: [],
                uiElements: [],
                textContent: {},
                semanticState: "Analysis failed or unclear.",
                actionableItems: []
            };
        }
    }
}

export const elementDetector = new ElementDetector();
