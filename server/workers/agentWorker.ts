import { Worker, Job } from 'bullmq';
import { runEmbeddedPiAgent } from '../openclaw/src/agents/pi-embedded-runner/run';
import { Logger } from '../utils/logger'; // Asumiendo que tienes un logger en utils
import * as path from 'path';
import { resolveAgentRole } from '../services/agentControlPlane';

const logger = new Logger('AgentWorker');

const MODEL_CONFIG = {
  research: resolveAgentRole('research'),
  coding: resolveAgentRole('brain'),
  creative: resolveAgentRole('search_memory'),
  fast: resolveAgentRole('speed'),
  vision: resolveAgentRole('video'),
  default: resolveAgentRole('brain')
} as const;

interface AgentTask {
  taskId: string;
  type: keyof typeof MODEL_CONFIG;
  instruction: string;
  context?: any;
  sessionId?: string;
}

export const agentWorker = new Worker<AgentTask>('agent-tasks', async (job: Job<AgentTask>) => {
  const { taskId, type, instruction, sessionId } = job.data;
  const taskType = type || 'default';
  
  logger.info(`[${taskId}] Iniciando tarea Agente: ${taskType}`);

  try {
    // 1. Seleccionar configuración de modelo
    const modelConfig = MODEL_CONFIG[taskType] || MODEL_CONFIG.default;
    
    // 2. Definir workspace único para esta tarea
    const workspaceDir = path.resolve(process.cwd(), 'data', 'workspaces', sessionId || taskId);

    // 3. Ejecutar OpenClaw en modo "Embedded" (Fusión)
    const result = await runEmbeddedPiAgent({
      prompt: instruction,
      sessionId: sessionId || `task-${taskId}`,
      sessionKey: sessionId || `task-${taskId}`, // Clave para persistencia
      provider: modelConfig.provider as any,
      model: modelConfig.target,
      workspaceDir: workspaceDir,
      
      // Configuraciones adicionales para autonomía
      verboseLevel: 1, // Logs detallados
      thinkLevel: 'smart', // Razonamiento activado
      
      // Integración con herramientas locales
      config: {
        // Aquí podrías inyectar configuración extra si fuera necesario
      }
    });

    logger.info(`[${taskId}] Tarea completada. Resultados:`, result.meta);
    return result;

  } catch (error) {
    logger.error(`[${taskId}] Error crítico en Agente:`, error);
    throw error;
  }
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  concurrency: 3 // Límite de agentes simultáneos
});

logger.info('AgentWorker (OpenClaw Fusion) listo y esperando misiones...');
