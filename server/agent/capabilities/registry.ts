import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { MCPDynamicLoader } from './mcp/mcpClient';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for isolated agent capabilities.
 * Designed to be consumed by both LangGraph Native Agents and custom MCTS Trees.
 */
export interface AgentCapability {
    name: string;
    description: string;
    schema: z.ZodType<any>;
    execute: (args: any) => Promise<any> | any;
}

export class CapabilityRegistry {
    private capabilities: Map<string, AgentCapability> = new Map();

    /**
     * Registers a single capability
     */
    register(capability: AgentCapability) {
        if (this.capabilities.has(capability.name)) {
            console.warn(`[CapabilityRegistry] Overwriting existing capability: ${capability.name}`);
        }
        this.capabilities.set(capability.name, capability);
        console.log(`[CapabilityRegistry] Registered skill: ${capability.name}`);
    }

    /**
     * Registers an array of capabilities
     */
    registerModule(capabilities: AgentCapability[]) {
        for (const cap of capabilities) {
            this.register(cap);
        }
    }

    /**
     * Gets a specific capability
     */
    get(name: string): AgentCapability | undefined {
        return this.capabilities.get(name);
    }

    /**
     * Returns all tools formatted for LangChain / LangGraph usage
     */
    getLangChainTools() {
        return Array.from(this.capabilities.values()).map(cap =>
            tool(
                async (input) => JSON.stringify(await cap.execute(input)),
                {
                    name: cap.name,
                    description: cap.description,
                    schema: cap.schema
                }
            )
        );
    }

    /**
     * Returns generic list of capabilities for abstract tree search
     */
    getAllRaw() {
        return Array.from(this.capabilities.values());
    }
    /**
     * Carga dinámicamente ecosistemas masivos de Capabilities sin hardcodear archivos individuales (Fase 7 Milestone)
     */
    async loadDynamicSuites() {
        console.log(`[CapabilityRegistry] Initiating Phase 7 Dynamic Aggregation Loop...`);
        let loadedCount = 0;

        // 1. LangChain Community Built-ins 
        try {
            // Ejemplo de inyección dinámica: DuckDuckGo y Wikipedia via Langchain Modules
            const { DuckDuckGoSearch } = await import("@langchain/community/tools/duckduckgo_search");
            const { WikipediaQueryRun } = await import("@langchain/community/tools/wikipedia_query_run");

            const ddg = new DuckDuckGoSearch();
            const wiki = new WikipediaQueryRun({ topKResults: 3, maxDocContentLength: 4000 });

            this.register({
                name: "langchain_duckduckgo",
                description: ddg.description,
                schema: z.string().describe("Busqueda libre en DuckDuckGo."),
                execute: async (query: string) => await ddg.invoke(query)
            });
            loadedCount++;

            this.register({
                name: "langchain_wikipedia",
                description: wiki.description,
                schema: z.string().describe("Busqueda en la enciclopedia Wikipedia."),
                execute: async (page: string) => await wiki.invoke(page)
            });
            loadedCount++;

            console.log(`[CapabilityRegistry] 🧠 Loaded LangChain Community Open Source Tools.`);
        } catch (e: any) {
            console.warn(`[CapabilityRegistry] Failed to mount LangChain Community modules: ${e.message}`);
        }

        // 2. Model Context Protocol (MCP) Servers
        try {
            // Buscamos un mcp_servers.json de configuracion custom
            const serverConfigPath = path.resolve(process.cwd(), 'mcp_servers.json');
            if (fs.existsSync(serverConfigPath)) {
                const configRaw = fs.readFileSync(serverConfigPath, 'utf8');
                const config = JSON.parse(configRaw);

                for (const [serverName, serverDetails] of Object.entries(config.mcpServers)) {
                    const details = serverDetails as any;
                    console.log(`[CapabilityRegistry] 🔌 Dialing MCP Server: ${serverName}`);

                    const mcpClient = new MCPDynamicLoader();
                    await mcpClient.connectStdio(details.command, details.args, details.env);

                    const dynamicTools = await mcpClient.fetchCapabilities();
                    this.registerModule(dynamicTools);

                    loadedCount += dynamicTools.length;
                    console.log(`[CapabilityRegistry] 🔌 Ingested ${dynamicTools.length} tools from MCP [${serverName}]`);
                }
            } else {
                console.log(`[CapabilityRegistry] Ignored MCP Load: No 'mcp_servers.json' found in cwd.`);
            }

        } catch (e: any) {
            console.error(`[CapabilityRegistry] Error loading MCP configuration schema: ${e.message}`);
        }

        console.log(`[CapabilityRegistry] Dynamic Aggregation Complete. Bootstrapped ${loadedCount} capabilities into the MCTS Planner.`);
        return loadedCount;
    }
}

// Global Singleton Registry
export const globalRegistry = new CapabilityRegistry();
