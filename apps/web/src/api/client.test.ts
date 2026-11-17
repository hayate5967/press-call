import { describe, expect, it } from "vitest";
import { ApiProblem, AuthRequiredError, createApiClient } from "./client";

type Call = { url: string; auth: string | null };

/** 偽の fetch。応答を順番に返し、呼ばれた URL と Authorization を記録する */
function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
    const next = responses.shift();
    if (!next) throw new Error(`想定外の呼び出し：${String(input)}`);
    return next();
  }) as typeof fetch;
  return { impl, calls };
}

const json =
  (status: number, body: unknown, problem = false) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": problem ? "application/problem+json" : "application/json" },
    });
const token = (t: string) => json(200, { accessToken: t, expiresIn: 900 });
const problem = (status: number, code: string) => json(status, { status, code, title: code }, true);

describe("API クライアント", () => {
  it("トークンがなければ先にリフレッシュし、Bearer を付けて呼ぶ", async () => {
    const f = fakeFetch([token("a1"), json(200, { id: "me" })]);
    const api = createApiClient(f.impl);
    const { data } = await api.json<{ id: string }>("/me");
    expect(data.id).toBe("me");
    expect(f.calls.map((c) => c.url)).toEqual(["/api/v1/auth/refresh", "/api/v1/me"]);
    expect(f.calls[1]?.auth).toBe("Bearer a1");
  });

  it("2 回目からはリフレッシュしない", async () => {
    const f = fakeFetch([token("a1"), json(200, {}), json(200, {})]);
    const api = createApiClient(f.impl);
    await api.request("/me");
    await api.request("/devices");
    expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("token_expired ならリフレッシュして 1 回だけやり直す", async () => {
    const f = fakeFetch([token("a1"), problem(401, "token_expired"), token("a2"), json(200, {})]);
    const api = createApiClient(f.impl);
    const res = await api.request("/me");
    expect(res.status).toBe(200);
    expect(f.calls.at(-1)?.auth).toBe("Bearer a2");
  });

  it("同時に呼んでもリフレッシュは 1 回にまとめる", async () => {
    const f = fakeFetch([token("a1"), json(200, {}), json(200, {})]);
    const api = createApiClient(f.impl);
    await Promise.all([api.request("/me"), api.request("/devices")]);
    expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("リフレッシュが 401 なら AuthRequiredError（再利用の検知は理由を分ける）", async () => {
    const invalid = createApiClient(fakeFetch([problem(401, "refresh_token_invalid")]).impl);
    await expect(invalid.request("/me")).rejects.toMatchObject({ reason: "refresh_token_invalid" });

    const reused = createApiClient(fakeFetch([problem(401, "refresh_token_reused")]).impl);
    const err = await reused.request("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect((err as AuthRequiredError).reason).toBe("refresh_token_reused");
  });

  it("リフレッシュしてやり直しても 401 なら、ApiProblem ではなく AuthRequiredError", async () => {
    const f = fakeFetch([
      token("a1"),
      problem(401, "token_expired"),
      token("a2"),
      problem(401, "token_invalid"),
    ]);
    const api = createApiClient(f.impl);
    await expect(api.request("/me")).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("リフレッシュが 503 なら ApiProblem（ログアウト扱いにしない）", async () => {
    const api = createApiClient(fakeFetch([problem(503, "db_unavailable")]).impl);
    const err = await api.request("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblem);
    expect((err as ApiProblem).status).toBe(503);
  });

  it("token_invalid はリフレッシュせずにログインへ", async () => {
    const f = fakeFetch([token("a1"), problem(401, "token_invalid")]);
    const api = createApiClient(f.impl);
    await expect(api.request("/me")).rejects.toBeInstanceOf(AuthRequiredError);
    expect(f.calls).toHaveLength(2);
  });

  it("401 以外のエラーは ApiProblem（code を見て画面で分ける）", async () => {
    const f = fakeFetch([token("a1"), problem(409, "pairing_already_handled")]);
    const api = createApiClient(f.impl);
    const err = await api
      .request("/pairings/approve", { method: "POST", body: "{}" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblem);
    expect((err as ApiProblem).code).toBe("pairing_already_handled");
  });
});
