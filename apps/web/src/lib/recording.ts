// セットの開始・終了ボタン（ADR-0011、FR-V11）の表示の決め方。画面から切り離してテストする
import type { RecordingState } from "@press-call/shared";

/** デバイスが指示を取りに来る間隔（5 秒）に余裕を持たせた、待つ時間。これを過ぎたら「届いていない」 */
export const ACK_TIMEOUT_MS = 15_000;

export type RecordingStatus =
  /** 停止中（指示はデバイスに伝わっている、またはまだ一度も押していない） */
  | "idle"
  /** 押したが、デバイスがまだ取りに来ていない（最大 5 秒） */
  | "sending"
  /** 記録中で、デバイスに伝わっている */
  | "recording"
  /** 押してからしばらくたってもデバイスが取りに来ない（電源・テザリングを確かめてもらう） */
  | "unreachable";

/**
 * 今の状態。updatedAt（押した時刻）はサーバの時計なので、スマホの時計とのずれに備えて
 * 「押してからの経過」はスマホで押した時刻（pressedAtMs）があればそちらで測る
 */
export function recordingStatus(
  state: RecordingState,
  nowMs: number,
  pressedAtMs: number | null,
): RecordingStatus {
  if (state.seq !== state.ackedSeq) {
    const since = pressedAtMs ?? (state.updatedAt ? Date.parse(state.updatedAt) : nowMs);
    return nowMs - since >= ACK_TIMEOUT_MS ? "unreachable" : "sending";
  }
  return state.recording ? "recording" : "idle";
}

/** 経過時間を「0:42」「12:05」の形にする */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
