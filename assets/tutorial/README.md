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

PCメニューの教室背景と旧キーボード素材。ホーム画像そのものは未変更。

- `classroom-laptop-view.webp`: ホームの机画像を色・光・画風の参照にし、同じ教室を着席した高さから見た新規背景。窓・淡い壁・木の机、無人、文字や余計な小物なし。約50KB。
- `laptop-keyboard-graphite-v2.webp`: 旧キーボード素材。ホーム右側のPCと同じ濃い青灰色のキーボード本体。低い視点の透視図、透過背景。透明余白の除去とロスレスWebP化のみ実施し、図形や質感は生成結果のまま。約323KB。現在のPCメニューでは使わない。
- 生成方式: 組み込み画像生成。元画像とプロンプトは `imagegen-prompts.md` に記録。
- 旧 `laptop-base-slide23.png` は以前の画面案を保持する素材で、現在のPCメニューでは使わない。

## MacBook Airを参考にしたキーボード（2026-10-09）

現在の共通PC枠は `laptop-keyboard-graphite-us.svg` を使用する。
Apple公式ガイドのMacBook AirのUS配列を参考に、6段のキーを個別に配置したオリジナルSVG。写真そのものやAppleロゴは含めない。
12個のファンクションキー、Touch ID、各段の横ずれ、幅の異なるTab・Caps Lock・Shift・Return、長いスペースキー、逆T字型の矢印を配置。
元の青灰色の本体、低い視点、2123×193の素材サイズと表示倍率を維持し、画面外へ続く構図は変更しない。

参考（配列・形状の確認のみ）：
- https://support.apple.com/ja-jp/guide/macbook-air/apdab672d5e9/mac
- https://help.apple.com/assets/68E55784E266DE1F4A0ACA56/69726E59320F229D6106C907/ja_JP/5b7935a354e025174dfd0cb3ee032a49.png
