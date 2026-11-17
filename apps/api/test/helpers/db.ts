// テスト用の DB。PGlite（WASM で動く PostgreSQL）にマイグレーションを流して使う
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { createApp } from "../../src/index";
import { issueDeviceToken } from "../../src/services/device-tokens";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url).href);

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, client };
}

/** ユーザーとデバイスを 1 つずつ作り、デバイストークンを発行する */
export async function seedDevice(db: Db, email = "lifter@example.com") {
  const [user] = await db.insert(schema.users).values({ email }).returning();
  if (!user) throw new Error("ユーザーを作れませんでした");
  const [device] = await db
    .insert(schema.devices)
    .values({ userId: user.id, name: "部室のベンチ" })
    .returning();
  if (!device) throw new Error("デバイスを作れませんでした");
  const { token, tokenId } = await issueDeviceToken(db, device.id);
  return { userId: user.id, deviceId: device.id, token, tokenId };
}

/** PGlite の DB を使うアプリ。接続は全テストで共有するので close では何もしない */
export function createTestApp(db: Db) {
  return createApp({ openDb: async () => ({ db, close: async () => {} }) });
}
