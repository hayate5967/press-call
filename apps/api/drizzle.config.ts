// drizzle-kit の設定（マイグレーションの生成・適用）
// 接続先は .dev.vars の DATABASE_URL（Neon の dev ブランチ）。generate と check には接続不要
import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".dev.vars");
} catch {
  // .dev.vars がなくても generate / check は動く
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
});
