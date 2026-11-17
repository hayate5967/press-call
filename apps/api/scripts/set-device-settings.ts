// 開発用：デバイスの設定（モード・待ち時間）を変える（Web アプリの設定画面ができるまでの代わり）
//
// 使い方（apps/api で実行。DATABASE_URL と ENVIRONMENT は .dev.vars から読む）：
//   pnpm device:settings --device-id <uuid> --show              … 今の設定を表示するだけ
//   pnpm device:settings --device-id <uuid> --fixed 1.0         … 自動合図・固定 1.0 秒
//   pnpm device:settings --device-id <uuid> --random 0.5-1.5    … 自動合図・0.5〜1.5 秒のランダム
//   pnpm device:settings --device-id <uuid> --count-only        … 回数記録（合図なし）
//   --still 0.06 を付けると静止のしきい値（m/s）も変える。付けなければファームの既定値に戻す
//
// 設定は丸ごと置き換え、version が 1 つ進む。ESP32 は次の問い合わせ（5 秒おき、セット中は止まる）で受け取る
import { parseArgs } from "node:util";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { devices } from "../src/db/schema";
import { findDeviceSettings } from "../src/repositories/device-settings";
import { updateDeviceSettings } from "../src/services/device-settings";
import { describe, fail as failWith, openDevDb } from "./lib/dev-db";
import { describeSettings, parseSettingsArgs } from "./lib/settings-args";

const USAGE = `使い方:
  pnpm device:settings --device-id <UUID> --show
  pnpm device:settings --device-id <UUID> --fixed <秒> [--still <m/s>] [--yes]
  pnpm device:settings --device-id <UUID> --random <最小秒>-<最大秒> [--still <m/s>] [--yes]
  pnpm device:settings --device-id <UUID> --count-only [--still <m/s>] [--yes]`;

function fail(message: string, showUsage = false): never {
  failWith(message, showUsage ? USAGE : undefined);
}

const { values } = parseArgs({
  options: {
    "device-id": { type: "string" },
    show: { type: "boolean" },
    fixed: { type: "string" },
    random: { type: "string" },
    "count-only": { type: "boolean" },
    still: { type: "string" },
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

const changeOptions = [
  values.fixed !== undefined && "--fixed",
  values.random !== undefined && "--random",
  values["count-only"] && "--count-only",
  values.still !== undefined && "--still",
].filter(Boolean);
if (values.show && changeOptions.length > 0) {
  // 「変えたつもりで、表示だけして終わる」のを防ぐ
  fail(
    `--show は ${changeOptions.join("・")} と一緒に使えません（表示だけか、変更だけにしてください）`,
    true,
  );
}

// 書き込む前に、引数の誤りをすべて確かめる
const parsed = values.show
  ? undefined
  : parseSettingsArgs({
      fixed: values.fixed,
      random: values.random,
      countOnly: values["count-only"],
      still: values.still,
    });
if (parsed && !parsed.ok) fail(parsed.error, true);

// 表示だけなら書き込まないので確認しない
const conn = await openDevDb({ yes: values.show || values.yes });

try {
  const [device] = await conn.db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (!device) throw new Error(`デバイス ${deviceId} が見つかりません`);

  // 表示は読むだけにする（行がなくても作らない。--show は確認なしで動くため）
  const before = await findDeviceSettings(conn.db, deviceId);
  console.log(
    `今の設定:   ${before ? describeSettings(before) : "まだない（ESP32 が最初に取得したときに初期設定が作られる）"}`,
  );
  if (parsed?.ok) {
    const after = await updateDeviceSettings(conn.db, deviceId, parsed.input);
    console.log(`新しい設定: ${describeSettings(after)}`);
  }
} catch (err) {
  console.error(`エラー: ${describe(err)}`);
  process.exitCode = 1;
} finally {
  await conn.close();
}
