// ユーザーとログイン手段（oauth_accounts）の DB アクセス
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { oauthAccounts, users } from "../db/schema";

export type User = { id: string; email: string; displayName: string | null };

export async function findUser(db: Db, userId: string): Promise<User | undefined> {
  const [row] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

export async function findUserIdByOAuth(
  db: Db,
  provider: string,
  subject: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerSubject, subject)));
  return row?.userId;
}

/** 表示用の情報（メール・名前）を最新にする。Google 側で変わることがあるため */
export async function updateUserProfile(
  db: Db,
  userId: string,
  profile: { email: string; displayName: string | null },
): Promise<void> {
  await db.update(users).set(profile).where(eq(users.id, userId));
}

/**
 * ユーザーとログイン手段を作る。
 * 同じ Google アカウントで同時にログインして先を越されたときは undefined を返す
 * （呼び出し側はトランザクションを取り消して、探し直す）
 */
export async function insertUserWithOAuth(
  db: Db,
  input: { email: string; displayName: string | null; provider: string; subject: string },
): Promise<string | undefined> {
  const [user] = await db
    .insert(users)
    .values({ email: input.email, displayName: input.displayName })
    .returning({ id: users.id });
  if (!user) throw new Error("ユーザーを作れませんでした");
  const [account] = await db
    .insert(oauthAccounts)
    .values({ userId: user.id, provider: input.provider, providerSubject: input.subject })
    .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerSubject] })
    .returning({ id: oauthAccounts.id });
  return account ? user.id : undefined;
}
