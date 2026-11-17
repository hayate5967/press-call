// DB への接続。本番・wrangler dev は Hyperdrive 経由の node-postgres、テストは PGlite を使う

import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Client } from "pg";
import * as schema from "./schema";

/** node-postgres でも PGlite でも同じように使える Drizzle の DB の型 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** リクエストごとに開いて、終わったら閉じる DB 接続 */
export type DbConnection = { db: Db; close: () => Promise<void> };

/**
 * 「待てば直るかもしれない」接続の失敗（Neon の起動待ち、ネットワークの瞬断など）。
 * これだけを 503 db_unavailable にし、ESP32 に再送させる
 */
export class DbUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("DB に接続できません", options);
    this.name = "DbUnavailableError";
  }
}

/**
 * 待っても直らない、設定の誤りを示す PostgreSQL のエラーコード。
 * 28000 / 28P01：認証の失敗（ユーザー名・パスワードの誤り）、3D000：データベースがない
 */
const CONFIG_ERROR_CODES = new Set(["28000", "28P01", "3D000"]);

/**
 * Hyperdrive の接続文字列で DB を開く。
 * Hyperdrive 側で接続をプールするので、Worker はリクエストごとに接続して閉じてよい。
 */
export async function openDb(connectionString: string): Promise<DbConnection> {
  // 接続文字列の形が壊れているなどの設定の誤りは、ここで例外になり 500 になる
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && CONFIG_ERROR_CODES.has(code)) throw err;
    throw new DbUnavailableError({ cause: err });
  }
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
