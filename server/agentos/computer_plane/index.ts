import { BasePlane } from "../base_plane";
import { FileSystemTool } from "./tools/filesystem";
import { ShellTool } from "./tools/shell";
import { DesktopTool } from "./tools/desktop";

export class ComputerPlane extends BasePlane {
  
  async initialize() {
    console.log("[ComputerPlane] Initializing REAL System Control...");
    this.registerRealTools();
  }

  private registerRealTools() {
    // 1. Filesystem (Secure Gateway)
    this.os.action.registerTool(FileSystemTool.read);
    this.os.action.registerTool(FileSystemTool.write);
    this.os.action.registerTool(FileSystemTool.list);

    // 2. Shell (Spawn/PTY)
    this.os.action.registerTool(ShellTool.exec);

    // 3. Desktop (Native Automation)
    this.os.action.registerTool(DesktopTool.window);
    this.os.action.registerTool(DesktopTool.input);
    this.os.action.registerTool(DesktopTool.notify);

    console.log("[ComputerPlane] Tools Registered: FS, Shell, Desktop (macOS)");
  }

  // File Watcher se mantiene igual
  public watchDirectory(path: string, callback: (event: string) => void) {
    console.log(`[ComputerPlane] 👀 Watching directory: ${path}`);
  }
}
