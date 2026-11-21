// 練習日の一覧と詳細（GET /sessions・GET /sessions/{id}）のテスト
import type { CreateSetInput, SessionDetail, SessionList } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { sets } from "../src/db/schema";
import { decodeCursor, encodeCursor } from "../src/services/sessions";
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

type RepOverrides = { mean?: number | null; premature?: boolean };

/** セットを 1 つ登録する。startedAt は UTC（練習日は日本時間の日付になる） */
async function addSet(owner: Seeded, startedAt: string, repList: RepOverrides[] = [{}]) {
  const input: CreateSetInput = {
    clientSetId: crypto.randomUUID(),
    settingsVersion: 1,
    mode: "auto_signal",
    pause: { mode: "fixed", fixedMs: 1000 },
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 30_000).toISOString(),
    reps: repList.map((r, i) => ({
      index: i + 1,
      startOffsetMs: 1000 * i,
      eccentricMs: 900,
      pauseTargetMs: 1000,
      pauseActualMs: 1100,
      reactionMs: 250,
      isPremature: r.premature ?? false,
      concentricMs: 1000,
      meanVelocityMps: r.mean === undefined ? 0.5 : r.mean,
      peakVelocityMps: 0.75,
      curveHz: 100,
      velocityCurve: [0, 0.25, 0.5],
    })),
  };
  return registerSet(db, { deviceId: owner.deviceId, userId: owner.userId }, input);
}

async function deleteSet(setId: string) {
  await db.update(sets).set({ deletedAt: new Date() }).where(eq(sets.id, setId));
}

describe("カーソル", () => {
  it("日付を出し入れできる。形の違う値は null", () => {
    expect(decodeCursor(encodeCursor("2026-11-10"))).toBe("2026-11-10");
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(encodeCursor("2026-13-45"))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ d: 20261110 })))).toBeNull();
    expect(decodeCursor(btoa("null"))).toBeNull();
  });
});

describe("GET /sessions", () => {
  it("ログインしていなければ 401", async () => {
    await expectProblem(await get("/sessions", null), 401, "token_missing");
  });

  it("記録がなければ空", async () => {
    const res = await get("/sessions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("新しい順に、セット数・レップ数を返す。他人の記録は出さない", async () => {
    // 11/14 の 2 セット（1 つは速度のないレップを含む）
    await addSet(alice, "2026-11-14T09:00:00.000Z", [{ mean: 0.5 }, { mean: 0.25 }]);
    await addSet(alice, "2026-11-14T09:10:00.000Z", [{ mean: 0.625 }, { mean: null }, {}]);
    // 日本時間で 11/16 0:30 になるセット
    await addSet(alice, "2026-11-15T15:30:00.000Z", [{ mean: null }]);
    await addSet(bob, "2026-11-14T09:00:00.000Z");

    const res = await get("/sessions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionList;
    expect(body.nextCursor).toBeNull();
    expect(body.items.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: "2026-11-16", setCount: 1, repCount: 1 },
      { date: "2026-11-14", setCount: 2, repCount: 5 },
    ]);
  });

  it("レップのないセットも 1 セットと数える", async () => {
    await addSet(alice, "2026-11-14T09:00:00.000Z", []);
    const body = (await (await get("/sessions")).json()) as SessionList;
    expect(body.items).toMatchObject([{ setCount: 1, repCount: 0 }]);
  });

  it("削除したセットは数えず、セットがすべて削除された日は出さない", async () => {
    const kept = await addSet(alice, "2026-11-14T09:00:00.000Z", [{ mean: 0.25 }]);
    const removed = await addSet(alice, "2026-11-14T09:10:00.000Z", [{ mean: 0.75 }]);
    const allRemoved = await addSet(alice, "2026-11-13T09:00:00.000Z");
    await deleteSet(removed.setId);
    await deleteSet(allRemoved.setId);

    const body = (await (await get("/sessions")).json()) as SessionList;
    expect(body.items).toEqual([
      {
        id: kept.sessionId,
        date: "2026-11-14",
        setCount: 1,
        repCount: 1,
      },
    ]);
  });

  it("limit ごとに区切り、nextCursor で続きを取れる", async () => {
    for (const day of ["10", "11", "12"]) {
      await addSet(alice, `2026-11-${day}T09:00:00.000Z`);
    }
    const first = (await (await get("/sessions?limit=2")).json()) as SessionList;
    expect(first.items.map((s) => s.date)).toEqual(["2026-11-12", "2026-11-11"]);
    expect(first.nextCursor).not.toBeNull();

    const cursor = encodeURIComponent(first.nextCursor ?? "");
    const second = (await (await get(`/sessions?limit=2&cursor=${cursor}`)).json()) as SessionList;
    expect(second.items.map((s) => s.date)).toEqual(["2026-11-10"]);
    expect(second.nextCursor).toBeNull();
  });

  it("ちょうど limit 件で終わるときは nextCursor が null", async () => {
    await addSet(alice, "2026-11-10T09:00:00.000Z");
    await addSet(alice, "2026-11-11T09:00:00.000Z");
    const body = (await (await get("/sessions?limit=2")).json()) as SessionList;
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=51", "limit"],
    ["limit=abc", "limit"],
    ["cursor=broken", "cursor"],
  ])("%s は 422", async (query, path) => {
    const res = await get(`/sessions?${query}`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { path: string }[] };
    expect(body.code).toBe("validation_failed");
    expect(body.errors.map((e) => e.path)).toContain(path);
  });
});

describe("GET /sessions/{sessionId}", () => {
  it("セットを挙げた順に、レップを 1 レップ目から返す（速度カーブは含めない）", async () => {
    // 後に挙げたセットを先に登録しても、挙げた順に並ぶ
    const later = await addSet(alice, "2026-11-14T09:10:00.000Z", [
      { mean: 0.5 },
      { mean: 0.25, premature: true },
    ]);
    const earlier = await addSet(alice, "2026-11-14T09:00:00.000Z", []);

    const res = await get(`/sessions/${later.sessionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionDetail;
    expect(body).toEqual({
      id: later.sessionId,
      date: "2026-11-14",
      sets: [
        {
          id: earlier.setId,
          startedAt: "2026-11-14T09:00:00.000Z",
          mode: "auto_signal",
          weightKg: null,
          rpe: null,
          note: null,
          repCount: 0,
          reps: [],
        },
        {
          id: later.setId,
          startedAt: "2026-11-14T09:10:00.000Z",
          mode: "auto_signal",
          weightKg: null,
          rpe: null,
          note: null,
          repCount: 2,
          reps: [
            {
              index: 1,
              meanVelocityMps: 0.5,
              peakVelocityMps: 0.75,
              isPremature: false,
              pauseActualMs: 1100,
              reactionMs: 250,
            },
            {
              index: 2,
              meanVelocityMps: 0.25,
              peakVelocityMps: 0.75,
              isPremature: true,
              pauseActualMs: 1100,
              reactionMs: 250,
            },
          ],
        },
      ],
    });
  });

  it("重量・RPE・メモを返す", async () => {
    const s = await addSet(alice, "2026-11-14T09:00:00.000Z");
    await db
      .update(sets)
      .set({ weightKg: 100.5, rpe: 8.5, note: "良い感じ" })
      .where(eq(sets.id, s.setId));
    const body = (await (await get(`/sessions/${s.sessionId}`)).json()) as SessionDetail;
    expect(body.sets[0]).toMatchObject({ weightKg: 100.5, rpe: 8.5, note: "良い感じ" });
  });

  it("削除したセットは返さない", async () => {
    const kept = await addSet(alice, "2026-11-14T09:00:00.000Z");
    const removed = await addSet(alice, "2026-11-14T09:10:00.000Z");
    await deleteSet(removed.setId);
    const body = (await (await get(`/sessions/${kept.sessionId}`)).json()) as SessionDetail;
    expect(body.sets.map((s) => s.id)).toEqual([kept.setId]);
  });

  it("他人の練習日・存在しない練習日・セットがすべて削除された練習日は 404", async () => {
    const bobs = await addSet(bob, "2026-11-14T09:00:00.000Z");
    await expectProblem(await get(`/sessions/${bobs.sessionId}`), 404, "not_found");
    await expectProblem(await get(`/sessions/${crypto.randomUUID()}`), 404, "not_found");

    const removed = await addSet(alice, "2026-11-13T09:00:00.000Z");
    await deleteSet(removed.setId);
    await expectProblem(await get(`/sessions/${removed.sessionId}`), 404, "not_found");
  });

  it("ID が UUID でなければ 422、ログインしていなければ 401", async () => {
    await expectProblem(await get("/sessions/abc"), 422, "validation_failed");
    await expectProblem(await get(`/sessions/${crypto.randomUUID()}`, null), 401, "token_missing");
  });
});
