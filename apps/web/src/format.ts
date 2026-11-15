import type { Health } from "@press-call/shared";

/** API の接続状態を画面用の文言にする */
export function formatApiStatus(health: Health | null, error: string | null): string {
  if (error) return `API に接続できません：${error}`;
  if (!health) return "API に接続中…";
  return `API に接続しました（${health.time}）`;
}
