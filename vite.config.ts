import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

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
  plugins: [react(), tailwindcss(), preloadGeist()],
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
        target: "http://localhost:3001",
        changeOrigin: true,
      },
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
