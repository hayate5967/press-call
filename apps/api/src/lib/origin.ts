// この Worker の「外から見たオリジン」（例：https://press-call.example.workers.dev）
//
// JWT の iss、Google のリダイレクト URI、ペアリングの許可画面の URL に使う。
// 本番ではリクエストの URL のオリジンをそのまま使う。
// 手元の開発では Vite（5173 番）が /api を wrangler dev（8787 番）に転送するため、
// Worker から見えるオリジンがブラウザのものと違うことがある。そのときは PUBLIC_ORIGIN で指定する
import type { Context } from "hono";
import type { AppEnv } from "../env";

export function publicOrigin(c: Context<AppEnv>): string {
  const configured = c.env?.PUBLIC_ORIGIN;
  if (configured) {
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      throw new Error("PUBLIC_ORIGIN が URL として読めません（例：http://localhost:5173）");
    }
    return url.origin;
  }
  return new URL(c.req.url).origin;
}
