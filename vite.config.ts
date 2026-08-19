import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { compression } from "vite-plugin-compression2";

function preloadGeist(): Plugin {
  return {
    name: "preload-geist",
    transformIndexHtml: {
      order: "post",
      handler(html: string, ctx: { bundle?: Record<string, unknown> }) {
        const file = Object.keys(ctx.bundle ?? {}).find(f =>
          /geist-latin-wght-normal-.*\.woff2$/.test(f)
        );
        if (!file) return html;
        return html.replace(
          "</title>",
          `</title><link rel="preload" href="/${file}" as="font" type="font/woff2" crossorigin>`
        );
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadGeist(),
    compression({ algorithm: "brotliCompress", threshold: 1024, exclude: /\.html$/ }),
    compression({ algorithm: "gzip", threshold: 1024, exclude: /\.html$/ }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_PROXY || "http://localhost:3001",
        changeOrigin: true,
      },
      // Dev-only mirror of the live /skins pages, used by the og:image face
      // fallback. It cannot be "/skins" any more: that is a console route now.
      ...(process.env.API_PROXY
        ? {
            "/__face": {
              target: process.env.API_PROXY,
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/__face/, "/skins"),
            },
          }
        : {}),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/worktrees/**",
    ],
  },
});
