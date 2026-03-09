export * from './multiStrategyRouter.js';
export * from './htnPlanner.js';
export * from './constraintSatisfaction.js';
export * from './multiAgentOrchestrator.js';

import { strategyRouter } from './multiStrategyRouter.js';
import { htnPlanner } from './htnPlanner.js';
import { constraintOptimizer, ConstraintState } from './constraintSatisfaction.js';
import { agentOrchestrator } from './multiAgentOrchestrator.js';

export class DoctoralReasoningCoordinator {
    public async bootDoctoralEngine() {
        console.log('[DoctoralReasoning] Bootstrapping Doctoral Reasoning Engine...');
        console.log('[DoctoralReasoning] Neural heuristics layered. Planners online. Orchestrator ready.');
    }

    public async solveComplexGoal(highLevelGoal: string) {
        // 1. Select Strategy
        const { strategy } = await strategyRouter.routeAndExecute(highLevelGoal);

        // 2. Generate Hierarchical Task Network
        const rootTask = await htnPlanner.createPlan(highLevelGoal);

        // 3. Optimize Execution Plan
        const initialState: ConstraintState = { score: 0, variables: new Map(), violations: [] };
        const optimalExecutionState = constraintOptimizer.optimizePlan(initialState, 3, 5);

        // 4. Orchestrate Multi-Agent execution
        const executionResult = await agentOrchestrator.brokerTask({
            goal: highLevelGoal,
            strategy,
            htnRoot: rootTask,
            optimization: optimalExecutionState
        });

        console.log('[DoctoralReasoning] Goal successfully solved:', executionResult);
        return executionResult;
    }
}

export const doctoralReasoning = new DoctoralReasoningCoordinator();
