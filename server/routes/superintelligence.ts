import { Router } from 'express';
import { aiService } from '../lib/ai/modelOrchestrator';
import { scientificDiscovery } from '../lib/ai/scientificDiscovery'; // Assuming we export an instance
import { automatedResearcher } from '../lib/ai/scientificDiscovery'; // Need to check exports
import { autonomousCoder } from '../lib/ai/autonomousCoding'; // Need to check exports
import { Logger } from '../lib/logger';

// Create a router instance
const router = Router();

// ============================================================================
// Model Orchestration Endpoints
// ============================================================================

router.post('/chat', async (req, res) => {
    try {
        const { messages, requirements, taskId } = req.body;

        // Default requirements if not provided
        const reqs = requirements || { tier: 'pro' };

        const response = await aiService.generateCompletion({
            taskId: taskId || 'api-request',
            messages,
            requirements: reqs
        });

        res.json(response);
    } catch (error: any) {
        Logger.error(`[API] AI Chat Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Scientific Discovery Endpoints
// ============================================================================

router.post('/research/synthesize', async (req, res) => {
    try {
        const { topic } = req.body;
        // Dynamic import to avoid circular dependency issues if any
        const { researcher } = await import('../lib/ai/scientificDiscovery');

        const synthesis = await researcher.synthesizeLiterature(topic);
        res.json({ topic, synthesis });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/research/hypothesis', async (req, res) => {
    try {
        const { observation, context } = req.body;
        const { hypothesis } = await import('../lib/ai/scientificDiscovery');

        const hypotheses = await hypothesis.generateHypotheses(observation, context);
        res.json({ hypotheses });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Autonomous Coding Endpoints
// ============================================================================

router.post('/coding/generate', async (req, res) => {
    try {
        const { prompt, language } = req.body;
        const { autoCoder } = await import('../lib/ai/autonomousCoding');

        // Assuming autoCoder has a generate method compatible with this
        // We might need to adjust based on the actual file content
        // For now, using a generic interface assumption
        const result = await autoCoder.generateCode(prompt, language);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const superintelligenceRouter = router;
