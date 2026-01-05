/**
 * TypeScript client for the Python AI Agent v5.0 service.
 * Provides methods to interact with the FastAPI service running on port 8081.
 */

const PYTHON_AGENT_BASE_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8081';
const DEFAULT_TIMEOUT = 120000; // 2 minutes

interface RunAgentRequest {
  input: string;
  verbose?: boolean;
  timeout?: number;
}

interface AgentStatus {
  name: string;
  version: string;
  state: string;
  tools: number;
  browser: string;
}

interface RunAgentResponse {
  success: boolean;
  result: string | null;
  error: string | null;
  execution_time: number;
  status: AgentStatus;
}

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, any>;
}

interface ToolsResponse {
  tools: ToolInfo[];
  count: number;
}

interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  agent_state: string;
  tools_count: number;
}

class PythonAgentClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'PythonAgentClientError';
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new PythonAgentClientError(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute the Python agent with user input.
 */
export async function runAgent(
  input: string,
  options: { verbose?: boolean; timeout?: number } = {}
): Promise<RunAgentResponse> {
  const { verbose = false, timeout = 60 } = options;
  
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        verbose,
        timeout,
      } as RunAgentRequest),
      timeout: (timeout + 10) * 1000, // Add buffer for HTTP overhead
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }
    
    return await response.json() as RunAgentResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new PythonAgentClientError(
        'Python agent service is not running. Start it with: python run_service.py'
      );
    }
    throw new PythonAgentClientError(
      `Failed to connect to Python agent: ${error.message}`
    );
  }
}

/**
 * Get the list of available tools from the Python agent.
 */
export async function getTools(): Promise<ToolsResponse> {
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/tools`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 seconds should be enough for tools list
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }
    
    return await response.json() as ToolsResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new PythonAgentClientError(
        'Python agent service is not running. Start it with: python run_service.py'
      );
    }
    throw new PythonAgentClientError(
      `Failed to get tools from Python agent: ${error.message}`
    );
  }
}

/**
 * Check if the Python agent service is healthy.
 */
export async function healthCheck(): Promise<HealthResponse> {
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000, // 5 seconds for health check
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }
    
    return await response.json() as HealthResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new PythonAgentClientError(
        'Python agent service is not running',
        503
      );
    }
    throw new PythonAgentClientError(
      `Health check failed: ${error.message}`,
      503
    );
  }
}

/**
 * Check if the Python agent service is available.
 * Returns true if healthy, false otherwise (doesn't throw).
 */
export async function isServiceAvailable(): Promise<boolean> {
  try {
    await healthCheck();
    return true;
  } catch {
    return false;
  }
}

export type {
  RunAgentRequest,
  RunAgentResponse,
  ToolInfo,
  ToolsResponse,
  HealthResponse,
  AgentStatus,
};

export { PythonAgentClientError };
