import { toolRegistry } from "../server/agent/registry/toolRegistry";
import { registerAllTools } from "../server/agent/registry/registerTools";

const runTool = async (name: string, input: Record<string, unknown>) => {
  const result = await toolRegistry.execute(name, input);
  if (!result.success) {
    const message = result.error?.message || "unknown error";
    throw new Error(`Tool ${name} failed: ${message}`);
  }
  return result.data as any;
};

const buildFlowiseCustomFunctionFlow = () => ({
  nodes: [
    {
      id: "customFunction_0",
      position: { x: 0, y: 0 },
      type: "customNode",
      data: {
        id: "customFunction_0",
        label: "Custom JS Function",
        version: 1,
        name: "customFunction",
        type: "CustomFunction",
        baseClasses: ["CustomFunction", "Utilities"],
        category: "Utilities",
        description: "Execute custom javascript function",
        inputParams: [
          {
            label: "Input Variables",
            name: "functionInputVariables",
            description: "Input variables can be used in the function with prefix $. For example: $var",
            type: "json",
            optional: true,
            acceptVariable: true,
            list: true,
          },
          {
            label: "Function Name",
            name: "functionName",
            type: "string",
            optional: true,
            placeholder: "My Function",
          },
          {
            label: "Javascript Function",
            name: "javascriptFunction",
            type: "code",
          },
        ],
        inputAnchors: [],
        inputs: {
          functionInputVariables: "",
          functionName: "",
          javascriptFunction: "return `flowise:${$input}`;",
        },
        outputAnchors: [
          {
            name: "output",
            label: "Output",
            type: "options",
            description: "",
            options: [
              {
                id: "customFunction_0-output-output-string|number|boolean|json|array",
                name: "output",
                label: "Output",
                description: "",
                type: "string | number | boolean | json | array",
              },
              {
                id: "customFunction_0-output-EndingNode-CustomFunction",
                name: "EndingNode",
                label: "Ending Node",
                description: "",
                type: "CustomFunction",
              },
            ],
            default: "output",
          },
        ],
        outputs: { output: "output" },
        selected: false,
      },
    },
  ],
  edges: [],
});

async function main() {
  registerAllTools();

  const langchain = await runTool("langchain_prompt_format", {
    template: "Hola {name}, bienvenido a {project}.",
    variables: { name: "Wave1", project: "Deep Fusion" },
  });

  const flowise = await runTool("flowise_run_flow", {
    question: "ok",
    flowDefinition: JSON.stringify(buildFlowiseCustomFunctionFlow()),
  });

  const dify = await runTool("dify_parse_dsl", {
    dsl: [
      "version: '0.6.0'",
      "app:",
      "  name: Wave1",
      "workflow:",
      "  graph:",
      "    nodes:",
      "      - id: node_1",
      "        type: start",
      "      - id: node_2",
      "        type: llm",
      "    edges:",
      "      - source: node_1",
      "        target: node_2",
    ].join("\n"),
  });

  const agentZeroList = await runTool("agent_zero_list_agents", {});
  const agentZeroPrompts = await runTool("agent_zero_load_prompts", {
    agentName: "agent0",
    includeBasePrompts: true,
  });

  const summary = {
    langchain,
    flowise: {
      runId: flowise?.data?.runId || flowise?.runId,
      result: flowise?.data?.result || flowise?.result,
    },
    dify: {
      version: dify?.data?.version || dify?.version,
      graph: dify?.data?.workflow?.graph || dify?.workflow?.graph,
    },
    agentZero: {
      agents: agentZeroList?.data?.agents?.length || agentZeroList?.agents?.length || 0,
      promptCount: Object.keys(agentZeroPrompts?.data?.prompts || agentZeroPrompts?.prompts || {}).length,
      basePromptCount: Object.keys(agentZeroPrompts?.data?.basePrompts || agentZeroPrompts?.basePrompts || {}).length,
    },
  };

  console.log(JSON.stringify({ wave: "wave1", summary }, null, 2));
}

main().catch((error) => {
  console.error(`[wave1] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
