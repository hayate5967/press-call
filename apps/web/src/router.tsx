// 画面と URL の対応（TanStack Router、ADR-0008）
//
// - /login だけはログインなしで見られる。ほかの画面は "auth" の下に置き、入る前にログインを確かめる
// - ログインしていなければ、いた画面を覚えてから /login へ。Google から戻ると / に着くので、そこで元の画面へ戻す
// - サーバや通信の一時的な問題でログインを確かめられないときは、ログアウトさせずに「もう一度試す」を出す
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AuthRequiredError } from "./api/client";
import { AppShell } from "./components/app-shell";
import { Loading, Page } from "./components/layout";
import { rememberReturnTo, takeReturnTo } from "./lib/return-to";
import { isUuid, parseLoginSearch, parsePairSearch } from "./lib/search";
import { AuthErrorPage } from "./pages/AuthErrorPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PairPage } from "./pages/PairPage";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsTabPage } from "./pages/SettingsTabPage";
import { TodayPage } from "./pages/TodayPage";
import { meQuery } from "./queries";

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: parseLoginSearch,
  // すでにログインしていればトップへ（ログインしていない・確かめられないときはこの画面のまま）
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery).catch(() => null);
    if (me) throw redirect({ to: "/", replace: true });
  },
  component: LoginPage,
});

/** ログインが必要な画面のまとまり（URL には出ない） */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  beforeLoad: async ({ context, location }) => {
    try {
      return { me: await context.queryClient.ensureQueryData(meQuery) };
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        rememberReturnTo(location.href);
        const reused = err.reason === "refresh_token_reused";
        throw redirect({
          to: "/login",
          search: reused ? { reason: err.reason } : {},
          replace: true,
        });
      }
      throw err; // 503・通信失敗など → errorComponent
    }
  },
  pendingComponent: () => (
    <Page title="press-call">
      <Loading />
    </Page>
  ),
  errorComponent: AuthErrorPage,
  // 下部タブ（今日・履歴・設定）の枠
  component: AppShell,
});

const todayRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/",
  // Google から戻ってきたら、ログイン前にいた画面へ
  beforeLoad: () => {
    const back = takeReturnTo();
    if (back) throw redirect({ href: back, replace: true });
  },
  component: TodayPage,
});

const historyRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/history",
  component: HistoryPage,
});

const sessionRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/history/$sessionId",
  beforeLoad: ({ params }) => {
    if (!isUuid(params.sessionId)) throw notFound();
  },
  component: SessionPage,
});

const settingsTabRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/settings",
  component: SettingsTabPage,
});

const pairRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/devices/pair",
  validateSearch: parsePairSearch,
  component: PairPage,
});

const deviceSettingsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/devices/$deviceId/settings",
  beforeLoad: ({ params }) => {
    if (!isUuid(params.deviceId)) throw notFound();
  },
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([
    todayRoute,
    historyRoute,
    sessionRoute,
    settingsTabRoute,
    pairRoute,
    deviceSettingsRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultNotFoundComponent: NotFoundPage,
    // ログインの確認が速ければ、読み込み中の表示をちらつかせない
    defaultPendingMs: 300,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
