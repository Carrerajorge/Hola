import { zodToJsonSchema } from "zod-to-json-schema";
import { AgentOS } from "../server/agentos";

async function generate() {
    const os = AgentOS.getInstance({ mode: "RESEARCH", workspaceRoot: process.cwd(), logLevel: "error" });
    // Boot partial to load tools
    await os.action.initialize();

    const paths: any = {};
    
    // Acceder a herramientas privadas (solo para generación de docs)
    const tools = (os.action as any).tools; 
    
    for (const [name, tool] of tools) {
        const schema = zodToJsonSchema(tool.schema);
        paths[`/tools/${name}`] = {
            post: {
                summary: tool.description,
                tags: ["Tools"],
                requestBody: {
                    content: {
                        "application/json": { schema }
                    }
                },
                responses: {
                    200: { description: "Success" }
                }
            }
        };
    }

    const openapi = {
        openapi: "3.0.0",
        info: {
            title: "AgentOS API",
            version: "1.0.0",
            description: "Programmatic access to AgentOS capabilities"
        },
        paths
    };

    console.log(JSON.stringify(openapi, null, 2));
}

generate().catch(console.error);
