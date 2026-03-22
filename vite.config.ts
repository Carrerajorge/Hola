import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
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
      // The Replit runtime error modal can break local dev and is only useful in Replit.
      ...(isReplit ? [runtimeErrorOverlay()] : []),
      tailwindcss(),
      metaImagesPlugin(),
      ...replitPlugins,
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),

        // Force a single React instance to avoid "Invalid hook call" in dev.
        react: path.resolve(import.meta.dirname, "node_modules/react"),
        "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
        "react/jsx-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-runtime"),
        "react/jsx-dev-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-dev-runtime"),
      },
      dedupe: ["react", "react-dom"],
    },
    css: {
      postcss: {
        plugins: [],
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      minify: process.env.CI ? false : "esbuild",
      sourcemap: false,
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "wouter"],
            "vendor-tiptap": [
              "@tiptap/react",
              "@tiptap/starter-kit",
              "@tiptap/extension-link",
              "@tiptap/extension-image",
              "@tiptap/extension-table"
            ],
            "vendor-zod": ["zod"],
            "vendor-aws": ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
            "vendor-ui": [
              "@radix-ui/react-dialog",
              "@radix-ui/react-slot",
              "@radix-ui/react-tooltip",
              "lucide-react",
              "framer-motion",
            ],
            "vendor-office": ["exceljs", "pptxgenjs", "docx", "mammoth"],
            "vendor-spreadsheet": ["@handsontable/react", "handsontable"],
            "vendor-visualization": ["echarts", "echarts-for-react", "recharts", "d3", "three", "konva", "react-konva"],
            "vendor-editor": ["@monaco-editor/react", "prismjs"],
            xlsx: ["xlsx"],
            cytoscape: ["cytoscape"],
            "mermaid-core": ["mermaid"],
          },
        },
      },
    },
    server: {
      // Bind to 0.0.0.0 so it's accessible on both IPv4 (127.0.0.1) and IPv6 (::1)
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      watch: {
        ignored: ["**/node_modules/**", "**/node_modules_backup/**", "**/uploads/**"],
      },
      proxy: {
        "/api": {
          target: process.env.VITE_API_URL || "http://127.0.0.1:5001",
          changeOrigin: true,
          secure: false,
        },
        "/objects": {
          target: process.env.VITE_API_URL || "http://127.0.0.1:5001",
          changeOrigin: true,
          secure: false,
        },
        "/ws": {
          target: process.env.VITE_WS_URL || "ws://127.0.0.1:5001",
          ws: true,
        },
      },
    },
  };
});
// Force rebuild Wed Feb 11 00:53:49 -05 2026
