# チバトル

ブラウザで遊べる、ターン制のデジタルカードバトルゲームです。

## プレイURL

https://sashimigozen.github.io/chibatoru/?v=0.13.1

- [カード一覧 ver.0.13.1](https://sashimigozen.github.io/chibatoru/%E3%82%AB%E3%83%BC%E3%83%89%E7%AE%A1%E7%90%86%E5%8F%B0%E5%B8%B3.html?v=0.13.1)
- [ルール ver.0.13.1](https://sashimigozen.github.io/chibatoru/%E3%83%AB%E3%83%BC%E3%83%AB%E3%83%BB%E7%94%A8%E8%AA%9E%E7%AE%A1%E7%90%86%E5%8F%B0%E5%B8%B3.html?v=0.13.1)

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

「オンラインバトル」には2つの入り方があります。

- ランダムマッチ: マッチング中の相手と自動で同じ対戦部屋に入ります。
- プライベートマッチ: 片方が部屋を作り、表示された部屋コードをもう片方が入力して入室します。

どちらの入り方でも、2人そろった後にそれぞれデッキを選び、準備OKを押します。ホスト側が対戦開始を押すとオンライン対戦が始まります。

対戦状態はサーバーが保持し、ホスト側が生成した最新の `gameState` を正として同期します。ゲスト側の `playCard` や `endTurn` はサーバーで部屋・人数・ターンを確認してからホストへ送られます。

### WebSocketサーバー

Renderではリポジトリ直下の `render.yaml` を使い、`server` フォルダをNode.jsサービスとして起動します。

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- フロント側の標準接続先: `wss://chibatoru-online.onrender.com`

Renderで発行されたURLが異なる場合は、オンライン画面の「サーバーURL」欄に `wss://...onrender.com` を入力して保存してください。URLに `https://` を入れた場合も自動で `wss://` に変換します。

URLを共有リンクで一時指定したい場合は、公開URLに `?ws=wss://chibatoru-online.onrender.com` を付けても接続先を上書きできます。

ブラウザの開発者ツールから直接設定する場合は、以下でも保存できます。

```js
localStorage.setItem("chibattle-online-server-url-v1", "wss://chibatoru-online.onrender.com");
```

## 注意

`index.html` をダウンロードして開くこともできますが、オンライン対戦では両端末が同じ最新版を使う必要があります。バージョン違いを避けるため、基本的にはGitHub PagesのURLから遊んでください。

Render無料枠では一定時間アクセスがないとサーバーがスリープすることがあります。初回接続だけ少し時間がかかる場合があります。

## 開発

フロント本体は `index.html` と `websocket-client.js` です。対戦サーバーは `server/server.js` です。変更後に `main` ブランチへpushすると、GitHub Pagesへ反映されます。
