// ペアリング（RFC 8628 方式）の業務ルール。ADR-0006、API 仕様書 4 章
//
// 1. ESP32 が authorize でコードを受け取る（deviceCode は ESP32 だけが知る合言葉。DB にはハッシュだけ）
// 2. ユーザーが Web アプリで userCode を入力して許可 → デバイスと初期設定を作る
// 3. ESP32 が token をポーリングし、許可されていればデバイストークンを 1 回だけ受け取る
import { normalizeUserCode, USER_CODE_ALPHABET, USER_CODE_LENGTH } from "@press-call/shared";
import type { Db } from "../db/client";
import { randomBase64Url, sha256Hex } from "../lib/opaque-token";
import { ApiError } from "../middleware/error";
import {
  type AuthorizationState,
  findByUserCode,
  insertAuthorization,
  markApproved,
  markConsumed,
  markDenied,
  PAIRING_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  recordPoll,
} from "../repositories/device-authorizations";
import { insertDevice } from "../repositories/devices";
import { createDefaultDeviceSettings } from "./device-settings";
import { issueDeviceToken } from "./device-tokens";

/** 偏りのない userCode を作る（20 文字から 8 文字。約 2.5×10^10 通り） */
export function generateUserCode(): string {
  // 256 は 20 で割り切れないので、偏らないよう 240 以上の値は捨てて引き直す
  const limit = 256 - (256 % USER_CODE_ALPHABET.length);
  let code = "";
  while (code.length < USER_CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH))) {
      if (b < limit && code.length < USER_CODE_LENGTH) {
        code += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
      }
    }
  }
  return code;
}

export type StartedPairing = {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
};

/** ペアリングを始める（POST /device/authorize） */
export async function startPairing(db: Db): Promise<StartedPairing> {
  const deviceCode = randomBase64Url();
  const deviceCodeHash = await sha256Hex(deviceCode);
  // userCode が使用中のものと重なる確率はごく小さいが、重なったら作り直す
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = generateUserCode();
    if (await insertAuthorization(db, { deviceCodeHash, userCode })) {
      return {
        deviceCode,
        userCode,
        expiresIn: PAIRING_TTL_SECONDS,
        interval: POLL_INTERVAL_SECONDS,
      };
    }
  }
  throw new Error("userCode を作れませんでした");
}

export type PollResult =
  | { ok: true; accessToken: string; deviceId: string }
  | {
      ok: false;
      error:
        | "authorization_pending"
        | "slow_down"
        | "access_denied"
        | "expired_token"
        | "invalid_grant";
    };

/** ESP32 の問い合わせ（POST /device/token） */
export async function pollPairing(db: Db, deviceCode: string): Promise<PollResult> {
  const state = await recordPoll(db, await sha256Hex(deviceCode));
  if (!state) return { ok: false, error: "invalid_grant" };
  // 受け取り済みのコードがまた来たら、期限切れと同じく「最初からやり直す」にする（API 仕様書 4 章）
  if (state.expired || state.status === "consumed") return { ok: false, error: "expired_token" };
  if (state.status === "denied") return { ok: false, error: "access_denied" };
  if (state.status === "pending") {
    return { ok: false, error: state.tooFast ? "slow_down" : "authorization_pending" };
  }

  // approved：トークンを発行する。consumed にする UPDATE と同じトランザクションで行い、
  // 同時に 2 回問い合わせても、トークンが 2 本できないようにする
  const issued = await db.transaction(async (tx) => {
    const deviceId = await markConsumed(tx, state.id);
    if (!deviceId) return undefined;
    const { token } = await issueDeviceToken(tx, deviceId);
    return { accessToken: token, deviceId };
  });
  return issued ? { ok: true, ...issued } : { ok: false, error: "expired_token" };
}

/** 入力されたコードのペアリングを探す。ない・期限切れ・処理済みは 7 章のエラーにする */
async function findPending(db: Db, rawUserCode: string): Promise<AuthorizationState> {
  const userCode = normalizeUserCode(rawUserCode);
  const state = userCode ? await findByUserCode(db, userCode) : undefined;
  if (!state) {
    throw new ApiError(
      404,
      "user_code_not_found",
      "コードが見つかりません",
      "入力し直してください",
    );
  }
  if (state.status !== "pending") {
    throw new ApiError(409, "pairing_already_handled", "このコードは処理済みです");
  }
  if (state.expired) {
    throw new ApiError(
      410,
      "user_code_expired",
      "コードの期限が切れています",
      "ESP32 を再起動して、新しいコードでやり直してください",
    );
  }
  return state;
}

const alreadyHandled = () =>
  new ApiError(409, "pairing_already_handled", "このコードは処理済みです");

/** ユーザーがペアリングを許可する（POST /pairings/approve）。デバイスと初期設定を作る */
export async function approvePairing(
  db: Db,
  userId: string,
  input: { userCode: string; deviceName: string },
): Promise<{ deviceId: string }> {
  const state = await findPending(db, input.userCode);
  return db.transaction(async (tx) => {
    const deviceId = await insertDevice(tx, userId, input.deviceName);
    await createDefaultDeviceSettings(tx, deviceId);
    // 確認してからここまでの間に、別の画面で許可・拒否された（または期限が切れた）
    if (!(await markApproved(tx, state.id, { userId, deviceId, deviceName: input.deviceName }))) {
      throw alreadyHandled(); // 作ったデバイスはトランザクションごと取り消される
    }
    return { deviceId };
  });
}

/** ユーザーが身に覚えのないコードを拒否する（POST /pairings/deny） */
export async function denyPairing(db: Db, userId: string, rawUserCode: string): Promise<void> {
  const state = await findPending(db, rawUserCode);
  if (!(await markDenied(db, state.id, userId))) throw alreadyHandled();
}
