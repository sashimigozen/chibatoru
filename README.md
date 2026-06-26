# チバトル

ブラウザで遊べる、ターン制のデジタルカードバトルゲームです。

## プレイURL

https://sashimigozen.github.io/chibatoru/

GitHub Pagesで公開しているため、インストールせずにPCやスマートフォンのブラウザから遊べます。オンライン対戦をする場合は、対戦する2人が同じ公開URLを開くのがおすすめです。

## 遊べる内容

- ソロ対戦
- オンライン対戦
- デッキ作成、保存デッキ、スターターデッキ
- ミーム系カード、学生、教師、持ち物、環境カード
- じゃんけん、マリガン、ターン制バトル
- 手札カードのクリック操作とドラッグ操作

## オンライン対戦

オンライン対戦はGitHub Pages側のフロントエンドから、Renderで動かすWebSocket対戦サーバーへ接続します。サーバーはDBを使わず、メモリ上で部屋、2人の参加状態、準備状態、現在ターン、最新のゲーム状態を保持します。

1. 片方が「オンラインバトル」から部屋を作ります。
2. 表示された部屋コードをもう片方に伝えます。
3. もう片方が同じURLを開き、部屋コードを入力して入室します。
4. それぞれデッキを選び、準備OKを押します。
5. ホスト側が対戦開始を押すとオンライン対戦が始まります。

対戦状態はサーバーが保持し、ホスト側が生成した最新の `gameState` を正として同期します。ゲスト側の `playCard` や `endTurn` はサーバーで部屋・人数・ターンを確認してからホストへ送られます。

### WebSocketサーバー

Renderではリポジトリ直下の `render.yaml` を使い、`server` フォルダをNode.jsサービスとして起動します。

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- フロント側の標準接続先: `wss://chibatoru-ws.onrender.com`

Renderで発行されたURLが異なる場合は、ブラウザの開発者ツールで以下を実行すると接続先を上書きできます。

```js
localStorage.setItem("chibattle-online-server-url-v1", "wss://あなたのRenderサービス.onrender.com");
```

## 注意

`index.html` をダウンロードして開くこともできますが、オンライン対戦では両端末が同じ最新版を使う必要があります。バージョン違いを避けるため、基本的にはGitHub PagesのURLから遊んでください。

Render無料枠では一定時間アクセスがないとサーバーがスリープすることがあります。初回接続だけ少し時間がかかる場合があります。

## 開発

フロント本体は `index.html` と `websocket-client.js` です。対戦サーバーは `server/server.js` です。変更後に `main` ブランチへpushすると、GitHub Pagesへ反映されます。
