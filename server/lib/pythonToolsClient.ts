import axios, { AxiosInstance, AxiosError } from 'axios';

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  priority: string;
  dependencies: string[];
}

interface ToolExecuteResponse {
  success: boolean;
  data: any;
  error?: string;
  metadata: Record<string, any>;
}

interface AgentInfo {
  name: string;
  description: string;
  category: string;
  tools_used: string[];
}

interface HealthResponse {
  status: string;
  tools_count: number;
  agents_count?: number;
}

export class PythonToolsClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'PythonToolsClientError';
  }
}

export class PythonToolsClient {
  private client: AxiosInstance;
  private baseUrl: string;
  
  constructor(baseUrl: string = 'http://localhost:8001') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private handleError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorData = axiosError.response?.data as any;
      
      console.error(`[PythonToolsClient] ${operation} failed:`, {
        statusCode,
        message: axiosError.message,
        details: errorData
      });
      
      throw new PythonToolsClientError(
        errorData?.detail || errorData?.error || axiosError.message,
        statusCode,
        errorData
      );
    }
    
    console.error(`[PythonToolsClient] ${operation} failed with unknown error:`, error);
    throw new PythonToolsClientError(
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
  
  async health(): Promise<HealthResponse> {
    try {
      const { data } = await this.client.get('/health');
      return data;
    } catch (error) {
      this.handleError(error, 'health check');
    }
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }
  
  async listTools(): Promise<ToolInfo[]> {
    try {
      const { data } = await this.client.get('/tools');
      return data;
    } catch (error) {
      this.handleError(error, 'list tools');
    }
  }
  
  async getTool(name: string): Promise<ToolInfo> {
    try {
      const { data } = await this.client.get(`/tools/${encodeURIComponent(name)}`);
      return data;
    } catch (error) {
      this.handleError(error, `get tool '${name}'`);
    }
  }
  
  async executeTool(name: string, input: Record<string, any>): Promise<ToolExecuteResponse> {
    try {
      console.log(`[PythonToolsClient] Executing tool '${name}' with input:`, input);
      
      const { data } = await this.client.post(`/tools/${encodeURIComponent(name)}/execute`, {
        tool_name: name,
        input
      });
      
      console.log(`[PythonToolsClient] Tool '${name}' execution completed:`, {
        success: data.success,
        hasData: !!data.data,
        hasError: !!data.error
      });
      
      return data;
    } catch (error) {
      this.handleError(error, `execute tool '${name}'`);
    }
  }
  
  async listAgents(): Promise<AgentInfo[]> {
    try {
      const { data } = await this.client.get('/agents');
      return data;
    } catch (error) {
      this.handleError(error, 'list agents');
    }
  }
  
  async getAgent(name: string): Promise<AgentInfo> {
    try {
      const { data } = await this.client.get(`/agents/${encodeURIComponent(name)}`);
      return data;
    } catch (error) {
      this.handleError(error, `get agent '${name}'`);
    }
  }
  
  async executeAgent(
    name: string, 
    task: string, 
    context?: Record<string, any>
  ): Promise<any> {
    try {
      console.log(`[PythonToolsClient] Executing agent '${name}' with task:`, task);
      
      const { data } = await this.client.post(`/agents/${encodeURIComponent(name)}/execute`, {
        task,
        context
      });
      
      console.log(`[PythonToolsClient] Agent '${name}' execution completed`);
      
      return data;
    } catch (error) {
      this.handleError(error, `execute agent '${name}'`);
    }
  }
  
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const pythonToolsClient = new PythonToolsClient(
  process.env.PYTHON_TOOLS_API_URL || 'http://localhost:8001'
);

export type { ToolInfo, ToolExecuteResponse, AgentInfo, HealthResponse };
