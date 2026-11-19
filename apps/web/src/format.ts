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
