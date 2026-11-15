# ADR-0004: API サーバの言語とフレームワーク

- 状態：承認
- 日付：2026-11-15

## 背景

自前の API サーバを作り、認証（OAuth・JWT）も自分で設計したい。3 日で最初の動くものを作る必要がある。

## 選択肢

| 選択肢 | 良い点 | 気になる点 |
| --- | --- | --- |
| Hono（TypeScript） | 慣れた TypeScript。Cloudflare Workers との相性が最もよい。Zod と OpenAPI の連携がある | Node.js の一部 API が Workers で使えない |
| Go（net/http・Echo など） | 新しい言語を学べる。単体バイナリで動く | 3 日で動かすには学習コストが大きい |

## 決定

Hono（TypeScript）を採用する。

## 理由

慣れた言語で速く作りつつ、画面（React）と型（Zod スキーマ）を共有できる。`@hono/zod-openapi` で仕様書（OpenAPI）を自動生成でき、仕様と実装のずれを防げる。

## 影響

API と Web アプリで共有する型は `packages/shared` に置く。
