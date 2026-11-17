// デバイストークン認証（Authorization: Bearer）のテスト
import type { CreateSetInput } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { devices, deviceTokens, reps, sets, trainingSessions } from "../src/db/schema";
import { generateDeviceToken, hashDeviceToken } from "../src/lib/device-token";
import { issueDeviceToken } from "../src/services/device-tokens";
import { createTestApp, createTestDb, seedDevice } from "./helpers/db";

type Result = { setId: string; sessionId: string; created: boolean };
type Problem = { type: string; status: number; code: string };
type Seeded = Awaited<ReturnType<typeof seedDevice>>;

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
let alice: Seeded;
let bob: Seeded;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db);
  alice = await seedDevice(db, "alice@example.com");
  bob = await seedDevice(db, "bob@example.com");
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate table set_raw_data, reps, sets, training_sessions`);
  await db.update(devices).set({ lastSeenAt: null });
  await db.update(deviceTokens).set({ lastUsedAt: null });
});

function makeSet(overrides: Partial<CreateSetInput> = {}): CreateSetInput {
  return {
    clientSetId: crypto.randomUUID(),
    settingsVersion: 1,
    mode: "count_only",
    pause: null,
    startedAt: "2026-11-15T09:30:12.400Z",
    endedAt: "2026-11-15T09:30:41.900Z",
    reps: [
      {
        index: 1,
        startOffsetMs: 1200,
        eccentricMs: 950,
        pauseTargetMs: null,
        pauseActualMs: 1190,
        reactionMs: null,
        isPremature: false,
        concentricMs: 1050,
        meanVelocityMps: 0.42,
        peakVelocityMps: 0.71,
        curveHz: 100,
        velocityCurve: [0, 0.2],
      },
    ],
    ...overrides,
  };
}

function post(body: unknown, authorization?: string) {
  return app.request("/api/v1/device/sets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify(body),
  });
}

const bearer = (token: string) => `Bearer ${token}`;

async function expectProblem(res: Response, code: string) {
  expect(res.status).toBe(401);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  expect((await res.json()) as Problem).toMatchObject({ status: 401, code });
}

/** 401 のときに何も保存されていないことを確かめるため、記録まわりの 3 テーブルを数える */
async function countRows() {
  const [s] = await db.select({ n: sql<number>`count(*)::int` }).from(sets);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(reps);
  const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(trainingSessions);
  return { sets: s?.n, reps: r?.n, sessions: t?.n };
}

const NOTHING_SAVED = { sets: 0, reps: 0, sessions: 0 };

async function lastSeen(deviceId: string) {
  const [row] = await db
    .select({ lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row?.lastSeenAt;
}

describe("デバイストークン", () => {
  it("dvt_ で始まり、毎回違う値になる", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).toMatch(/^dvt_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("ハッシュは SHA-256 の 16 進文字列", async () => {
    // echo -n abc | sha256sum
    expect(await hashDeviceToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("DB には平文ではなくハッシュだけが入っている", async () => {
    const rows = await db.select({ tokenHash: deviceTokens.tokenHash }).from(deviceTokens);
    const hashes = rows.map((r) => r.tokenHash);
    expect(hashes).not.toContain(alice.token);
    expect(hashes).toContain(await hashDeviceToken(alice.token));
  });
});

describe("認証できないとき（401・何も保存しない）", () => {
  const cases: [string, string | undefined][] = [
    ["Authorization ヘッダーがない", undefined],
    ["Bearer ではない", "Basic dXNlcjpwYXNz"],
    ["Bearer の後ろが空", "Bearer "],
    ["存在しないトークン", bearer(generateDeviceToken())],
  ];

  it.each(cases)("%s → device_token_invalid", async (_, authorization) => {
    await expectProblem(await post(makeSet(), authorization), "device_token_invalid");
    expect(await countRows()).toEqual(NOTHING_SAVED);
  });

  it("ハッシュをそのまま送っても認証されない", async () => {
    const hash = await hashDeviceToken(alice.token);
    await expectProblem(await post(makeSet(), bearer(hash)), "device_token_invalid");
  });

  it("失効したトークン → device_token_revoked", async () => {
    const { token, tokenId } = await issueDeviceToken(db, alice.deviceId);
    await db
      .update(deviceTokens)
      .set({ revokedAt: new Date() })
      .where(eq(deviceTokens.id, tokenId));

    await expectProblem(await post(makeSet(), bearer(token)), "device_token_revoked");
    expect(await countRows()).toEqual(NOTHING_SAVED);
  });

  it("認証できないときは last_seen_at を更新しない", async () => {
    await post(makeSet(), bearer(generateDeviceToken()));
    expect(await lastSeen(alice.deviceId)).toBeNull();
    expect(await lastSeen(bob.deviceId)).toBeNull();
  });
});

describe("認証できたとき", () => {
  it("セットはトークンのデバイスと、その持ち主の練習日に保存される", async () => {
    const res = await post(makeSet(), bearer(alice.token));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Result;

    const [set] = await db.select().from(sets).where(eq(sets.id, body.setId));
    expect(set?.deviceId).toBe(alice.deviceId);
    const [session] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, body.sessionId));
    expect(session?.userId).toBe(alice.userId);
  });

  it("scheme は大文字小文字を区別しない（RFC 9110）", async () => {
    const res = await post(makeSet(), `bearer ${alice.token}`);
    expect(res.status).toBe(201);
  });

  it("devices.last_seen_at と device_tokens.last_used_at が更新される", async () => {
    await post(makeSet(), bearer(alice.token));
    expect(await lastSeen(alice.deviceId)).toBeInstanceOf(Date);
    expect(await lastSeen(bob.deviceId)).toBeNull();

    const [token] = await db
      .select({ lastUsedAt: deviceTokens.lastUsedAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.id, alice.tokenId));
    expect(token?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("同じデバイスに複数のトークンがあっても、どれでも同じデバイスとして扱う", async () => {
    const { token } = await issueDeviceToken(db, alice.deviceId);
    const res = await post(makeSet(), bearer(token));
    const body = (await res.json()) as Result;
    const [set] = await db.select().from(sets).where(eq(sets.id, body.setId));
    expect(set?.deviceId).toBe(alice.deviceId);
  });
});

describe("他人のデバイスでは登録できない", () => {
  it("ボディに他人の deviceId・userId を混ぜても無視され、トークンの持ち主に保存される", async () => {
    const res = await post(
      { ...makeSet(), deviceId: alice.deviceId, userId: alice.userId },
      bearer(bob.token),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Result;

    const [set] = await db.select().from(sets).where(eq(sets.id, body.setId));
    expect(set?.deviceId).toBe(bob.deviceId);
    const [session] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, body.sessionId));
    expect(session?.userId).toBe(bob.userId);

    // alice の記録は 1 件も増えていない
    expect(await db.select().from(sets).where(eq(sets.deviceId, alice.deviceId))).toHaveLength(0);
    expect(
      await db.select().from(trainingSessions).where(eq(trainingSessions.userId, alice.userId)),
    ).toHaveLength(0);
  });

  it("同じ clientSetId でも、デバイスが違えば別のセットになり、他人のセットを返さない", async () => {
    const input = makeSet();
    const a = (await (await post(input, bearer(alice.token))).json()) as Result;
    const res = await post(input, bearer(bob.token));
    expect(res.status).toBe(201);
    const b = (await res.json()) as Result;

    expect(b.created).toBe(true);
    expect(b.setId).not.toBe(a.setId);
    expect(b.sessionId).not.toBe(a.sessionId);
  });
});
