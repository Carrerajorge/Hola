import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { UnifiedUIState } from './accessibilityFusion';

export class ActionPredictor {
    async predictNextAction(uiState: UnifiedUIState, userGoal: string): Promise<string> {
        try {
            const llm = new ChatGoogleGenerativeAI({
                model: 'gemini-2.5-flash',
                temperature: 0.1,
            });

            const prompt = `
Given the user goal: "${userGoal}"
And the current UI state (JSON):
${JSON.stringify(uiState, null, 2)}

Predict the logical NEXT actionable step.
Respond ONLY with a JSON object:
{"action": "click|type|scroll|wait|done", "targetId": "logicalId_or_description", "value": "text_if_typing", "reason": "brief explanation"}
            `;

            const response = await llm.invoke(prompt);
            let contentStr = response.content as string;

            if (contentStr.startsWith('\`\`\`json')) {
                contentStr = contentStr.replace(/\`\`\`json\n?/, '').replace(/\`\`\`\n?$/, '');
            } else if (contentStr.startsWith('\`\`\`')) {
                contentStr = contentStr.replace(/\`\`\`\n?/, '').replace(/\`\`\`\n?$/, '');
            }

            const prediction = JSON.parse(contentStr.trim());
            return JSON.stringify(prediction);

        } catch (e) {
            console.error("[ActionPredictor] Inference failed:", e);
            return JSON.stringify({ action: "wait", reason: "Prediction failed, waiting." });
        }
    }
}

export const actionPredictor = new ActionPredictor();
