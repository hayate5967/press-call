// ユーザー認証（Google ログイン・アクセストークン・リフレッシュトークンのローテーション）のテスト
import { eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Db, DbUnavailableError } from "../src/db/client";
import { oauthAccounts, refreshTokens, users } from "../src/db/schema";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  loadSigningKeys,
  signAccessToken,
  verifyAccessToken,
} from "../src/lib/jwt";
import { sha256Hex } from "../src/lib/opaque-token";
import {
  createTestApp,
  createTestDb,
  fakeGoogle,
  OTHER_JWK,
  seedDevice,
  TEST_ENV,
} from "./helpers/db";

const ORIGIN = "https://press-call.test";
const ALICE = { sub: "google-sub-alice", email: "alice@example.com", name: "Alice" };
const BOB = { sub: "google-sub-bob", email: "bob@example.com", name: null };

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
const google = fakeGoogle({ alice: ALICE, bob: BOB });

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db, { createGoogle: google });
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate table refresh_tokens, oauth_accounts cascade`);
  google.calls.length = 0;
});

// ---------- 道具 ----------

function request(path: string, init: RequestInit = {}) {
  return app.request(`${ORIGIN}/api/v1${path}`, init, TEST_ENV);
}

type Cookie = { name: string; value: string; attrs: Record<string, string | true> };

/** Set-Cookie を名前ごとに読む */
function setCookies(res: Response): Record<string, Cookie> {
  const out: Record<string, Cookie> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair = "", ...rest] = line.split(";").map((s) => s.trim());
    const i = pair.indexOf("=");
    const name = pair.slice(0, i);
    const attrs: Record<string, string | true> = {};
    for (const a of rest) {
      const j = a.indexOf("=");
      if (j < 0) attrs[a.toLowerCase()] = true;
      else attrs[a.slice(0, j).toLowerCase()] = a.slice(j + 1);
    }
    out[name] = { name, value: pair.slice(i + 1), attrs };
  }
  return out;
}

/** start → callback を通してログインし、rt Cookie の値を返す */
async function login(who: "alice" | "bob" = "alice"): Promise<string> {
  const start = await request("/auth/google/start");
  const cookies = setCookies(start);
  const state = cookies.oauth_state?.value ?? "";
  const verifier = cookies.oauth_verifier?.value ?? "";
  const res = await request(`/auth/google/callback?code=code-${who}&state=${state}`, {
    headers: { Cookie: `oauth_state=${state}; oauth_verifier=${verifier}` },
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/");
  const rt = setCookies(res).rt?.value;
  if (!rt) throw new Error("rt Cookie がありません");
  return rt;
}

function refresh(rt?: string) {
  return request("/auth/refresh", {
    method: "POST",
    headers: rt === undefined ? {} : { Cookie: `rt=${rt}` },
  });
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  expect(await res.json()).toMatchObject({ status, code });
}

async function tokenRow(rt: string) {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, await sha256Hex(rt)));
  return row;
}

// ---------- アクセストークン（JWT） ----------

describe("アクセストークン（JWT）", () => {
  const userId = crypto.randomUUID();

  it("ES256・kid 付きで署名し、検証するとユーザー ID が取れる", async () => {
    const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
    const token = await signAccessToken(keys, { userId, issuer: ORIGIN });
    const header = JSON.parse(atob(token.split(".")[0] ?? "")) as Record<string, string>;
    expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: "test-1" });
    const payload = JSON.parse(
      atob((token.split(".")[1] ?? "").replaceAll("-", "+").replaceAll("_", "/")),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ iss: ORIGIN, aud: "bench-pause-api", sub: userId });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(ACCESS_TOKEN_TTL_SECONDS);

    expect(await verifyAccessToken(keys, token, ORIGIN)).toEqual({ ok: true, userId });
  });

  it("15 分を過ぎたら expired", async () => {
    const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
    const issuedAt = new Date("2026-11-17T00:00:00Z");
    const token = await signAccessToken(keys, { userId, issuer: ORIGIN }, issuedAt);
    const later = new Date(issuedAt.getTime() + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
    expect(await verifyAccessToken(keys, token, ORIGIN, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("別の鍵で署名されたもの（kid が同じでも）・別の iss・壊れたものは invalid", async () => {
    const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
    const other = await loadSigningKeys(OTHER_JWK);
    const forged = await signAccessToken(other, { userId, issuer: ORIGIN });
    const otherIssuer = await signAccessToken(keys, { userId, issuer: "https://evil.test" });
    const invalid = { ok: false, reason: "invalid" };
    expect(await verifyAccessToken(keys, forged, ORIGIN)).toEqual(invalid);
    expect(await verifyAccessToken(keys, otherIssuer, ORIGIN)).toEqual(invalid);
    expect(await verifyAccessToken(keys, "not.a.jwt", ORIGIN)).toEqual(invalid);
  });

  it("alg: none や知らない kid は受け付けない", async () => {
    const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
    const now = Math.floor(Date.now() / 1000);
    const body = { iss: ORIGIN, aud: "bench-pause-api", sub: userId, iat: now, exp: now + 60 };
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const none = `${b64({ alg: "none", typ: "JWT", kid: "test-1" })}.${b64(body)}.`;
    expect((await verifyAccessToken(keys, none, ORIGIN)).ok).toBe(false);

    const unknownKid = await new SignJWT(body)
      .setProtectedHeader({ alg: "ES256", kid: "other" })
      .sign(keys.privateKey);
    expect((await verifyAccessToken(keys, unknownKid, ORIGIN)).ok).toBe(false);
  });

  it("鍵の設定がない・壊れているときは例外（設定の誤りとして 500 になる）", async () => {
    expect(() => loadSigningKeys(undefined)).toThrow(/JWT_PRIVATE_JWK/);
    await expect(loadSigningKeys("{")).rejects.toThrow(/JSON/);
    await expect(loadSigningKeys(JSON.stringify({ kty: "EC" }))).rejects.toThrow(/ES256/);
  });
});

// ---------- Google ログイン ----------

describe("GET /auth/google/start", () => {
  it("state と PKCE の合言葉を Cookie に入れて Google へ 302", async () => {
    const res = await request("/auth/google/start");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.origin).toBe("https://accounts.google.test");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/v1/auth/google/callback`);

    const cookies = setCookies(res);
    for (const name of ["oauth_state", "oauth_verifier"]) {
      expect(cookies[name]?.attrs).toMatchObject({
        httponly: true,
        secure: true,
        samesite: "Lax",
        path: "/api/v1/auth/google",
        "max-age": "600",
      });
    }
    expect(location.searchParams.get("state")).toBe(cookies.oauth_state?.value);
  });

  it("毎回違う state を作る", async () => {
    const a = setCookies(await request("/auth/google/start")).oauth_state?.value;
    const b = setCookies(await request("/auth/google/start")).oauth_state?.value;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("GET /auth/google/callback", () => {
  async function callback(query: string, cookie: string) {
    return request(`/auth/google/callback?${query}`, { headers: { Cookie: cookie } });
  }

  it("初回はユーザーを作り、rt Cookie を入れて / へ 302", async () => {
    const rt = await login("alice");
    expect(rt).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);

    const [account] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerSubject, ALICE.sub));
    expect(account?.provider).toBe("google");
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, account?.userId ?? ""));
    expect(user).toMatchObject({ email: ALICE.email, displayName: ALICE.name });

    // Google には Cookie の PKCE の合言葉をそのまま渡している
    expect(google.calls[0]?.code).toBe("code-alice");
  });

  it("rt Cookie は HttpOnly・Secure・SameSite=Strict・Path=/api/v1/auth・30 日。oauth_* は消す", async () => {
    const start = setCookies(await request("/auth/google/start"));
    const state = start.oauth_state?.value;
    const res = await callback(
      `code=code-alice&state=${state}`,
      `oauth_state=${state}; oauth_verifier=${start.oauth_verifier?.value}`,
    );
    const cookies = setCookies(res);
    expect(cookies.rt?.attrs).toMatchObject({
      httponly: true,
      secure: true,
      samesite: "Strict",
      path: "/api/v1/auth",
      "max-age": String(30 * 24 * 60 * 60),
    });
    expect(cookies.oauth_state?.attrs["max-age"]).toBe("0");
    expect(cookies.oauth_verifier?.attrs["max-age"]).toBe("0");
  });

  it("DB にはリフレッシュトークンの平文ではなくハッシュだけが入る", async () => {
    const rt = await login();
    const rows = await db.select({ tokenHash: refreshTokens.tokenHash }).from(refreshTokens);
    expect(rows.map((r) => r.tokenHash)).toEqual([await sha256Hex(rt)]);
  });

  it("同じ Google アカウントなら同じユーザー。メールと名前は最新にする", async () => {
    await login("alice");
    const [first] = await db.select().from(oauthAccounts);
    ALICE.email = "alice.new@example.com";
    try {
      await login("alice");
    } finally {
      ALICE.email = "alice@example.com";
    }
    const accounts = await db.select().from(oauthAccounts);
    expect(accounts).toHaveLength(1);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, first?.userId ?? ""));
    expect(user?.email).toBe("alice.new@example.com");
  });

  it("別の Google アカウントは別のユーザー", async () => {
    await login("alice");
    await login("bob");
    const accounts = await db.select().from(oauthAccounts);
    expect(new Set(accounts.map((a) => a.userId)).size).toBe(2);
  });

  const mismatchCases: [string, string, string][] = [
    ["state が Cookie と違う", "code=code-alice&state=evil", "oauth_state=good; oauth_verifier=v"],
    ["state の Cookie がない（期限切れ）", "code=code-alice&state=good", "oauth_verifier=v"],
    ["PKCE の Cookie がない", "code=code-alice&state=good", "oauth_state=good"],
    ["state がない", "code=code-alice", "oauth_state=good; oauth_verifier=v"],
  ];
  it.each(mismatchCases)("%s → /login?error=oauth_state_mismatch", async (_, q, cookie) => {
    const res = await callback(q, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=oauth_state_mismatch");
    expect(google.calls).toHaveLength(0); // Google に問い合わせない
    expect(setCookies(res).rt).toBeUndefined();
  });

  it("Google の画面でキャンセル → oauth_denied", async () => {
    const res = await callback(
      "error=access_denied&state=good",
      "oauth_state=good; oauth_verifier=v",
    );
    expect(res.headers.get("Location")).toBe("/login?error=oauth_denied");
  });

  it("DB につながらないとき → JSON ではなく /login?error=oauth_failed へ", async () => {
    const broken = createTestApp(db, {
      createGoogle: google,
      openDb: async () => {
        throw new DbUnavailableError();
      },
    });
    const res = await broken.request(
      `${ORIGIN}/api/v1/auth/google/callback?code=code-alice&state=good`,
      { headers: { Cookie: "oauth_state=good; oauth_verifier=v" } },
      TEST_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=oauth_failed");
    expect(res.headers.get("Content-Type") ?? "").not.toContain("json");
  });

  it("ユーザーを保存できないとき → /login?error=oauth_failed", async () => {
    const failing = createTestApp(db, {
      createGoogle: fakeGoogle({ alice: { ...ALICE, email: null as unknown as string } }),
    });
    const res = await failing.request(
      `${ORIGIN}/api/v1/auth/google/callback?code=code-alice&state=good`,
      { headers: { Cookie: "oauth_state=good; oauth_verifier=v" } },
      TEST_ENV,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=oauth_failed");
    const cookies = setCookies(res);
    expect(cookies.rt).toBeUndefined();
    expect(cookies.oauth_state?.attrs["max-age"]).toBe("0");
  });

  it("Google が認可コードを受け付けない → oauth_failed（ユーザーは作らない）", async () => {
    const res = await callback(
      "code=code-unknown&state=good",
      "oauth_state=good; oauth_verifier=v",
    );
    expect(res.headers.get("Location")).toBe("/login?error=oauth_failed");
    expect(await db.select().from(oauthAccounts)).toHaveLength(0);
  });
});

// ---------- リフレッシュ ----------

describe("POST /auth/refresh", () => {
  it("アクセストークンを返し、rt を交換する（古い rt は使用済み・同じ系統）", async () => {
    const rt = await login();
    const res = await refresh(rt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; expiresIn: number };
    expect(body.expiresIn).toBe(900);

    const next = setCookies(res).rt;
    expect(next?.value).toMatch(/^rt_/);
    expect(next?.value).not.toBe(rt);
    expect(next?.attrs).toMatchObject({ httponly: true, samesite: "Strict" });

    const old = await tokenRow(rt);
    const fresh = await tokenRow(next?.value ?? "");
    expect(old?.usedAt).toBeInstanceOf(Date);
    expect(fresh?.usedAt).toBeNull();
    expect(fresh?.familyId).toBe(old?.familyId);

    // 受け取ったアクセストークンで /me が呼べる
    const me = await request("/me", { headers: { Authorization: `Bearer ${body.accessToken}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: ALICE.email, displayName: "Alice" });
  });

  it("交換した rt で続けて更新できる", async () => {
    let rt = await login();
    for (let i = 0; i < 3; i++) {
      const res = await refresh(rt);
      expect(res.status).toBe(200);
      rt = setCookies(res).rt?.value ?? "";
    }
  });

  it("rt Cookie がない → 401 refresh_token_invalid", async () => {
    await expectProblem(await refresh(), 401, "refresh_token_invalid");
  });

  it("存在しない rt → 401 refresh_token_invalid（Cookie も消す）", async () => {
    const res = await refresh("rt_unknown");
    expect(setCookies(res).rt?.attrs["max-age"]).toBe("0");
    await expectProblem(res, 401, "refresh_token_invalid");
  });

  it("期限切れの rt → 401 refresh_token_invalid", async () => {
    const rt = await login();
    await db
      .update(refreshTokens)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(refreshTokens.tokenHash, await sha256Hex(rt)));
    await expectProblem(await refresh(rt), 401, "refresh_token_invalid");
  });

  it("使用後 10 秒以内の再利用（2 つのタブ）→ アクセストークンだけ返し、Cookie は変えない・失効もしない", async () => {
    const rt = await login();
    const first = await refresh(rt);
    const next = setCookies(first).rt?.value ?? "";

    const second = await refresh(rt);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { accessToken: string }).accessToken).toBeTruthy();
    expect(setCookies(second).rt).toBeUndefined();

    // 先に返った新しい rt はそのまま使える
    expect((await refresh(next)).status).toBe(200);
  });

  it("同じ rt で同時に更新しても、交換されるのは 1 回だけ", async () => {
    const rt = await login();
    const results = await Promise.all([refresh(rt), refresh(rt)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const rotated = results.filter((r) => setCookies(r).rt !== undefined);
    expect(rotated).toHaveLength(1);
  });

  it("使用後 10 秒を過ぎた再利用 → 盗難とみなし 401 refresh_token_reused・系統ごと失効", async () => {
    const rt = await login();
    const next = setCookies(await refresh(rt)).rt?.value ?? "";
    await db
      .update(refreshTokens)
      .set({ usedAt: sql`now() - interval '11 seconds'` })
      .where(eq(refreshTokens.tokenHash, await sha256Hex(rt)));

    await expectProblem(await refresh(rt), 401, "refresh_token_reused");
    // 正規の利用者が持っている新しい rt も使えなくなる
    expect((await tokenRow(next))?.revokedAt).toBeInstanceOf(Date);
    await expectProblem(await refresh(next), 401, "refresh_token_invalid");
  });

  it("盗難の検知は、その系統だけを失効させる（別のログインは使える）", async () => {
    const phone = await login();
    const laptop = await login();
    await refresh(phone);
    await db
      .update(refreshTokens)
      .set({ usedAt: sql`now() - interval '11 seconds'` })
      .where(eq(refreshTokens.tokenHash, await sha256Hex(phone)));
    await expectProblem(await refresh(phone), 401, "refresh_token_reused");
    expect((await refresh(laptop)).status).toBe(200);
  });
});

// ---------- ログアウト ----------

describe("POST /auth/logout", () => {
  it("系統ごと失効させ、rt Cookie を消して 204", async () => {
    const rt = await login();
    const next = setCookies(await refresh(rt)).rt?.value ?? "";
    const res = await request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `rt=${next}` },
    });
    expect(res.status).toBe(204);
    expect(setCookies(res).rt?.attrs["max-age"]).toBe("0");
    await expectProblem(await refresh(next), 401, "refresh_token_invalid");
  });

  it("rt Cookie がなくても 204", async () => {
    expect((await request("/auth/logout", { method: "POST" })).status).toBe(204);
  });
});

// ---------- /me（user 認証） ----------

describe("GET /me", () => {
  async function accessTokenFor(rt: string) {
    const res = await refresh(rt);
    return ((await res.json()) as { accessToken: string }).accessToken;
  }

  it("Authorization がない → 401 token_missing", async () => {
    await expectProblem(await request("/me"), 401, "token_missing");
  });

  it("期限切れ → 401 token_expired", async () => {
    await login();
    const [account] = await db.select().from(oauthAccounts);
    const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
    const old = await signAccessToken(
      keys,
      { userId: account?.userId ?? "", issuer: ORIGIN },
      new Date(Date.now() - (ACCESS_TOKEN_TTL_SECONDS + 5) * 1000),
    );
    await expectProblem(
      await request("/me", { headers: { Authorization: `Bearer ${old}` } }),
      401,
      "token_expired",
    );
  });

  it("書き換えたトークン・デバイストークン → 401 token_invalid", async () => {
    const token = await accessTokenFor(await login());
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${p}x.${s}`;
    await expectProblem(
      await request("/me", { headers: { Authorization: `Bearer ${tampered}` } }),
      401,
      "token_invalid",
    );
    const device = await seedDevice(db, "device-owner@example.com");
    await expectProblem(
      await request("/me", { headers: { Authorization: `Bearer ${device.token}` } }),
      401,
      "token_invalid",
    );
  });

  it("別のオリジン向けに発行されたトークンは使えない（iss が違う）", async () => {
    const token = await accessTokenFor(await login());
    const res = await app.request(
      "https://other.test/api/v1/me",
      { headers: { Authorization: `Bearer ${token}` } },
      TEST_ENV,
    );
    await expectProblem(res, 401, "token_invalid");
  });

  it("自分の情報だけを返す", async () => {
    const aliceToken = await accessTokenFor(await login("alice"));
    const bobToken = await accessTokenFor(await login("bob"));
    const a = await (
      await request("/me", { headers: { Authorization: `Bearer ${aliceToken}` } })
    ).json();
    const b = await (
      await request("/me", { headers: { Authorization: `Bearer ${bobToken}` } })
    ).json();
    expect(a).toMatchObject({ email: ALICE.email });
    expect(b).toMatchObject({ email: BOB.email, displayName: null });
  });
});

describe("PUBLIC_ORIGIN（手元の開発で Vite 経由にするとき）", () => {
  const env = { ...TEST_ENV, PUBLIC_ORIGIN: "http://localhost:5173" };

  it("リダイレクト URI と JWT の iss に、リクエストの URL ではなく PUBLIC_ORIGIN を使う", async () => {
    const start = await app.request("http://localhost:8787/api/v1/auth/google/start", {}, env);
    const location = new URL(start.headers.get("Location") ?? "");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/api/v1/auth/google/callback",
    );

    const rt = await login();
    const res = await app.request(
      "http://localhost:8787/api/v1/auth/refresh",
      { method: "POST", headers: { Cookie: `rt=${rt}` } },
      env,
    );
    const { accessToken } = (await res.json()) as { accessToken: string };
    const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
    expect((await verifyAccessToken(keys, accessToken, "http://localhost:5173")).ok).toBe(true);
  });
});

describe("OpenAPI", () => {
  it("認証の API が載っている", async () => {
    const spec = (await (await request("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    for (const path of [
      "/auth/google/start",
      "/auth/google/callback",
      "/auth/refresh",
      "/auth/logout",
      "/me",
    ]) {
      expect(Object.keys(spec.paths)).toContain(path);
    }
  });
});
