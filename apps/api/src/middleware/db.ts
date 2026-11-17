// リクエストの間だけ DB に接続し、c.var.db で使えるようにする
import { createMiddleware } from "hono/factory";
import { type DbConnection, DbUnavailableError } from "../db/client";
import type { AppEnv, Bindings } from "../env";
import { ApiError } from "./error";

export type OpenDb = (env: Bindings) => Promise<DbConnection>;

export function withDb(open: OpenDb) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let conn: DbConnection;
    try {
      conn = await open(c.env);
    } catch (err) {
      // 一時的な接続の失敗だけを 503 にする（ESP32 は 5xx なら間隔を延ばして再送する）。
      // バインディングがない・パスワードが違うといった設定の誤りは、そのまま投げて 500 にし、
      // 「待てば直る障害」と見分けがつくようにする
      if (!(err instanceof DbUnavailableError)) throw err;
      console.error(err);
      throw new ApiError(503, "db_unavailable", "DB に接続できません");
    }
    c.set("db", conn.db);
    try {
      await next();
    } finally {
      // 処理（トランザクション）はもう終わっているので、閉じるのに失敗しても応答は変えない。
      // ここで投げると、保存できているのに 500 を返してしまう
      await conn
        .close()
        .catch((err: unknown) => console.error("DB 接続を閉じられませんでした", err));
    }
  });
}
