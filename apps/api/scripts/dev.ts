// 手元の開発サーバ（pnpm dev）。wrangler dev を起動する
//
// wrangler.jsonc に Hyperdrive を書くと、wrangler dev は Hyperdrive の代わりに直接つなぐ先を
// 環境変数 CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE で求める。
// 接続文字列の置き場を .dev.vars の DATABASE_URL（Neon の開発用ブランチ）1 か所にするため、
// そこから読んで渡す。値は表示しない
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

let databaseUrl: string | undefined;
try {
  databaseUrl = parseEnv(readFileSync(".dev.vars", "utf8")).DATABASE_URL;
} catch {
  // .dev.vars がない（下でまとめて案内する）
}
if (!databaseUrl) {
  console.error(
    ".dev.vars に DATABASE_URL（Neon の開発用ブランチの接続文字列）を書いてください（.dev.vars.example を参照）",
  );
  process.exit(1);
}

const child = spawn("wrangler", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl },
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
