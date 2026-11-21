// デバイスの名前の変更と失効（PATCH /devices/{id}・POST /devices/{id}/revoke）のテスト
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { devices, deviceTokens, sets } from "../src/db/schema";
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
  await db.update(deviceTokens).set({ revokedAt: null });
  await db.update(devices).set({ name: "部室のベンチ" });
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

const rename = (deviceId: string, body: unknown, token?: string | null) =>
  request(`/devices/${deviceId}`, { method: "PATCH", body: JSON.stringify(body), token });

const revoke = (deviceId: string, token?: string | null) =>
  request(`/devices/${deviceId}/revoke`, { method: "POST", token });

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  const body = (await res.json()) as { code: string; errors?: { path: string }[] };
  expect(body).toMatchObject({ status, code });
  return body;
}

async function deviceName(deviceId: string) {
  const [d] = await db.select({ name: devices.name }).from(devices).where(eq(devices.id, deviceId));
  return d?.name;
}

describe("PATCH /devices/{deviceId}", () => {
  it("名前を変え、変えたあとのデバイスを返す（前後の空白は落とす）", async () => {
    const res = await rename(alice.deviceId, { name: "  部室のベンチ 2 " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: alice.deviceId, name: "部室のベンチ 2", active: true });
    expect(typeof body.createdAt).toBe("string");
    expect(await deviceName(alice.deviceId)).toBe("部室のベンチ 2");
  });

  it("50 文字までは入り、空・空白だけ・51 文字以上は 422 で変えない", async () => {
    expect((await rename(alice.deviceId, { name: "あ".repeat(50) })).status).toBe(200);
    for (const name of ["", "   ", "あ".repeat(51)]) {
      const problem = await expectProblem(
        await rename(alice.deviceId, { name }),
        422,
        "validation_failed",
      );
      expect(problem.errors?.map((e) => e.path)).toContain("name");
    }
    const missing = await expectProblem(await rename(alice.deviceId, {}), 422, "validation_failed");
    expect(missing.errors?.map((e) => e.path)).toContain("name");
    expect(await deviceName(alice.deviceId)).toBe("あ".repeat(50));
  });

  it("他人のデバイス・存在しないデバイスは 404 で変えない", async () => {
    await expectProblem(await rename(bob.deviceId, { name: "乗っ取り" }), 404, "not_found");
    expect(await deviceName(bob.deviceId)).toBe("部室のベンチ");
    await expectProblem(await rename(crypto.randomUUID(), { name: "x" }), 404, "not_found");
  });

  it("失効させたデバイスも名前は変えられる（一覧で見分けるため）", async () => {
    await revoke(alice.deviceId);
    const res = await rename(alice.deviceId, { name: "古いベンチ" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "古いベンチ", active: false });
  });

  it("ログインしていなければ 401、ID が UUID でなければ 422", async () => {
    await expectProblem(await rename(alice.deviceId, { name: "x" }, null), 401, "token_missing");
    await expectProblem(await rename("abc", { name: "x" }), 422, "validation_failed");
  });
});

describe("POST /devices/{deviceId}/revoke", () => {
  it("204 を返し、そのデバイスのトークンをすべて失効させる（行は残す）", async () => {
    // ペアリングし直した場合など、トークンが複数あるとき
    const [extra] = await db
      .insert(deviceTokens)
      .values({ deviceId: alice.deviceId, tokenHash: `extra-${crypto.randomUUID()}` })
      .returning();

    const res = await revoke(alice.deviceId);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const tokens = await db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.deviceId, alice.deviceId));
    expect(tokens.map((t) => t.id).sort()).toEqual([alice.tokenId, extra?.id].sort());
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);

    const list = (await (await request("/devices")).json()) as { items: { active: boolean }[] };
    expect(list.items[0]?.active).toBe(false);
  });

  it("失効させると、そのデバイスは 401 device_token_revoked を受け取る", async () => {
    expect((await request("/device/settings", { token: alice.token })).status).toBe(200);
    await revoke(alice.deviceId);
    await expectProblem(
      await request("/device/settings", { token: alice.token }),
      401,
      "device_token_revoked",
    );
  });

  it("記録は消えない", async () => {
    await registerSet(
      db,
      { deviceId: alice.deviceId, userId: alice.userId },
      {
        clientSetId: crypto.randomUUID(),
        settingsVersion: 1,
        mode: "count_only",
        pause: null,
        startedAt: "2026-11-14T09:00:00.000Z",
        endedAt: "2026-11-14T09:00:30.000Z",
        reps: [],
      },
    );
    await revoke(alice.deviceId);
    expect(await db.select().from(sets).where(eq(sets.deviceId, alice.deviceId))).toHaveLength(1);
    const sessions = (await (await request("/sessions")).json()) as { items: unknown[] };
    expect(sessions.items).toHaveLength(1);
  });

  it("失効済みでも 204 で、最初に失効させた日時は変えない", async () => {
    await revoke(alice.deviceId);
    const [first] = await db
      .select({ at: deviceTokens.revokedAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.id, alice.tokenId));
    expect((await revoke(alice.deviceId)).status).toBe(204);
    const [second] = await db
      .select({ at: deviceTokens.revokedAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.id, alice.tokenId));
    expect(second?.at?.getTime()).toBe(first?.at?.getTime());
  });

  it("他人のデバイス・存在しないデバイスは 404 で、失効させない", async () => {
    await expectProblem(await revoke(bob.deviceId), 404, "not_found");
    const [t] = await db.select().from(deviceTokens).where(eq(deviceTokens.id, bob.tokenId));
    expect(t?.revokedAt).toBeNull();
    await expectProblem(await revoke(crypto.randomUUID()), 404, "not_found");
  });

  it("ログインしていなければ 401、デバイストークンでは呼べない", async () => {
    await expectProblem(await revoke(alice.deviceId, null), 401, "token_missing");
    await expectProblem(await revoke(alice.deviceId, alice.token), 401, "token_invalid");
  });
});
