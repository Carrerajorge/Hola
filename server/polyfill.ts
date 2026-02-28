// [Code-Level Fusion] Polyfill for native OpenClaw mounting
if (typeof (globalThis as any).__name === "undefined") {
    (globalThis as any).__name = (target: any, value: string) => Object.defineProperty(target, "name", { value, configurable: true });
}
