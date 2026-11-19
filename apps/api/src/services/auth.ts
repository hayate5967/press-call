// ユーザー認証の業務ルール（ADR-0005、API 仕様書 3 章）
//
// - ログイン：Google の sub でユーザーを探し（なければ作る）、新しい系統のリフレッシュトークンを発行
// - 更新（ローテーション）：未使用のトークンを使用済みにし、同じ系統で新しいトークンを発行
// - 使用済みのトークンが再び来たら盗難とみなし、系統ごと失効
//   ただし使用後 10 秒以内は「2 つのタブからの同時更新」とみなし、アクセストークンだけ返す
//   （新しいリフレッシュトークンは、先に返った応答の Cookie にすでに入っているため。2026-11-17 決定）
import type { Db } from "../db/client";
import type { GoogleIdentity } from "../lib/google";
import { randomBase64Url, sha256Hex } from "../lib/opaque-token";
import {
  findRefreshTokenState,
  insertRefreshToken,
  markRefreshTokenUsed,
  revokeRefreshTokenFamily,
} from "../repositories/refresh-tokens";
import { findUserIdByOAuth, insertUserWithOAuth, updateUserProfile } from "../repositories/users";

const GOOGLE = "google";
const REFRESH_TOKEN_PREFIX = "rt_";

/** Google で確認できた人のユーザー ID を返す。初めてならユーザーを作る */
export async function findOrCreateGoogleUser(db: Db, identity: GoogleIdentity): Promise<string> {
  const profile = { email: identity.email, displayName: identity.name };
  const existing = await findUserIdByOAuth(db, GOOGLE, identity.sub);
  if (existing) {
    await updateUserProfile(db, existing, profile);
    return existing;
  }

  const LOST_RACE = Symbol("lost race");
  try {
    return await db.transaction(async (tx) => {
      const created = await insertUserWithOAuth(tx, {
        ...profile,
        provider: GOOGLE,
        subject: identity.sub,
      });
      // 同時に別のリクエストが同じ人を作った。作りかけのユーザーを残さないよう取り消す
      if (!created) throw LOST_RACE;
      return created;
    });
  } catch (err) {
    if (err !== LOST_RACE) throw err;
    const winner = await findUserIdByOAuth(db, GOOGLE, identity.sub);
    if (!winner) throw new Error("ユーザーを作れませんでした");
    return winner;
  }
}

/** 新しいリフレッシュトークンを発行して保存する（DB にはハッシュだけ）。平文は戻り値でだけ返す */
async function issueRefreshToken(db: Db, userId: string, familyId: string): Promise<string> {
  const token = REFRESH_TOKEN_PREFIX + randomBase64Url();
  await insertRefreshToken(db, { userId, familyId, tokenHash: await sha256Hex(token) });
  return token;
}

/** ログインした直後に呼ぶ。新しい系統のリフレッシュトークンを返す */
export function startRefreshFamily(db: Db, userId: string): Promise<string> {
  return issueRefreshToken(db, userId, crypto.randomUUID());
}

export type RotateResult =
  /** 交換できた。新しいトークンを Cookie に入れる */
  | { kind: "rotated"; userId: string; refreshToken: string }
  /** 使用直後の再利用（同時更新）。アクセストークンだけ返し、Cookie は変えない */
  | { kind: "grace"; userId: string }
  /** 使用済みの再利用。系統ごと失効させた */
  | { kind: "reused" }
  /** 存在しない・期限切れ・失効済み */
  | { kind: "invalid" };

export async function rotateRefreshToken(db: Db, token: string): Promise<RotateResult> {
  const tokenHash = await sha256Hex(token);

  // 「使用済みにする」と「新しいトークンの保存」を 1 つのトランザクションで行う。
  // 片方だけ成功すると、手元に使えるトークンがなくなり、次の更新で盗難と誤判定されるため
  const rotated = await db.transaction(async (tx) => {
    const used = await markRefreshTokenUsed(tx, tokenHash);
    if (!used) return undefined;
    const refreshToken = await issueRefreshToken(tx, used.userId, used.familyId);
    return { kind: "rotated" as const, userId: used.userId, refreshToken };
  });
  if (rotated) return rotated;

  // 使えなかった理由を調べる
  const state = await findRefreshTokenState(db, tokenHash);
  if (!state || state.revoked || state.expired) return { kind: "invalid" };
  if (state.usedWithinGrace) return { kind: "grace", userId: state.userId };
  // 使用済みのトークンが猶予を過ぎて来た → 盗まれた可能性。正規の利用者の分も含めて系統ごと止める
  await revokeRefreshTokenFamily(db, state.familyId);
  return { kind: "reused" };
}

/** ログアウト。このトークンの系統をすべて失効させる（知らないトークンなら何もしない） */
export async function revokeRefreshToken(db: Db, token: string): Promise<void> {
  const state = await findRefreshTokenState(db, await sha256Hex(token));
  if (state) await revokeRefreshTokenFamily(db, state.familyId);
}
