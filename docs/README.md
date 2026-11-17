# 設計ドキュメント

| ドキュメント | 内容 | 置き場所 |
| --- | --- | --- |
| 要件定義書 | 目的、機能要件・非機能要件、制約、MVP の範囲 | `requirements.md`（Claude Docs から Markdown で書き出して置く） |
| 技術選定 | 採用技術の比較と理由 | `tech-selection.md`（同上） |
| アーキテクチャ設計 | 全体図、ファームと API の内部構成、処理の流れ、実行環境 | `architecture.md`（同上） |
| データ設計 | テーブル定義と設計の判断 | `data-design.md`（同上）。ER 図だけは [er.md](./er.md) |
| API 仕様書 | エンドポイント、リクエスト・レスポンス、エラーコード | `api.md`（同上）。実装後は `/api/v1/openapi.json` が正 |
| ADR | 設計の判断の記録（1 件 1 ファイル） | [adr/](./adr/) |

## ADR 一覧

| 番号 | タイトル | 状態 |
| --- | --- | --- |
| [0001](./adr/0001-device-to-server-route.md) | デバイスからサーバへの記録の経路 | 承認 |
| [0002](./adr/0002-detection-on-device.md) | 静止判定をデバイス側で行う | 承認 |
| [0003](./adr/0003-detection-algorithm.md) | 判定と速度推定のアルゴリズム | 提案 |
| [0004](./adr/0004-api-framework.md) | API サーバの言語とフレームワーク | 承認 |
| [0005](./adr/0005-user-authentication.md) | ユーザー認証の方式 | 承認 |
| [0006](./adr/0006-device-pairing.md) | デバイスのペアリング方式 | 承認 |
| [0007](./adr/0007-hosting.md) | ホスティング先 | 承認 |
| [0008](./adr/0008-web-frontend.md) | Web アプリのフレームワーク | 承認 |
| [0009](./adr/0009-raw-data-storage.md) | 生データの保存方法 | 承認 |
| [0010](./adr/0010-api-test-environment.md) | API のテスト環境 | 承認 |

新しい ADR は [0000-template.md](./adr/0000-template.md) をコピーして番号を振る。決定を変えるときは古い ADR を書き換えず、新しい ADR を作って古い方の状態を「置き換え」にする。
