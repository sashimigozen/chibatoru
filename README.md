# チバトル

ブラウザで遊べるカードバトルゲームです。

- プレイ: https://shosipaniti.github.io/chibatoru/
- 本体ファイル: `index.html`

オンラインバトルはPeerJSのデータ接続を使います。操作メッセージにはIDとACKを付け、未確認の操作は再送し、重複した操作は二重に処理しないようにしています。
