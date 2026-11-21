// 開発用：試しのセットを開発用の DB に入れる（記録の画面を手元で作るため）
//
// 使い方（apps/api で実行。DATABASE_URL と ENVIRONMENT は .dev.vars から読む）：
//   pnpm dev:seed-sets --device-id <uuid>                … 今日を含む直近 3 日に 4 セットずつ
//   pnpm dev:seed-sets --device-id <uuid> --days 7 --sets 5
//
// デバイスが送るのと同じ形を作り、同じ登録処理（registerSet）で入れる。練習日は自動でまとまる。
// 実行するたびに新しいセットが増える（clientSetId が毎回変わる）。本番の DB には使えない
import { parseArgs } from "node:util";
import { z } from "@hono/zod-openapi";
import { createSetInputSchema } from "@press-call/shared";
import { eq } from "drizzle-orm";
import { devices } from "../src/db/schema";
import { registerSet } from "../src/services/sets";
import { describe, fail as failWith, openDevDb } from "./lib/dev-db";
import { sampleSetsForDay } from "./lib/sample-sets";

const USAGE = `使い方:
  pnpm dev:seed-sets --device-id <UUID> [--days <日数>] [--sets <1日のセット数>] [--yes]`;

function fail(message: string, showUsage = false): never {
  failWith(message, showUsage ? USAGE : undefined);
}

const { values } = parseArgs({
  options: {
    "device-id": { type: "string" },
    days: { type: "string", default: "3" },
    sets: { type: "string", default: "4" },
    yes: { type: "boolean", short: "y" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const deviceId = values["device-id"];
if (deviceId === undefined || !z.uuid().safeParse(deviceId).success) {
  fail("--device-id にデバイスの UUID を指定してください", true);
}
const days = Number(values.days);
const perDay = Number(values.sets);
if (!Number.isInteger(days) || days < 1 || days > 60) fail("--days は 1〜60 にしてください");
if (!Number.isInteger(perDay) || perDay < 1 || perDay > 20) fail("--sets は 1〜20 にしてください");

const conn = await openDevDb({ yes: values.yes });
try {
  const [device] = await conn.db
    .select({ userId: devices.userId, name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (!device) fail("そのデバイスは開発用の DB にありません");

  let created = 0;
  for (let d = days - 1; d >= 0; d--) {
    // 日本時間の 19:00 ごろから始めたことにする
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - d);
    day.setUTCHours(10, 0, 0, 0);
    for (const set of sampleSetsForDay(day, perDay, day.getTime() / 60_000)) {
      // デバイスから届くときと同じルールで確かめてから入れる
      const input = createSetInputSchema.parse(set);
      const result = await registerSet(conn.db, { deviceId, userId: device.userId }, input);
      if (result.created) created++;
    }
  }
  console.log(
    `「${device.name}」に ${created} セットを入れました（${days} 日 × ${perDay} セット）`,
  );
} catch (err) {
  console.error(`エラー: ${describe(err)}`);
  process.exitCode = 1;
} finally {
  await conn.close();
}
