// 例外を RFC 9457 の problem+json に変換する（API 仕様書 1 章・7 章）
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
    return problem(c, { status: err.status, code: "http_error", title: err.message });
  }
  console.error(err);
  return problem(c, { status: 500, code: "internal_error", title: "サーバでエラーが発生しました" });
}

export function onNotFound(c: Context) {
  return problem(c, { status: 404, code: "not_found", title: "見つかりません" });
}
