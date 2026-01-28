
export interface ActiveGpt {
    id: string;
    name: string;
    description: string | null;
    systemPrompt: string;
    temperature: string | null;
    topP: string | null;
    welcomeMessage: string | null;
    conversationStarters: string[] | null;
    avatar: string | null;
    capabilities?: {
        webBrowsing?: boolean;
        codeInterpreter?: boolean;
        imageGeneration?: boolean;
        wordCreation?: boolean;
        excelCreation?: boolean;
        pptCreation?: boolean;
    };
}

export type AiState = "idle" | "thinking" | "responding" | "agent_working";

export interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    attachments?: {
        id: string;
        name: string;
        type: string;
        url: string;
    }[];
    // Add other message properties as needed matching the existing type
}
