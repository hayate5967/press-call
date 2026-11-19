// API の呼び出し（ADR-0005、API 仕様書 3 章）
//
// - アクセストークンはメモリ（この変数）にだけ持つ。localStorage には入れない（XSS で盗まれないように）
// - リフレッシュトークンは HttpOnly Cookie なので JavaScript からは見えない。/auth/refresh を呼ぶだけ
// - 401 token_expired（またはトークンをまだ持っていない）なら、リフレッシュしてから 1 回だけやり直す
// - リフレッシュに失敗したら AuthRequiredError。画面はログインへ移る
import { accessTokenResponseSchema } from "@press-call/shared";

const BASE = "/api/v1";

/** API が返したエラー（RFC 9457 problem+json） */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail ?? title);
  }
}

/** ログインし直しが必要 */
export class AuthRequiredError extends Error {
  constructor(readonly reason: "refresh_token_invalid" | "refresh_token_reused" | "logged_out") {
    super("ログインが必要です");
  }
}

type Fetch = typeof fetch;

async function toProblem(res: Response): Promise<ApiProblem> {
  try {
    const body = (await res.json()) as Partial<{
      code: string;
      title: string;
      detail: string;
      errors: { path: string; message: string }[];
    }>;
    return new ApiProblem(
      res.status,
      body.code ?? "unknown",
      body.title ?? `エラー（${res.status}）`,
      body.detail,
      body.errors,
    );
  } catch {
    return new ApiProblem(res.status, "unknown", `エラー（${res.status}）`);
  }
}

export function createApiClient(fetchImpl: Fetch = (...args) => fetch(...args)) {
  let accessToken: string | null = null;
  // リフレッシュ中なら同じ結果を待つ（同時に何本も呼ぶと、猶予時間に頼ることになるため）
  let refreshing: Promise<string> | null = null;

  async function doRefresh(): Promise<string> {
    const res = await fetchImpl(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.status === 401) {
      const problem = await toProblem(res);
      accessToken = null;
      throw new AuthRequiredError(
        problem.code === "refresh_token_reused" ? "refresh_token_reused" : "refresh_token_invalid",
      );
    }
    if (!res.ok) throw await toProblem(res);
    const body = accessTokenResponseSchema.parse(await res.json());
    accessToken = body.accessToken;
    return body.accessToken;
  }

  function refresh(): Promise<string> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function send(path: string, init: RequestInit, token: string) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetchImpl(`${BASE}${path}`, { ...init, headers });
  }

  /** user 認証の API を呼ぶ。成功した Response を返し、失敗は ApiProblem / AuthRequiredError を投げる */
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = accessToken ?? (await refresh());
    let res = await send(path, init, token);
    if (res.status === 401) {
      const problem = await toProblem(res);
      if (problem.code !== "token_expired") {
        accessToken = null;
        throw new AuthRequiredError("refresh_token_invalid");
      }
      res = await send(path, init, await refresh());
      if (res.status === 401) {
        // 取り直したばかりのトークンでも通らない（ユーザーが消えた・鍵を入れ替えたなど）。ログインし直す
        accessToken = null;
        throw new AuthRequiredError("refresh_token_invalid");
      }
    }
    if (!res.ok) throw await toProblem(res);
    return res;
  }

  return {
    request,
    /** JSON を受け取る API */
    async json<T>(path: string, init: RequestInit = {}): Promise<{ data: T; res: Response }> {
      const res = await request(path, init);
      return { data: (await res.json()) as T, res };
    },
    /** 起動時に呼ぶ。Cookie の rt でアクセストークンを取る（ログインしていなければ AuthRequiredError） */
    refresh,
    async logout(): Promise<void> {
      accessToken = null;
      await fetchImpl(`${BASE}/auth/logout`, { method: "POST", credentials: "same-origin" });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** アプリ全体で使う 1 つのクライアント */
export const api = createApiClient();
