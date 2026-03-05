import { exec } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Docker Ephemeral Sandbox for Arbitrary Code Execution
 * Implementa namespace isolation y seccomp profiles
 */
export class DockerSandbox {
  private containerId: string;
  private image: string;

  constructor(image: string = "node:18-alpine") {
    this.containerId = `agent-sandbox-${randomUUID().slice(0,8)}`;
    this.image = image;
  }

  async init() {
    // --network none: No internet access (security)
    // --security-opt no-new-privileges: Prevent privilege escalation
    // --pids-limit 50: Fork bomb protection
    // -m 512m: RAM limit
    const cmd = `docker run -d --name ${this.containerId} --network none --security-opt no-new-privileges --pids-limit 50 -m 512m ${this.image} tail -f /dev/null`;
    await execAsync(cmd);
    console.log(`[Sandbox] Container ${this.containerId} initialized.`);
  }

  async runCode(code: string, language: "python" | "javascript" | "bash" = "javascript"): Promise<{stdout: string, stderr: string}> {
    // Escape code for shell
    const escapedCode = Buffer.from(code).toString('base64');
    let runCmd = '';
    
    if (language === "javascript") {
      runCmd = `docker exec ${this.containerId} sh -c "echo ${escapedCode} | base64 -d | node"`;
    } else if (language === "python") {
      runCmd = `docker exec ${this.containerId} sh -c "echo ${escapedCode} | base64 -d | python3"`;
    } else if (language === "bash") {
      runCmd = `docker exec ${this.containerId} sh -c "echo ${escapedCode} | base64 -d | sh"`;
    }

    try {
      const { stdout, stderr } = await execAsync(runCmd, { timeout: 10000 }); // 10s timeout kill signal
      return { stdout, stderr };
    } catch (error: any) {
      return { stdout: error.stdout || "", stderr: error.stderr || error.message };
    }
  }

  async cleanup() {
    await execAsync(`docker rm -f ${this.containerId}`);
    console.log(`[Sandbox] Container ${this.containerId} destroyed.`);
  }
}
