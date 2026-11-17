// GET /device/settings（ESP32 の設定取得）と、last_seen_at の間引きのテスト
import type { DeviceSettings } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { deviceSettings, devices, deviceTokens } from "../src/db/schema";
import { matchesIfNoneMatch } from "../src/routes/device";
import {
  createDefaultDeviceSettings,
  DEFAULT_DEVICE_SETTINGS,
  updateDeviceSettings,
} from "../src/services/device-settings";
import { issueDeviceToken } from "../src/services/device-tokens";
import { createTestApp, createTestDb, seedDevice } from "./helpers/db";

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
  await db.execute(sql`truncate table device_settings`);
  await db.update(devices).set({ lastSeenAt: null });
  await db.update(deviceTokens).set({ lastUsedAt: null });
});

function get(token: string | undefined, ifNoneMatch?: string) {
  return app.request("/api/v1/device/settings", {
    headers: {
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(ifNoneMatch === undefined ? {} : { "If-None-Match": ifNoneMatch }),
    },
  });
}

async function lastSeen(deviceId: string) {
  const [row] = await db
    .select({ lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row?.lastSeenAt ?? null;
}

describe("GET /device/settings", () => {
  it("初期設定は自動合図・固定 1.0 秒・しきい値はファームの既定値（version 1）", async () => {
    await createDefaultDeviceSettings(db, alice.deviceId);
    const res = await get(alice.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect((await res.json()) as DeviceSettings).toEqual({
      version: 1,
      ...DEFAULT_DEVICE_SETTINGS,
    });
  });

  it("設定の行がないデバイスでも、初期設定を作って返す", async () => {
    const res = await get(alice.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as DeviceSettings).pause).toEqual({ mode: "fixed", fixedMs: 1000 });
    const rows = await db
      .select()
      .from(deviceSettings)
      .where(eq(deviceSettings.deviceId, alice.deviceId));
    expect(rows).toHaveLength(1);
  });

  it("ランダムの範囲を返す", async () => {
    await updateDeviceSettings(db, alice.deviceId, {
      mode: "auto_signal",
      pause: { mode: "random", minMs: 500, maxMs: 1500 },
      stillThreshold: null,
    });
    const body = (await (await get(alice.token)).json()) as DeviceSettings;
    expect(body.pause).toEqual({ mode: "random", minMs: 500, maxMs: 1500 });
  });

  it("回数記録モードでは pause が null", async () => {
    await updateDeviceSettings(db, alice.deviceId, {
      mode: "count_only",
      pause: null,
      stillThreshold: 0.08,
    });
    const body = (await (await get(alice.token)).json()) as DeviceSettings;
    expect(body).toMatchObject({ mode: "count_only", pause: null });
    expect(body.stillThreshold).toBeCloseTo(0.08);
  });

  it("If-None-Match が今の version と同じなら 304（ボディなし）", async () => {
    await createDefaultDeviceSettings(db, alice.deviceId);
    const res = await get(alice.token, '"1"');
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(await res.text()).toBe("");
  });

  it("設定を変えると version が進み、古い version では 200 で新しい設定が返る", async () => {
    await createDefaultDeviceSettings(db, alice.deviceId);
    const updated = await updateDeviceSettings(db, alice.deviceId, {
      mode: "auto_signal",
      pause: { mode: "fixed", fixedMs: 2000 },
      stillThreshold: null,
    });
    expect(updated.version).toBe(2);

    const res = await get(alice.token, '"1"');
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"2"');
    expect(((await res.json()) as DeviceSettings).pause).toEqual({ mode: "fixed", fixedMs: 2000 });
  });

  it("ほかのデバイスの設定は返さない", async () => {
    await updateDeviceSettings(db, alice.deviceId, {
      mode: "count_only",
      pause: null,
      stillThreshold: null,
    });
    const body = (await (await get(bob.token)).json()) as DeviceSettings;
    expect(body.mode).toBe("auto_signal"); // bob は初期設定のまま
  });

  it("トークンがなければ 401", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("失効したトークンなら 401 device_token_revoked", async () => {
    const { token, tokenId } = await issueDeviceToken(db, alice.deviceId);
    await db
      .update(deviceTokens)
      .set({ revokedAt: new Date() })
      .where(eq(deviceTokens.id, tokenId));
    const res = await get(token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("device_token_revoked");
    expect(await lastSeen(alice.deviceId)).toBeNull();
  });
});

describe("If-None-Match の比較", () => {
  it.each([
    ['"3"', true],
    ['W/"3"', true],
    ['"1", "3"', true],
    ["*", true],
    ['"4"', false],
    ["3", false], // 引用符のない値は ETag ではない
    [undefined, false],
  ])("%s → %s", (header, expected) => {
    expect(matchesIfNoneMatch(header, '"3"')).toBe(expected);
  });
});

describe("last_seen_at の間引き", () => {
  it("1 分以内に続けて呼んでも、last_seen_at は最初の時刻のまま", async () => {
    await get(alice.token);
    const first = await lastSeen(alice.deviceId);
    expect(first).toBeInstanceOf(Date);

    await get(alice.token);
    expect(await lastSeen(alice.deviceId)).toEqual(first);
  });

  it("前回から 1 分より空いていれば更新する", async () => {
    const old = new Date(Date.now() - 2 * 60 * 1000);
    await db.update(devices).set({ lastSeenAt: old }).where(eq(devices.id, alice.deviceId));
    await db
      .update(deviceTokens)
      .set({ lastUsedAt: old })
      .where(eq(deviceTokens.id, alice.tokenId));

    await get(alice.token);
    expect((await lastSeen(alice.deviceId))?.getTime()).toBeGreaterThan(old.getTime());
    const [token] = await db
      .select({ lastUsedAt: deviceTokens.lastUsedAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.id, alice.tokenId));
    expect(token?.lastUsedAt?.getTime()).toBeGreaterThan(old.getTime());
  });
});
