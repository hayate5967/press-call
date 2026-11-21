// アプリの入口。データ取得（TanStack Query）とルーター（TanStack Router）を組み立てる
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiProblem, AuthRequiredError } from "./api/client";
import { rememberReturnTo } from "./lib/return-to";
import { createAppRouter } from "./router";
import "./style.css";

/** 画面の途中でログインが切れたら（リフレッシュも失敗したら）、いた画面を覚えてログイン画面へ */
function onApiError(err: unknown) {
  if (!(err instanceof AuthRequiredError)) return;
  queryClient.clear();
  rememberReturnTo(location.pathname + location.search);
  const reason = err.reason === "refresh_token_reused" ? err.reason : "session_expired";
  void router.navigate({ to: "/login", search: { reason }, replace: true });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // ログインしているかの確認（meQuery）が 401 になるのは「まだログインしていない」だけ。
    // ここで /login へ移すと、/login でもう一度確かめて 401 → また移す、を繰り返してしまう。
    // 確認の結果はルーター（router.tsx の beforeLoad）が扱う
    onError: (err, query) => {
      if (query.meta?.authCheck) return;
      onApiError(err);
    },
  }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      // ログイン切れ・4xx はやり直しても同じなので、5xx と通信失敗だけ 1 回やり直す
      retry: (failureCount, err) =>
        failureCount < 1 &&
        !(err instanceof AuthRequiredError) &&
        !(err instanceof ApiProblem && err.status < 500),
    },
  },
});

const router = createAppRouter(queryClient);

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
