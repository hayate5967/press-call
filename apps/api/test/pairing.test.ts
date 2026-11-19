// ペアリング（RFC 8628 方式）のテスト
import { formatUserCode, normalizeUserCode, USER_CODE_ALPHABET } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { deviceAuthorizations, deviceSettings, devices, deviceTokens } from "../src/db/schema";
import { sha256Hex } from "../src/lib/opaque-token";
import { generateUserCode } from "../src/services/pairing";
import { accessTokenFor, createTestApp, createTestDb, seedUser, TEST_ENV } from "./helpers/db";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type Authorized = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
let aliceId: string;
let bobId: string;
let alice: string;
let bob: string;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db);
  aliceId = await seedUser(db, "alice@example.com");
  bobId = await seedUser(db, "bob@example.com");
  alice = await accessTokenFor(aliceId);
  bob = await accessTokenFor(bobId);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(
    sql`truncate table device_authorizations, device_tokens, device_settings, devices cascade`,
  );
});

// ---------- 道具 ----------

function post(path: string, body: unknown, accessToken?: string) {
  return app.request(
    `/api/v1${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    },
    TEST_ENV,
  );
}

async function authorize(): Promise<Authorized> {
  const res = await post("/device/authorize", { firmwareVersion: "0.1.0" });
  expect(res.status).toBe(200);
  return (await res.json()) as Authorized;
}

const poll = (deviceCode: string, grantType = GRANT) =>
  post("/device/token", { grantType, deviceCode });

/** 前回の問い合わせを interval より前にずらす（slow_down にならないように） */
async function waitInterval() {
  await db.update(deviceAuthorizations).set({ lastPolledAt: sql`now() - interval '6 seconds'` });
}

async function expectTokenError(res: Response, error: string) {
  expect(res.status).toBe(400);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({ error });
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  expect(await res.json()).toMatchObject({ status, code });
}

const approve = (userCode: string, token = alice, deviceName = "部室のベンチ") =>
  post("/pairings/approve", { userCode, deviceName }, token);

// ---------- userCode ----------

describe("userCode", () => {
  it("母音・紛らわしい文字を使わない 8 文字", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateUserCode();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
    }
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOU01]/);
  });

  it("入力は大文字小文字・ハイフン・空白を区別しない", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
    expect(normalizeUserCode(" BCDF GHJK ")).toBe("BCDFGHJK");
    expect(normalizeUserCode("BCDFGHJ")).toBeNull(); // 7 文字
    expect(normalizeUserCode("ABCD-EFGH")).toBeNull(); // 母音
    expect(formatUserCode("BCDFGHJK")).toBe("BCDF-GHJK");
  });
});

// ---------- POST /device/authorize ----------

describe("POST /device/authorize", () => {
  it("deviceCode・userCode・許可用の URL・期限・間隔を返す", async () => {
    const a = await authorize();
    expect(a.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(a.verificationUri).toBe("http://localhost/devices/pair");
    expect(a.verificationUriComplete).toBe(`http://localhost/devices/pair?code=${a.userCode}`);
    expect(a.expiresIn).toBe(600);
    expect(a.interval).toBe(5);
  });

  it("DB には deviceCode のハッシュだけを保存する", async () => {
    const a = await authorize();
    const [row] = await db.select().from(deviceAuthorizations);
    expect(row?.deviceCodeHash).toBe(await sha256Hex(a.deviceCode));
    expect(JSON.stringify(row)).not.toContain(a.deviceCode);
    expect(row?.status).toBe("pending");
    expect(row?.userCode).toBe(normalizeUserCode(a.userCode));
  });

  it("ボディがなくてもよい", async () => {
    const res = await app.request("/api/v1/device/authorize", { method: "POST" }, TEST_ENV);
    expect(res.status).toBe(200);
  });

  it("毎回違うコードを出す", async () => {
    const a = await authorize();
    const b = await authorize();
    expect(a.deviceCode).not.toBe(b.deviceCode);
    expect(a.userCode).not.toBe(b.userCode);
  });
});

// ---------- 流れ全体 ----------

describe("ペアリングの流れ", () => {
  it("authorization_pending → 許可 → デバイストークン → そのトークンで /device/settings が呼べる", async () => {
    const a = await authorize();
    await expectTokenError(await poll(a.deviceCode), "authorization_pending");

    const approved = await approve(a.userCode);
    expect(approved.status).toBe(200);
    const { deviceId } = (await approved.json()) as { deviceId: string };

    // 許可するとデバイス（持ち主は許可した人）と初期設定ができる。トークンはまだない
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
    expect(device).toMatchObject({ userId: aliceId, name: "部室のベンチ" });
    const [settings] = await db
      .select()
      .from(deviceSettings)
      .where(eq(deviceSettings.deviceId, deviceId));
    expect(settings).toMatchObject({ mode: "auto_signal", pauseFixedMs: 1000 });
    expect(await db.select().from(deviceTokens)).toHaveLength(0);

    await waitInterval();
    const res = await poll(a.deviceCode);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { accessToken: string; tokenType: string; deviceId: string };
    expect(body).toMatchObject({ tokenType: "Bearer", deviceId });
    expect(body.accessToken).toMatch(/^dvt_/);

    // DB にはハッシュだけ
    const tokens = await db.select().from(deviceTokens);
    expect(tokens.map((t) => t.tokenHash)).toEqual([await sha256Hex(body.accessToken)]);

    const settingsRes = await app.request(
      "/api/v1/device/settings",
      { headers: { Authorization: `Bearer ${body.accessToken}` } },
      TEST_ENV,
    );
    expect(settingsRes.status).toBe(200);
  });

  it("トークンは 1 回だけ。受け取った後の問い合わせは expired_token", async () => {
    const a = await authorize();
    await approve(a.userCode);
    expect((await poll(a.deviceCode)).status).toBe(200);
    await waitInterval();
    await expectTokenError(await poll(a.deviceCode), "expired_token");
    expect(await db.select().from(deviceTokens)).toHaveLength(1);
  });

  it("許可後に同時に問い合わせても、トークンは 1 本だけ", async () => {
    const a = await authorize();
    await approve(a.userCode);
    const results = await Promise.all([poll(a.deviceCode), poll(a.deviceCode)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await db.select().from(deviceTokens)).toHaveLength(1);
  });

  it("拒否されたら access_denied（デバイスは作らない）", async () => {
    const a = await authorize();
    const res = await post("/pairings/deny", { userCode: a.userCode }, alice);
    expect(res.status).toBe(204);
    await expectTokenError(await poll(a.deviceCode), "access_denied");
    expect(await db.select().from(devices)).toHaveLength(0);
  });

  it("期限（10 分）を過ぎたら expired_token", async () => {
    const a = await authorize();
    await db.update(deviceAuthorizations).set({ expiresAt: sql`now() - interval '1 second'` });
    await expectTokenError(await poll(a.deviceCode), "expired_token");
  });

  it("期限ぎりぎりに許可しても、許可から 10 分はトークンを受け取れる", async () => {
    const a = await authorize();
    await db.update(deviceAuthorizations).set({ expiresAt: sql`now() + interval '1 second'` });
    expect((await approve(a.userCode)).status).toBe(200);
    const [row] = await db.select().from(deviceAuthorizations);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    await waitInterval();
    expect((await poll(a.deviceCode)).status).toBe(200);
  });

  it("許可から 10 分以上受け取らなければ expired_token", async () => {
    const a = await authorize();
    await approve(a.userCode);
    await db.update(deviceAuthorizations).set({ expiresAt: sql`now() - interval '1 second'` });
    await expectTokenError(await poll(a.deviceCode), "expired_token");
    expect(await db.select().from(deviceTokens)).toHaveLength(0);
  });
});

// ---------- POST /device/token の入力 ----------

describe("POST /device/token", () => {
  it("interval より短い間隔の問い合わせは slow_down", async () => {
    const a = await authorize();
    await expectTokenError(await poll(a.deviceCode), "authorization_pending");
    await expectTokenError(await poll(a.deviceCode), "slow_down");
    await waitInterval();
    await expectTokenError(await poll(a.deviceCode), "authorization_pending");
  });

  it("知らない deviceCode は invalid_grant", async () => {
    await expectTokenError(await poll("unknown-device-code"), "invalid_grant");
  });

  it("grantType が違えば unsupported_grant_type", async () => {
    const a = await authorize();
    await expectTokenError(
      await poll(a.deviceCode, "authorization_code"),
      "unsupported_grant_type",
    );
  });

  it("項目が足りなければ invalid_request（problem+json ではなく RFC の形）", async () => {
    await expectTokenError(await post("/device/token", { grantType: GRANT }), "invalid_request");
  });

  it("userCode を deviceCode として送っても通らない", async () => {
    const a = await authorize();
    await approve(a.userCode);
    await expectTokenError(await poll(a.userCode), "invalid_grant");
  });
});

// ---------- POST /pairings/approve・deny ----------

describe("POST /pairings/approve", () => {
  it("ログインしていなければ 401（何も作らない）", async () => {
    const a = await authorize();
    await expectProblem(
      await post("/pairings/approve", { userCode: a.userCode, deviceName: "x" }),
      401,
      "token_missing",
    );
    expect(await db.select().from(devices)).toHaveLength(0);
  });

  it("デバイストークンでは呼べない", async () => {
    const first = await authorize();
    await approve(first.userCode);
    const token = ((await (await poll(first.deviceCode)).json()) as { accessToken: string })
      .accessToken;
    const a = await authorize();
    await expectProblem(await approve(a.userCode, token), 401, "token_invalid");
  });

  it("小文字・ハイフンなしでも許可できる", async () => {
    const a = await authorize();
    const res = await approve(a.userCode.replace("-", "").toLowerCase());
    expect(res.status).toBe(200);
  });

  it("ないコード → 404 user_code_not_found", async () => {
    await expectProblem(await approve("BCDF-GHJK"), 404, "user_code_not_found");
    await expectProblem(await approve("not a code"), 404, "user_code_not_found");
  });

  it("期限切れ → 410 user_code_expired", async () => {
    const a = await authorize();
    await db.update(deviceAuthorizations).set({ expiresAt: sql`now() - interval '1 second'` });
    await expectProblem(await approve(a.userCode), 410, "user_code_expired");
  });

  it("許可済み・拒否済み → 409 pairing_already_handled（他人が先に許可したコードも）", async () => {
    const a = await authorize();
    expect((await approve(a.userCode, bob)).status).toBe(200);
    await expectProblem(await approve(a.userCode, alice), 409, "pairing_already_handled");

    const b = await authorize();
    await post("/pairings/deny", { userCode: b.userCode }, alice);
    await expectProblem(await approve(b.userCode), 409, "pairing_already_handled");
    // デバイスは最初の 1 つだけ（bob のもの）
    const all = await db.select().from(devices);
    expect(all.map((d) => d.userId)).toEqual([bobId]);
  });

  it("同時に 2 回許可しても、デバイスは 1 つだけ", async () => {
    const a = await authorize();
    const results = await Promise.all([approve(a.userCode), approve(a.userCode)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.select().from(devices)).toHaveLength(1);
  });

  it("デバイス名が空なら 422", async () => {
    const a = await authorize();
    await expectProblem(await approve(a.userCode, alice, "  "), 422, "validation_failed");
  });
});

describe("POST /pairings/deny", () => {
  it("ないコード → 404、処理済み → 409", async () => {
    await expectProblem(
      await post("/pairings/deny", { userCode: "BCDF-GHJK" }, alice),
      404,
      "user_code_not_found",
    );
    const a = await authorize();
    await approve(a.userCode);
    await expectProblem(
      await post("/pairings/deny", { userCode: a.userCode }, alice),
      409,
      "pairing_already_handled",
    );
  });
});

describe("OpenAPI", () => {
  it("ペアリングの API が載っている", async () => {
    const spec = (await (await app.request("/api/v1/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    for (const p of ["/device/authorize", "/device/token", "/pairings/approve", "/pairings/deny"]) {
      expect(Object.keys(spec.paths)).toContain(p);
    }
  });
});
