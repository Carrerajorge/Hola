import { ragflowClient } from "../../services/ragflowClient";
import fs from "fs/promises";
import path from "path";

export async function realRagflowSearch(input: { query: string; datasetIds?: string[] }) {
    if (!ragflowClient) {
        return {
            success: false,
            message: "RAGFlow no está configurado. Revisa RAGFLOW_API_KEY y RAGFLOW_BASE_URL.",
        };
    }

    try {
        const defaultDatasetIds = input.datasetIds || [];
        const result = await ragflowClient.searchKnowledgeBase(input.query, defaultDatasetIds);
        return {
            success: true,
            data: result,
            message: "Búsqueda en RAGFlow completada con éxito.",
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Error al buscar en RAGFlow: ${error.message}`,
        };
    }
}

export async function realRagflowUpload(input: { filePath: string; datasetId: string }) {
    if (!ragflowClient) {
        return {
            success: false,
            message: "RAGFlow no está configurado. Revisa RAGFLOW_API_KEY y RAGFLOW_BASE_URL.",
        };
    }

    try {
        const fileBuffer = await fs.readFile(path.resolve(input.filePath));
        const fileName = path.basename(input.filePath);
        const result = await ragflowClient.uploadDocument(input.datasetId, fileBuffer, fileName);
        return {
            success: true,
            data: result,
            message: `Documento ${fileName} subido a RAGFlow exitosamente.`,
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Error al subir documento a RAGFlow: ${error.message}`,
        };
    }
}

export async function realRagflowCreateDataset(input: { name: string; description?: string }) {
    if (!ragflowClient) {
        return {
            success: false,
            message: "RAGFlow no está configurado. Revisa RAGFLOW_API_KEY y RAGFLOW_BASE_URL.",
        };
    }

    try {
        const result = await ragflowClient.createDataset({ name: input.name, description: input.description });
        return {
            success: true,
            data: result,
            message: `Base de conocimiento '${input.name}' creada exitosamente en RAGFlow.`,
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Error al crear dataset en RAGFlow: ${error.message}`,
        };
    }
}
