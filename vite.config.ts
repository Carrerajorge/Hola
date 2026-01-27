cat > vite.config.ts <<'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";
import removeConsole from "vite-plugin-remove-console";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

export default defineConfig(async () => {
  const isProd = process.env.NODE_ENV === "production";
  const isReplit = process.env.REPL_ID !== undefined;

  const replitPlugins =
    !isProd && isReplit
      ? [
          (await import("@replit/vite-plugin-cartographer")).cartographer(),
          (await import("@replit/vite-plugin-dev-banner")).devBanner(),
        ]
      : [];

  return {
    plugins: [
      react(),
      runtimeErrorOverlay(),
      tailwindcss(),
      metaImagesPlugin(),
      ...(isProd ? [removeConsole()] : []),
      VitePWA({
        registerTy
