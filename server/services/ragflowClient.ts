import axios, { AxiosInstance } from "axios";

export interface RAGFlowConfig {
    baseUrl: string;
    apiKey: string;
}

export interface CreateDatasetRequest {
    name: string;
    description?: string;
}

export interface DocumentUploadResponse {
    doc_id: string;
    name: string;
    status: string;
}

export interface RAGChatRequest {
    messages: Array<{ role: "user" | "assistant" | "system", content: string }>;
    dataset_ids: string[];
}

export class RagflowClient {
    private api: AxiosInstance;

    constructor(config: RAGFlowConfig) {
        this.api = axios.create({
            baseURL: config.baseUrl,
            headers: {
                "Authorization": `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
            },
        });
    }

    async createDataset(request: CreateDatasetRequest) {
        const response = await this.api.post("/v1/api/dataset", request);
        return response.data;
    }

    async uploadDocument(datasetId: string, fileBuffer: Buffer, fileName: string): Promise<DocumentUploadResponse> {
        const formData = new FormData();
        const blob = new Blob([fileBuffer]);
        formData.append("file", blob, fileName);
        formData.append("dataset_id", datasetId);

        const response = await this.api.post("/v1/api/document", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });
        return response.data;
    }

    async chat(request: RAGChatRequest) {
        const response = await this.api.post("/v1/api/chat", request);
        return response.data;
    }

    async searchKnowledgeBase(query: string, datasetIds: string[]) {
        // Simulamos un endpoint de búsqueda directa 
        const response = await this.api.post("/v1/api/retrieve", {
            question: query,
            dataset_ids: datasetIds,
        });
        return response.data;
    }
}

// Singleton export para facilidad de uso
export const ragflowClient = process.env.RAGFLOW_API_KEY && process.env.RAGFLOW_BASE_URL
    ? new RagflowClient({
        baseUrl: process.env.RAGFLOW_BASE_URL,
        apiKey: process.env.RAGFLOW_API_KEY,
    })
    : null;
