// 開発用スクリプトで共通に使う、DB への接続と確認
//
// DATABASE_URL と ENVIRONMENT は「同じ場所」から取る。
// シェルに別の DATABASE_URL（本番など）が残っていても、.dev.vars の ENVIRONMENT=development で
// 書き込めてしまわないようにするため。本番の DB に開発用の値を入れないよう、開発環境と明示したときだけ動かす
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import { type DbConnection, openDb } from "../../src/db/client";

const DEV_VARS = ".dev.vars";

export function fail(message: string, usage?: string): never {
  console.error(usage ? `エラー: ${message}\n\n${usage}` : `エラー: ${message}`);
  process.exit(1);
}

/** エラーの説明。接続文字列（パスワードを含む）は出さない */
export function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}：${err.cause.message}` : err.message;
}

/** 開発用の DB を開く。書き込む前に接続先を表示して確認する（yes なら確認を省く） */
export async function openDevDb(options: { yes?: boolean }): Promise<DbConnection> {
  const fileVars = existsSync(DEV_VARS) ? parseEnv(readFileSync(DEV_VARS, "utf8")) : {};
  const fromShell = process.env.DATABASE_URL !== undefined;
  const source = fromShell ? "シェルの環境変数" : DEV_VARS;
  const databaseUrl = fromShell ? process.env.DATABASE_URL : fileVars.DATABASE_URL;
  const environment = fromShell ? process.env.ENVIRONMENT : fileVars.ENVIRONMENT;

  if (!databaseUrl) fail(`DATABASE_URL がありません（${DEV_VARS} に書いてください）`);
  if (environment !== "development") {
    fail(
      fromShell
        ? "シェルの DATABASE_URL を使うときは、シェルでも ENVIRONMENT=development を指定してください"
        : `${DEV_VARS} に ENVIRONMENT=development がありません`,
    );
  }

  let host: string;
  try {
    host = new URL(databaseUrl).host;
  } catch {
    // URL の中身（パスワードを含む）は表示しない
    fail(`DATABASE_URL の形が正しくありません（${source}）`);
  }

  console.log(`接続先: ${host}（${source}）`);
  if (!options.yes) {
    if (!process.stdin.isTTY)
      fail("確認できないので中止しました。続けるなら --yes を付けてください");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("この DB に書き込みます。よろしいですか？ [y/N] ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("中止しました");
      process.exit(0);
    }
  }

  return openDb(databaseUrl).catch((err: unknown) => fail(describe(err)));
}
