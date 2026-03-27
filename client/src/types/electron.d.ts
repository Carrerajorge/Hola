declare global {
  interface Window {
    electronAPI?: {
      onNativeAction?: (callback: (event: unknown, data: unknown) => void) => void;
      agentStarted?: () => void;
      agentStopped?: () => void;
      getSystemVolume?: () => Promise<number>;
      setIgnoreMouseEvents?: (ignore: boolean) => void;
      pickWorkspaceFolder?: () => Promise<string | null>;
    };
  }
}

export {};
