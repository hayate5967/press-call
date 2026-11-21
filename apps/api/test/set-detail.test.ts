// セットの詳細（GET /sets/{setId}）のテスト
import type { CreateSetInput, SetDetail } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { setRawData, sets } from "../src/db/schema";
import { registerSet } from "../src/services/sets";
import { accessTokenFor, createTestApp, createTestDb, seedDevice, TEST_ENV } from "./helpers/db";

type Seeded = Awaited<ReturnType<typeof seedDevice>>;

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
let alice: Seeded;
let bob: Seeded;
let aliceToken: string;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db);
  alice = await seedDevice(db, "alice@example.com");
  bob = await seedDevice(db, "bob@example.com");
  aliceToken = await accessTokenFor(alice.userId);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate table set_raw_data, reps, sets, training_sessions`);
});

function get(path: string, token: string | null = aliceToken) {
  return app.request(
    `/api/v1${path}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    TEST_ENV,
  );
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  expect(await res.json()).toMatchObject({ status, code });
}

const AUTO_REP = {
  startOffsetMs: 0,
  eccentricMs: 900,
  pauseTargetMs: 1000,
  pauseActualMs: 1100,
  reactionMs: 250,
  isPremature: false,
  concentricMs: 1000,
  meanVelocityMps: 0.5,
  peakVelocityMps: 0.75,
  curveHz: 100,
  // real（32 ビット）でも誤差の出ない値にする
  velocityCurve: [0, 0.25, 0.5, 0.75, 0.5],
};

function autoSet(overrides: Partial<CreateSetInput> = {}): CreateSetInput {
  return {
    clientSetId: crypto.randomUUID(),
    settingsVersion: 1,
    mode: "auto_signal",
    pause: { mode: "random", minMs: 500, maxMs: 1500 },
    startedAt: "2026-11-14T09:00:00.000Z",
    endedAt: "2026-11-14T09:00:30.000Z",
    reps: [
      { index: 1, ...AUTO_REP },
      { index: 2, ...AUTO_REP, startOffsetMs: 4000, isPremature: true, reactionMs: null },
    ],
    ...overrides,
  };
}

const add = (owner: Seeded, input: CreateSetInput) =>
  registerSet(db, { deviceId: owner.deviceId, userId: owner.userId }, input);

describe("GET /sets/{setId}", () => {
  it("使った設定・終了時刻・各レップの全項目（速度カーブを含む）を返す", async () => {
    const s = await add(alice, autoSet());
    const res = await get(`/sets/${s.setId}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as SetDetail).toEqual({
      id: s.setId,
      sessionId: s.sessionId,
      startedAt: "2026-11-14T09:00:00.000Z",
      endedAt: "2026-11-14T09:00:30.000Z",
      mode: "auto_signal",
      pause: { mode: "random", minMs: 500, maxMs: 1500 },
      weightKg: null,
      rpe: null,
      note: null,
      hasRawData: false,
      repCount: 2,
      reps: [
        { index: 1, ...AUTO_REP },
        { index: 2, ...AUTO_REP, startOffsetMs: 4000, isPremature: true, reactionMs: null },
      ],
    });
  });

  it("固定の待ち時間と、回数記録モード（pause は null）", async () => {
    const fixed = await add(alice, autoSet({ pause: { mode: "fixed", fixedMs: 800 } }));
    const countOnly = await add(
      alice,
      autoSet({
        mode: "count_only",
        pause: null,
        reps: [
          {
            index: 1,
            ...AUTO_REP,
            pauseTargetMs: null,
            reactionMs: null,
            curveHz: null,
            velocityCurve: null,
          },
        ],
      }),
    );
    const f = (await (await get(`/sets/${fixed.setId}`)).json()) as SetDetail;
    expect(f.pause).toEqual({ mode: "fixed", fixedMs: 800 });
    const c = (await (await get(`/sets/${countOnly.setId}`)).json()) as SetDetail;
    expect(c).toMatchObject({ mode: "count_only", pause: null });
    expect(c.reps[0]).toMatchObject({ curveHz: null, velocityCurve: null });
  });

  it("生データが届いていれば hasRawData が true。重量・RPE・メモも返す", async () => {
    const s = await add(alice, autoSet({ reps: [] }));
    await db.insert(setRawData).values({
      setId: s.setId,
      sampleRateHz: 100,
      formatVersion: 1,
      byteSize: 12,
      payload: new Uint8Array(12),
    });
    await db.update(sets).set({ weightKg: 80, rpe: 7, note: "軽め" }).where(eq(sets.id, s.setId));
    const body = (await (await get(`/sets/${s.setId}`)).json()) as SetDetail;
    expect(body).toMatchObject({
      hasRawData: true,
      weightKg: 80,
      rpe: 7,
      note: "軽め",
      repCount: 0,
      reps: [],
    });
  });

  it("他人のセット・存在しないセット・削除したセットは 404", async () => {
    const bobs = await add(bob, autoSet());
    await expectProblem(await get(`/sets/${bobs.setId}`), 404, "not_found");
    await expectProblem(await get(`/sets/${crypto.randomUUID()}`), 404, "not_found");

    const removed = await add(alice, autoSet());
    await db.update(sets).set({ deletedAt: new Date() }).where(eq(sets.id, removed.setId));
    await expectProblem(await get(`/sets/${removed.setId}`), 404, "not_found");
  });

  it("ID が UUID でなければ 422、ログインしていなければ 401", async () => {
    await expectProblem(await get("/sets/abc"), 422, "validation_failed");
    await expectProblem(await get(`/sets/${crypto.randomUUID()}`, null), 401, "token_missing");
  });
});
