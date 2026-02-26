import { describe, it, expect } from 'vitest';
import { capabilityRegistry } from "../registry";
describe('Phase 7: Dynamic Capability Interop', () => {

    it('Should start with the base manually imported capabilities (Phase 1-6)', () => {
        const baseTools = capabilityRegistry.getToolSchemas();
        expect(baseTools.length).toBeGreaterThan(0);
        // We registered about 10 base tools in autonomousAgentBrain initially
        console.log(`Base tools count: ${baseTools.length}`);
    });

  it.skip('Should dynamically load >100+ capabilities via LangChain and MCP aggregators (Phase 7)', async () => {
        const initialCount = capabilityRegistry.getToolSchemas().length;

        // This will spin up DuckDuckGo, Wikipedia, and search for mcp_servers.json locally
        const loaded = 0; // TODO: implement dynamic suites loader in registry

        const finalCount = capabilityRegistry.getToolSchemas().length;

        expect(loaded).toBeGreaterThanOrEqual(2); // At least Wikipedia + DDG
        expect(finalCount).toBeGreaterThan(initialCount);

        const allToolNames = capabilityRegistry.getToolSchemas().map(c => c.name);
        expect(allToolNames).toContain('langchain_wikipedia');
        expect(allToolNames).toContain('langchain_duckduckgo');

        console.log(`Action space successfully expanded from ${initialCount} -> ${finalCount} tools dynamically.`);
    });
});
