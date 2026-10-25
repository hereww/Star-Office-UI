# Star Office UI 6.0.0

![Star Office UI 6.0.0](assets/company-office-connected-v5/qa/desktop-4k-overview.png)

Star Office UI は、AI 協働環境をリアルタイムに可視化する独立運用のオフィス基盤です。6.0.0 はフロントエンド、バックエンド、デスクトップシェル、Sub2API テレメトリ連携、オフライン公開ツールを含む全面書き換え版です。

このリポジトリは `hereww/Star-Office-UI` の現在の完全なソースです。説明、画像、構成、デプロイドキュメントは現行コードに合わせています。

## 含まれるもの

- 16 席のピクセルオフィス、四方向キャラクター、着席状態、画面エフェクト、ステータス表示、モバイル対応。
- Flask の社員/管理画面、設定 API、スナップショット、バージョン付き静的リソース。
- Sub2API のユーザーテレメトリをオフィス用スナップショットへ投影する読み取り専用 collector。
- `integrations/sub2api/` のホストソース、ユーザーテレメトリプラグイン、UI、マイグレーション、パッチ、`.s2plugin` ツール。
- 同じ Python バックエンドを使う Electron/Tauri デスクトップシェル。
- `deploy/office/` のオフライン公開、Docker Compose、Nginx/TLS、バックアップ、ロールバックツール。

## クイックスタート

Python 3.10 以上が必要です。

```bash
git clone https://github.com/hereww/Star-Office-UI.git
cd Star-Office-UI
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
cp state.sample.json state.json
python backend/app.py
```

`http://127.0.0.1:19000/` を開いてください。書き換え版のオフィスモードを確認する場合は [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) の環境変数を明示的に設定します。

## ドキュメント

- [`docs/PROJECT_STRUCTURE.md`](./docs/PROJECT_STRUCTURE.md)：構成とソース境界。
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)：開発、オフライン公開、Docker、TLS、バックアップ、ロールバック。
- [`integrations/sub2api/README.md`](./integrations/sub2api/README.md)：Sub2API ソースとプラグイン。
- [`deploy/office/README.md`](./deploy/office/README.md)：正式公開の運用条件。

生成済みアーカイブ、依存キャッシュ、実行時データ、OAuth 認証情報、トークン、秘密鍵、データベースはソースリポジトリに含めません。Sub2API ソース内の OAuth 値は `REDACTED_*` プレースホルダーです。本番環境では管理された設定から注入してください。

ルートプロジェクトは [`LICENSE`](./LICENSE) に従います。Sub2API ソースは上流のライセンス表示を保持しています。
