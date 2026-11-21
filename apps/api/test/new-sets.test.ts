// 新しく届いたセット（GET /sets?createdAfter=、練習中の自動更新）のテスト
import type { CreateSetInput, NewSetList } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { sets } from "../src/db/schema";
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

function get(query: string, token: string | null = aliceToken) {
  return app.request(
    `/api/v1/sets${query}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    TEST_ENV,
  );
}

async function poll(createdAfter?: string): Promise<NewSetList> {
  const res = await get(createdAfter ? `?createdAfter=${encodeURIComponent(createdAfter)}` : "");
  expect(res.status).toBe(200);
  return (await res.json()) as NewSetList;
}

function makeSet(reps = 2): CreateSetInput {
  return {
    clientSetId: crypto.randomUUID(),
    settingsVersion: 1,
    mode: "auto_signal",
    pause: { mode: "fixed", fixedMs: 1000 },
    startedAt: "2026-11-14T09:00:00.000Z",
    endedAt: "2026-11-14T09:00:30.000Z",
    reps: Array.from({ length: reps }, (_, i) => ({
      index: i + 1,
      startOffsetMs: 1000 * i,
      eccentricMs: 900,
      pauseTargetMs: 1000,
      pauseActualMs: 1100,
      reactionMs: 250,
      isPremature: false,
      concentricMs: 1000,
      meanVelocityMps: 0.5,
      peakVelocityMps: 0.75,
      curveHz: 100,
      velocityCurve: [0, 0.5],
    })),
  };
}

const add = (owner: Seeded, input = makeSet()) =>
  registerSet(db, { deviceId: owner.deviceId, userId: owner.userId }, input);

/** セットが届いた時刻（created_at）を書き換える */
async function setCreatedAt(setId: string, at: Date) {
  await db.update(sets).set({ createdAt: at }).where(eq(sets.id, setId));
}

describe("GET /sets?createdAfter=", () => {
  it("createdAfter がなければセットは返さず、少し前にずらしたサーバの時刻だけを返す", async () => {
    await add(alice);
    const before = Date.now();
    const body = await poll();
    expect(body.items).toEqual([]);
    const serverTime = Date.parse(body.serverTime);
    // 5 秒前にずらしてある（テストの実行時間ぶんの余裕を持たせる）
    expect(serverTime).toBeLessThanOrEqual(before - 4_000);
    expect(serverTime).toBeGreaterThan(before - 10_000);
    expect(body.serverTime).toMatch(/Z$/);
  });

  it("createdAfter より後に届いたセットを、届いた順に返す（他人・削除済み・それより前は返さない）", async () => {
    const base = new Date("2026-11-14T09:00:00.000Z");
    const old = await add(alice);
    const first = await add(alice, makeSet(3));
    const second = await add(alice, makeSet(0));
    const removed = await add(alice);
    const bobs = await add(bob);
    await setCreatedAt(old.setId, new Date(base.getTime() - 1000));
    await setCreatedAt(second.setId, new Date(base.getTime() + 2000));
    await setCreatedAt(first.setId, new Date(base.getTime() + 1000));
    await setCreatedAt(removed.setId, new Date(base.getTime() + 3000));
    await setCreatedAt(bobs.setId, new Date(base.getTime() + 1000));
    await db.update(sets).set({ deletedAt: new Date() }).where(eq(sets.id, removed.setId));

    const body = await poll(base.toISOString());
    expect(body.items).toEqual([
      {
        id: first.setId,
        sessionId: first.sessionId,
        startedAt: "2026-11-14T09:00:00.000Z",
        mode: "auto_signal",
        repCount: 3,
        weightKg: null,
      },
      {
        id: second.setId,
        sessionId: second.sessionId,
        startedAt: "2026-11-14T09:00:00.000Z",
        mode: "auto_signal",
        repCount: 0,
        weightKg: null,
      },
    ]);
  });

  it("前回の serverTime を渡し続ければ、その間に届いたセットを取りこぼさない", async () => {
    const start = await poll();
    const s = await add(alice);
    const next = await poll(start.serverTime);
    expect(next.items.map((x) => x.id)).toEqual([s.setId]);

    // 届いてから 5 秒以上たてば、次の問い合わせには出ない
    await setCreatedAt(s.setId, new Date(Date.now() - 60_000));
    const later = await poll(next.serverTime);
    expect(later.items).toEqual([]);
  });

  it("重量を入れてあれば weightKg を返す", async () => {
    const s = await add(alice);
    await db.update(sets).set({ weightKg: 100 }).where(eq(sets.id, s.setId));
    await setCreatedAt(s.setId, new Date("2026-11-14T09:00:01.000Z"));
    const body = await poll("2026-11-14T09:00:00.000Z");
    expect(body.items[0]?.weightKg).toBe(100);
  });

  it("createdAfter が日時でなければ 422、ログインしていなければ 401", async () => {
    const bad = await get("?createdAfter=yesterday");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "validation_failed" });
    const anon = await get("", null);
    expect(anon.status).toBe(401);
  });

  it("キャッシュさせない", async () => {
    const res = await get("");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
