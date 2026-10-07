# Tutorial icons

Unmodified Bootstrap Icons SVGs, under the MIT license in `LICENSE`.

- https://icons.getbootstrap.com/icons/caret-right/
- https://icons.getbootstrap.com/icons/chevron-right/
- https://icons.getbootstrap.com/icons/folder/ (PCメニューのフォルダ)

PCメニューの現在のフォルダは Lucide `folder-closed` を使用。
外周の元のパス形状を維持し、Finderをイメージした水色の後ろ面・前面のグラデーションと細い縁を追加した改変SVG。
外部画像やAppleのアイコンそのものは使わず、既存フォルダをベースに色と控えめな陰影を調整。文字はチバトルのフォント・紺色を維持。
余白を除いたviewBoxと縦横別の拡縮で、フォルダの面がボタン全体に収まるよう設定。
https://github.com/lucide-icons/lucide/blob/main/icons/folder-closed.svg
ISCライセンスは `LICENSE-LUCIDE`。

通常のPC画面内には、従来のチバトルのメニューボタン・説明文を表示する。
フォルダ形式は比較用の `?menu=folders` で利用でき、配置の保存内容も維持する。
両方でPC本体・背景・対戦準備・チュートリアルなどの既存機能を共有する。

`laptop-base-slide23.png` はユーザーのPowerPointスライド23から切り出したPC本体の輪郭。
2026-10-07に画面を取得し、2940×1800画像の (547,1323) から1764×145で切り出し。
旧ワイヤーフレーム版に使用した素材で、この切り出し自体は新規生成画像ではない。

## ホームのPC・教室に合わせた背景（2026-10-07）

現在のPCメニューでは以下の画像を使用する。ホーム画像そのものは未変更。

- `classroom-laptop-view.webp`: ホームの机画像を色・光・画風の参照にし、同じ教室を着席した高さから見た新規背景。窓・淡い壁・木の机、無人、文字や余計な小物なし。約50KB。
- `laptop-keyboard-graphite-v2.webp`: ホーム右側のPCと同じ濃い青灰色のキーボード本体。低い視点の透視図、透過背景。透明余白の除去とロスレスWebP化のみ実施し、図形や質感は生成結果のまま。約323KB。
- 生成方式: 組み込み画像生成。元画像とプロンプトは `imagegen-prompts.md` に記録。
- 旧 `laptop-base-slide23.png` は以前の画面案を保持する素材で、現在のPCメニューでは使わない。
