export function createExecTool() {
  return {
    name: "exec",
    description: "Execute shell commands",
    parameters: {},
    execute: async () => ({ success: true }),
  };
}
