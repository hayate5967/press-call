// 例外を RFC 9457 の problem+json に変換する（API 仕様書 1 章・7 章）
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: { path: string; message: string }[];
};

/** OpenAPI に載せる problem+json の形 */
export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    code: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi("Problem");

/** createRoute の responses に書くための problem+json のレスポンス定義 */
export function problemResponse(description: string) {
  return { description, content: { "application/problem+json": { schema: ProblemSchema } } };
}

const TYPE_BASE = "https://press-call.example/errors/";

/** アプリ内で投げる、エラーコード付きの例外 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(detail ?? title);
  }
}

export function problem(c: Context, p: Omit<Problem, "type">) {
  const body: Problem = { type: `${TYPE_BASE}${p.code.replaceAll("_", "-")}`, ...p };
  return c.newResponse(JSON.stringify(body), p.status as ContentfulStatusCode, {
    "Content-Type": "application/problem+json",
  });
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return problem(c, {
      status: err.status,
      code: err.code,
      title: err.title,
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
  if (err instanceof HTTPException) {
    // Hono の JSON 読み取りは、JSON が壊れていると 400 の HTTPException を投げる
    if (err.status === 400) {
      return problem(c, {
        status: 400,
        code: "bad_request",
        title: "リクエストが不正です",
        detail: err.message,
      });
    }
    return problem(c, { status: err.status, code: "http_error", title: err.message });
  }
  console.error(err);
  return problem(c, { status: 500, code: "internal_error", title: "サーバでエラーが発生しました" });
}

export function onNotFound(c: Context) {
  return problem(c, { status: 404, code: "not_found", title: "見つかりません" });
}

/**
 * @hono/zod-openapi の入力チェックが失敗したときのフック。
 * 422 validation_failed にし、どの項目がなぜ駄目だったかを errors に入れる
 */
export function validationHook(
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context,
) {
  if (result.success) return;
  return problem(c, {
    status: 422,
    code: "validation_failed",
    title: "入力が不正です",
    errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

/** リクエストボディの上限を超えたときの応答（hono/body-limit の onError に渡す） */
export function payloadTooLarge(c: Context) {
  return problem(c, { status: 413, code: "payload_too_large", title: "リクエストが大きすぎます" });
}
