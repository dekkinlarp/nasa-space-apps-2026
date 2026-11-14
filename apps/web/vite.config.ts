import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.MARSMAP_SERVER ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": target, "/data": target },
  },
  preview: { port: 5173, proxy: { "/api": target, "/data": target } },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
