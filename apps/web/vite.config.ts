import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn/ui の部品は "@/components/ui/..." の形で読み込む
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // 開発中は /api を wrangler dev（8787 番）に転送して、本番と同じオリジン構成にする
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
