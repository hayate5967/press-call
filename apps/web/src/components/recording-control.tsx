// セットの開始・終了ボタン（ADR-0011、FR-V11）。「今日」タブの下のほう（親指が届く位置）に固定して出す
//
// - 押すと API の「記録の指示」を切り替える。デバイスは 5 秒おきに取りに来る
// - 押してからデバイスに伝わるまでは「伝えています」、伝わったら「記録中」と経過時間
// - 15 秒たっても伝わらなければ、電源とテザリングを確かめるよう出す
// - セットの区切りは押した時刻で決まる（デバイスがさかのぼって組み立てる）ので、伝わるのを待たずに始めてよい
import type { Device, RecordingState } from "@press-call/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { SignalSettingsSheet } from "@/components/signal-settings-sheet";
import { Button } from "@/components/ui/button";
import { formatElapsed, type RecordingStatus, recordingStatus } from "@/lib/recording";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { errorMessage } from "../messages";
import { devicesQuery, recordingQuery } from "../queries";

export function RecordingControl() {
  const devices = useQuery(devicesQuery);
  const active = devices.data?.filter((d) => d.active) ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const device = active.find((d) => d.id === chosenId) ?? active[0];

  // 使えるデバイスがなければ出さない（今日タブの案内から設定タブへ）
  if (!device) return null;
  return (
    <div className="fixed inset-x-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-10 mx-auto max-w-md">
      <Control
        key={device.id}
        device={device}
        others={active.length > 1 ? active : []}
        onChoose={setChosenId}
      />
    </div>
  );
}

function Control(props: { device: Device; others: Device[]; onChoose: (id: string) => void }) {
  const { device } = props;
  const queryClient = useQueryClient();
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const query = useQuery({
    ...recordingQuery(device.id),
    // 伝わるのを待っているあいだは 2 秒おき、記録中は（自動で終わったときに気づけるよう）5 秒おき
    refetchInterval: (q) => {
      const s = q.state.data;
      if (!s) return false;
      if (s.seq !== s.ackedSeq) return 2000;
      return s.recording ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const state = query.data;

  const toggle = useMutation({
    mutationFn: async (recording: boolean) =>
      (
        await api.json<RecordingState>(`/devices/${device.id}/recording`, {
          method: "PUT",
          body: JSON.stringify({ recording }),
        })
      ).data,
    onMutate: () => setPressedAt(Date.now()),
    onSuccess: (data) => queryClient.setQueryData(recordingQuery(device.id).queryKey, data),
  });

  // 経過時間と「届いていない」の判定のため、1 秒ごとに描き直す
  const ticking = state ? state.recording || state.seq !== state.ackedSeq : false;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  if (!state) return null;
  const status = recordingStatus(state, now, pressedAt);
  const recording = state.recording;

  return (
    <div className="flex flex-col gap-2 rounded-[1.75rem] border border-white/60 bg-card/80 p-2 shadow-[0_8px_32px_-8px_oklch(0.3_0.08_250/0.3)] backdrop-blur-xl backdrop-saturate-150 reduce-transparency:bg-card dark:border-white/10 dark:bg-card/85">
      {/* 合図の設定。押すと下からシートが出てくる（下に払うと閉じる） */}
      <SignalSettingsSheet device={device} recording={recording} />
      <StatusLine
        status={status}
        deviceName={device.name}
        elapsed={
          recording && state.startedAt ? formatElapsed(now - Date.parse(state.startedAt)) : null
        }
        error={toggle.error ? errorMessage(toggle.error) : null}
      />
      {props.others.length > 0 && !recording && (
        <fieldset className="flex gap-1 overflow-x-auto px-1">
          <legend className="sr-only">使うデバイス</legend>
          {props.others.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={d.id === device.id}
              onClick={() => props.onChoose(d.id)}
              className={cn(
                "h-9 shrink-0 rounded-full px-3 text-sm font-medium",
                d.id === device.id ? "bg-primary/12 text-primary" : "text-muted-foreground",
              )}
            >
              {d.name}
            </button>
          ))}
        </fieldset>
      )}
      <Button
        size="lg"
        variant={recording ? "destructive" : "default"}
        className="h-14 w-full text-lg"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!recording)}
      >
        {toggle.isPending ? (
          <LoaderCircle className="size-6 motion-safe:animate-spin" aria-hidden />
        ) : recording ? (
          <Square className="size-5 fill-current" aria-hidden />
        ) : (
          <Play className="size-5 fill-current" aria-hidden />
        )}
        {recording ? "セット終了" : "セット開始"}
      </Button>
    </div>
  );
}

/** ボタンの上の 1 行。今の状態（とつながらないときの対処）を出す。読み上げソフトにも知らせる */
function StatusLine(props: {
  status: RecordingStatus;
  deviceName: string;
  elapsed: string | null;
  error: string | null;
}) {
  const { status } = props;
  let text: string;
  let tone: "muted" | "live" | "warn" = "muted";
  if (props.error) {
    text = props.error;
    tone = "warn";
  } else if (status === "sending") {
    text = `「${props.deviceName}」に伝えています…（5 秒ほど）`;
  } else if (status === "unreachable") {
    text = "デバイスに届いていません。電源とテザリングを確かめてください";
    tone = "warn";
  } else if (status === "recording") {
    text = `記録中 ${props.elapsed ?? ""}`;
    tone = "live";
  } else {
    text = `「${props.deviceName}」でセットを記録します`;
  }
  return (
    <p
      role="status"
      className={cn(
        "flex min-h-6 items-center justify-center gap-2 px-2 pt-1 text-center text-sm",
        tone === "warn" ? "text-destructive" : "text-muted-foreground",
        tone === "live" && "font-semibold text-foreground tabular-nums",
      )}
    >
      {tone === "live" && (
        <span
          aria-hidden
          className="size-2.5 rounded-full bg-destructive motion-safe:animate-pulse"
        />
      )}
      {tone === "warn" && <CircleAlert className="size-4 shrink-0" aria-hidden />}
      {status === "sending" && !props.error && (
        <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      )}
      {text}
    </p>
  );
}
