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
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
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
            "vendor-ui": [
              "@radix-ui/react-dialog",
              "@radix-ui/react-slot",
              "@radix-ui/react-tooltip",
              "lucide-react",
              "framer-motion",
            ],
            xlsx: ["xlsx"],
            cytoscape: ["cytoscape"],
            "mermaid-core": ["mermaid"],
          },
        },
      },
    },
    server: {
      // Use localhost in dev so the session cookie host matches and login persists.
      host: "localhost",
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
