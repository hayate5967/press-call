// 画面に出す値の書式

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO 8601 の日時を日本時間の「11/15 18:30」の形にする */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const time = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO 8601 の日時を日本時間の「18:30」の形にする */
export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 練習日（日本時間の日付 "2026-11-14"）を「11月14日（土）」にする。
 * 今年でなければ年も付ける（「2025年11月14日（金）」）
 */
export function formatSessionDate(date: string, today: string = todayInJapan()): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // 曜日は日付だけで決まるので、UTC の正午として計算する（時差で日がずれない）
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : `${y}年`;
  return `${year}${m}月${d}日（${weekday}）`;
}

/** 今日の日付（日本時間、"2026-11-14" の形）。練習日の日付と比べるのに使う */
export function todayInJapan(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 速度（m/s）を小数 2 桁にする。値がなければ「—」 */
export function formatVelocity(mps: number | null): string {
  return mps === null ? "—" : mps.toFixed(2);
}
