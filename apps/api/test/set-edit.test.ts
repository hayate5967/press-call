// セットの編集と削除（PATCH・DELETE /sets/{setId}）のテスト
import type { CreateSetInput, SessionList, SetDetail } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { reps, setRawData, sets } from "../src/db/schema";
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

function request(path: string, init: RequestInit & { token?: string | null } = {}) {
  const { token = aliceToken, ...rest } = init;
  return app.request(
    `/api/v1${path}`,
    {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    TEST_ENV,
  );
}

const patch = (setId: string, body: unknown, token?: string | null) =>
  request(`/sets/${setId}`, {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    token,
  });

const del = (setId: string, token?: string | null) =>
  request(`/sets/${setId}`, { method: "DELETE", token });

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  const body = (await res.json()) as { status: number; code: string; errors?: { path: string }[] };
  expect(body).toMatchObject({ status, code });
  return body;
}

function makeSet(startedAt = "2026-11-14T09:00:00.000Z"): CreateSetInput {
  return {
    clientSetId: crypto.randomUUID(),
    settingsVersion: 1,
    mode: "auto_signal",
    pause: { mode: "fixed", fixedMs: 1000 },
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 30_000).toISOString(),
    reps: [1, 2].map((index) => ({
      index,
      startOffsetMs: 1000 * index,
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

async function row(setId: string) {
  const [r] = await db.select().from(sets).where(eq(sets.id, setId));
  if (!r) throw new Error("セットがありません");
  return r;
}

describe("PATCH /sets/{setId}", () => {
  it("重量・RPE・メモを入れると、更新後のセットの詳細を返し updated_at も進む", async () => {
    const s = await add(alice);
    const before = await row(s.setId);
    const res = await patch(s.setId, {
      weightKg: 100.5,
      rpe: 8.5,
      note: "2 レップ目で少し波打った",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SetDetail;
    expect(body).toMatchObject({
      id: s.setId,
      weightKg: 100.5,
      rpe: 8.5,
      note: "2 レップ目で少し波打った",
      repCount: 2,
    });
    expect(body.reps[0]?.velocityCurve).toEqual([0, 0.5]);
    expect((await row(s.setId)).updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
  });

  it("送った項目だけ変わり、null を送るとその項目だけ空に戻る", async () => {
    const s = await add(alice);
    await patch(s.setId, { weightKg: 80, rpe: 7, note: "軽め" });

    await patch(s.setId, { rpe: 9 });
    expect(await row(s.setId)).toMatchObject({ weightKg: 80, rpe: 9, note: "軽め" });

    await patch(s.setId, { note: null });
    expect(await row(s.setId)).toMatchObject({ weightKg: 80, rpe: 9, note: null });

    // 空のオブジェクトなら何も変えない
    const res = await patch(s.setId, {});
    expect(res.status).toBe(200);
    expect(await row(s.setId)).toMatchObject({ weightKg: 80, rpe: 9, note: null });
  });

  it("重量 0 と 500、RPE 1 と 10 は入る（境界）", async () => {
    const s = await add(alice);
    expect((await patch(s.setId, { weightKg: 0, rpe: 1 })).status).toBe(200);
    expect((await patch(s.setId, { weightKg: 500, rpe: 10 })).status).toBe(200);
    expect(await row(s.setId)).toMatchObject({ weightKg: 500, rpe: 10 });
  });

  it.each([
    [{ weightKg: 100.25 }, "weightKg"],
    [{ weightKg: -0.5 }, "weightKg"],
    [{ weightKg: 500.5 }, "weightKg"],
    [{ weightKg: "100" }, "weightKg"],
    [{ rpe: 0.5 }, "rpe"],
    [{ rpe: 10.5 }, "rpe"],
    [{ rpe: 8.25 }, "rpe"],
    [{ note: "あ".repeat(501) }, "note"],
  ])("%j は 422 で、値は変わらない", async (body, path) => {
    const s = await add(alice);
    const problem = await expectProblem(await patch(s.setId, body), 422, "validation_failed");
    expect(problem.errors?.map((e) => e.path)).toContain(path);
    expect(await row(s.setId)).toMatchObject({ weightKg: null, rpe: null, note: null });
  });

  it("メモは 500 文字まで入る", async () => {
    const s = await add(alice);
    expect((await patch(s.setId, { note: "あ".repeat(500) })).status).toBe(200);
  });

  it("壊れた JSON は 400、大きすぎる本文は 413", async () => {
    const s = await add(alice);
    await expectProblem(await patch(s.setId, "{"), 400, "bad_request");
    await expectProblem(
      await patch(s.setId, { note: "a", pad: "x".repeat(9000) }),
      413,
      "payload_too_large",
    );
  });

  it("他人のセット・存在しないセット・削除したセットは 404 で、何も変えない", async () => {
    const bobs = await add(bob);
    await expectProblem(await patch(bobs.setId, { weightKg: 60 }), 404, "not_found");
    expect((await row(bobs.setId)).weightKg).toBeNull();

    await expectProblem(await patch(crypto.randomUUID(), { weightKg: 60 }), 404, "not_found");

    const removed = await add(alice);
    expect((await del(removed.setId)).status).toBe(204);
    await expectProblem(await patch(removed.setId, { weightKg: 60 }), 404, "not_found");
  });

  it("ログインしていなければ 401、ID が UUID でなければ 422", async () => {
    const s = await add(alice);
    await expectProblem(await patch(s.setId, { weightKg: 60 }, null), 401, "token_missing");
    await expectProblem(await patch("abc", { weightKg: 60 }), 422, "validation_failed");
  });
});

describe("DELETE /sets/{setId}", () => {
  it("204 を返し、行は残して deleted_at を入れ、レップと生データを消す", async () => {
    const s = await add(alice);
    await db.insert(setRawData).values({
      setId: s.setId,
      sampleRateHz: 100,
      formatVersion: 1,
      byteSize: 12,
      payload: new Uint8Array(12),
    });

    const res = await del(s.setId);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    expect((await row(s.setId)).deletedAt).not.toBeNull();
    expect(await db.select().from(reps).where(eq(reps.setId, s.setId))).toEqual([]);
    expect(await db.select().from(setRawData).where(eq(setRawData.setId, s.setId))).toEqual([]);
    await expectProblem(await request(`/sets/${s.setId}`), 404, "not_found");
  });

  it("練習日の一覧と詳細から消え、セットが 0 件になった日は一覧に出ない", async () => {
    const a = await add(alice, makeSet("2026-11-14T09:00:00.000Z"));
    const b = await add(alice, makeSet("2026-11-14T09:10:00.000Z"));
    await del(a.setId);

    const detail = (await (await request(`/sessions/${a.sessionId}`)).json()) as {
      sets: { id: string }[];
    };
    expect(detail.sets.map((x) => x.id)).toEqual([b.setId]);

    await del(b.setId);
    const list = (await (await request("/sessions")).json()) as SessionList;
    expect(list.items).toEqual([]);
  });

  it("削除したあとにデバイスが同じ clientSetId を再送しても復活しない", async () => {
    const input = makeSet();
    const s = await add(alice, input);
    await del(s.setId);

    const again = await add(alice, input);
    expect(again).toEqual({ setId: s.setId, sessionId: s.sessionId, created: false });
    expect((await row(s.setId)).deletedAt).not.toBeNull();
    expect(await db.select().from(reps).where(eq(reps.setId, s.setId))).toEqual([]);
  });

  it("2 回目の削除・他人のセット・存在しないセットは 404", async () => {
    const s = await add(alice);
    expect((await del(s.setId)).status).toBe(204);
    await expectProblem(await del(s.setId), 404, "not_found");

    const bobs = await add(bob);
    await expectProblem(await del(bobs.setId), 404, "not_found");
    expect((await row(bobs.setId)).deletedAt).toBeNull();

    await expectProblem(await del(crypto.randomUUID()), 404, "not_found");
  });

  it("ログインしていなければ 401", async () => {
    const s = await add(alice);
    await expectProblem(await del(s.setId, null), 401, "token_missing");
    expect((await row(s.setId)).deletedAt).toBeNull();
  });
});
