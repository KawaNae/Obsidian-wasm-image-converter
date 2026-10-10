# Developer Guide

## CSS スタイル規則

obsidian-task-viewer のスタイル規則に準拠する。

### BEM 命名規則

```
.block                        /* ブロック: 独立したコンポーネント */
.block__element               /* エレメント: ブロックの構成要素 */
.block--modifier              /* モディファイア: バリエーションや状態 */
.block__element--modifier     /* エレメント + モディファイア */
```

**プレフィックス:** `wasm-image-`

```css
/* 例 */
.wasm-image-drop-zone                   /* ブロック */
.wasm-image-drop-zone__icon             /* エレメント */
.wasm-image-drop-zone--disabled         /* モディファイア */
.wasm-image-settings__nav-btn           /* エレメント */
.wasm-image-settings__nav-btn--active   /* エレメント + モディファイア */
```

### CSS 変数トークン

2層構造で管理する。コンポーネントファイルでは Obsidian 変数を直接使わず、必ず `--wimg-*` トークンを経由する。

**Layer 1: `:root`** — テーマに依存しない定数（サイズ、スペーシング、z-index）

```css
:root {
    --wimg-modal-max-width: 500px;
    --wimg-drop-zone-min-height: 150px;
    --wimg-thumbnail-size: 80px;
}
```

**Layer 2: `body`** — Obsidian テーマ変数から `--wimg-*` トークンへのマッピング

```css
body {
    --wimg-bg-primary: var(--background-primary);
    --wimg-bg-secondary: var(--background-secondary);
    --wimg-text: var(--text-normal);
    --wimg-text-muted: var(--text-muted);
    --wimg-accent: var(--interactive-accent);
    --wimg-border: var(--background-modifier-border);
    --wimg-radius-s: var(--radius-s);
}
```

**トークン命名:**
- `--wimg-bg-*`: 背景色
- `--wimg-text-*`: テキスト色
- `--wimg-border*`: ボーダー色
- `--wimg-radius-*`: 角丸

### ボタン・入力要素の詳細度

Obsidian はグローバルな `button`, `input` スタイルを適用する（詳細度 0,0,1）。プラグインのセレクタはこれに勝つ必要がある。

```css
/* Good — 詳細度 0,2,0、Obsidian のグローバルに勝つ */
.wasm-image-settings .wasm-image-settings__nav-btn { ... }

/* Bad — 詳細度 0,1,1、Obsidian のスタイルと衝突する可能性 */
button.wasm-image-settings__nav-btn { ... }
```

### 状態の表現

```css
/* 疑似クラス（組み込み状態） */
.element:hover { ... }
.element:focus-visible { ... }
.element:disabled { ... }

/* 状態クラス（JS 駆動の状態） */
.wasm-image-drop-zone.drag-over { ... }
.wasm-image-prediction-info.visible { ... }

/* モディファイア（永続的なバリエーション） */
.wasm-image-drop-zone--disabled { ... }
.wasm-image-settings__nav-btn--active { ... }
```

### プロパティの記述順

```css
.element {
    /* Positioning */
    position: relative;
    z-index: 1;

    /* Display & Box Model */
    display: flex;
    padding: 8px;
    margin: 0;

    /* Typography */
    font-size: 14px;
    color: var(--wimg-text);

    /* Visual */
    background-color: var(--wimg-bg-primary);
    border-radius: var(--wimg-radius-s);
    box-shadow: none;

    /* Misc */
    transition: color 0.15s ease;
    cursor: pointer;
    user-select: none;
}
```

### ファイル構成

`src/styles/` にコンポーネント単位で分割する。将来的にファイルを分ける場合は `_` プレフィックスを使う。

```
src/styles/
├── styles.css          # 現在は単一ファイル（将来分割可能）
```

分割する場合の例:
```
src/styles/
├── _variables.css      # CSS トークン定義
├── _modal.css          # モーダルコンポーネント
├── _drop-zone.css      # ドロップゾーン
├── _settings.css       # 設定タブ UI
├── _thumbnail.css      # サムネイルグリッド
└── _progress.css       # プログレスバー
```

### ツールチップ

- `aria-label` を使用する（Obsidian がスタイル付きツールチップとして表示）
- `title` 属性は使わない（ブラウザのネイティブツールチップと重複する）

## ビルド

```bash
npm run dev    # watch モード（開発時）
npm run build  # tsc 型チェック → production ビルド
```

出力先: `$OBSIDIAN_VAULT_PATH/.obsidian/plugins/obsidian-wasm-image/`
デフォルト: `C:\Obsidian\Dev`

## プロジェクト構造

```
src/
├── main.ts                    # プラグインエントリーポイント
├── settings.ts                # 設定型定義・デフォルト値
├── settings-tab.ts            # 設定タブ UI（タブベース）
├── globals.d.ts               # グローバル型宣言 (__BUILD_TIME__)
├── conversion/                # 変換の層（Obsidian の保存や UI に依存しない）
│   ├── decode.ts              # decode(blob): 一度だけデコードし、予測と変換で使い回す
│   ├── render.ts              # render(decoded, encode, size?): リサイズとグレースケールを適用した RGBA
│   ├── encoders.ts            # 形式ごとの拡張子、MIME、非可逆か、encode() の登録表
│   ├── webp-encoder.ts        # jSquash WebP
│   ├── avif-encoder.ts        # jSquash AVIF
│   ├── canvas-encoder.ts      # Canvas API（JPEG/PNG）
│   ├── convert.ts             # convert(decoded, encode) / convertBlob(blob, encode)
│   ├── predict.ts             # analyze(), estimateBySample()
│   ├── estimate.ts            # 純粋: 経験式、サンプルの計画と外挿
│   ├── geometry.ts            # 純粋: リサイズの寸法、quality の変換
│   ├── grayscale.ts           # 純粋: グレースケール
│   ├── wasm-assets.ts         # 純粋: 取得する WASM の版と SHA-256
│   └── wasm-loader.ts         # WASM の取得、検証、キャッシュ
├── save/                      # 保存の層（変換済みの Blob を受け取り、デコードや変換はしない）
│   ├── name.ts                # 純粋: resolveName(template, context, formatDate)、禁止文字、区切りの詰め
│   ├── paths.ts               # 純粋: 重複を避ける名前（" 1"、" 2"）、置き換え後の名前、添付ファイルのフォルダ、パスの結合
│   └── save.ts                # saveNew / replaceExisting / embedLink
├── entry/                     # 入口の層（変換の層と保存の層を呼ぶ）
│   ├── auto-convert.ts        # ドロップとペーストの自動変換。リンクを選んだ順にまとめて挿入する
│   ├── drop-position.ts       # 公開の API でドロップの位置を得る（EditorView.findFromDOM、posAtCoords）
│   ├── batch-convert.ts       # 一括変換（vault 全体、フォルダ）、確認のダイアログ、進捗の Notice
│   └── targets.ts             # 純粋: 対象の判定、リンクの連結、一括変換の対象と集計
├── ui/                        # 変換のダイアログ（右クリックメニューの置き換えのモードを含む）
│   ├── converter-dialog.ts    # openConverterDialog: 殻 OverlayShell に ConverterBody を載せる
│   ├── converter-body.ts      # ダイアログの中身。予測のデコードを変換でも使う
│   ├── save-plan.ts           # 純粋: 名前と保存先の欄から saveNew / replaceExisting の引数を決める
│   ├── overlay/               # ダイアログの殻（obsidian-task-viewer から移植）
│   │   ├── overlay-shell.ts   # 中央の表示、.is-phone でボトムシート。ESC、背景、戻る操作、引いて閉じる
│   │   ├── keyboard-aware-container.ts # ソフトウェアキーボードに隠れる欄を上へスクロールする
│   │   ├── keyboard-state.ts  # 純粋: Capacitor のキーボードの高さ、キーボードの上端
│   │   ├── hotkey-shield.ts   # フォーカスが窓にある間、ホットキーを止める
│   │   ├── history-back.ts    # 戻る操作を Obsidian の onHistoryBack のスタックで受ける
│   │   ├── overlay-registry.ts # 純粋: 開いている窓。アンロードで閉じる
│   │   └── layer-order.ts     # 純粋: 窓の後ろに body へ置かれた要素（候補の一覧）を窓の内側とみなす
│   └── components/
│       ├── drop-zone.ts
│       ├── folder-suggest.ts  # 保存先の欄のフォルダの候補
│       ├── shown-suggest.ts   # 候補の一覧の基底。IME の Enter で選ばず、一覧の間はホットキーを止める
│       ├── form-enter.ts      # 純粋: IME の確定の Enter の判定
│       ├── save-fields.ts     # 名前と保存先の欄、名前の見本
│       └── settings-panel.ts  # 変換設定の欄。値を変えたプリセットに「(modified)」を付ける
├── utils/
│   └── gif-check.ts
└── styles/                    # ビルドで _variables.css、_overlay.css、styles.css の順に連結する
    ├── _variables.css
    ├── _overlay.css           # ダイアログの殻
    └── styles.css             # スタイルシート
```
