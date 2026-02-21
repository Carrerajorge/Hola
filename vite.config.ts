import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

export default defineConfig(async () => {
  const isProd = process.env.NODE_ENV === "production";
  const isReplit = process.env.REPL_ID !== undefined;
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  // Workbox bundles/minifies the SW with Rollup+Terser in production mode. That
  // path can fail under some sandboxed/newer Node runtimes, so we fall back to
  // development mode there (still generates a valid SW, just not minified).
  const workboxMode = nodeMajor >= 22 ? "development" : "production";

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
      VitePWA({
        registerType: "autoUpdate",
        // Production incident fix: unregister SW + clear caches so users cannot get stuck on stale builds.
        // This disables PWA caching in prod while we stabilize updates.
        selfDestroying: isProd,
        includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png"],
        manifest: {
          name: "MICHAT PRO - AI Assistant",
          short_name: "MICHAT",
          description: "Advanced AI Assistant Platform with Enterprise Security",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait",
          icons: [
            { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          mode: workboxMode,
          disableDevLogs: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
          // Don't cache API requests - let them pass through to the network
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^\/api\//,
              handler: "NetworkOnly",
            },
          ],
          // Force new SW on every build
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
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
      // Bind to 0.0.0.0 on Replit/remote dev; use localhost locally so cookies persist across reloads.
      host: isReplit ? "0.0.0.0" : "localhost",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      watch: {
        ignored: ["**/node_modules/**", "**/node_modules_backup/**"],
      },
      proxy: {
        "/api": {
          target: "http://localhost:5001",
          changeOrigin: true,
          secure: false,
        },
        "/ws": {
          target: "ws://localhost:5001",
          ws: true,
        },
      },
    },
  };
});
// Force rebuild Wed Feb 11 00:53:49 -05 2026
