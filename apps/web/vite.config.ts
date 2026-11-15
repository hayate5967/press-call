import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // 開発中は /api を wrangler dev（8787 番）に転送して、本番と同じオリジン構成にする
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
