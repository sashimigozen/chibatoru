#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if /usr/bin/curl -fsS http://127.0.0.1:4189/health 2>/dev/null | /usr/bin/grep -q 'experimental-rules'; then
  /usr/bin/open 'http://127.0.0.1:4189/'
  exit 0
fi
if [[ -x /usr/local/bin/node ]]; then
  test_node=/usr/local/bin/node
elif [[ -x /opt/homebrew/bin/node ]]; then
  test_node=/opt/homebrew/bin/node
else
  test_node=$(command -v node)
fi
if [[ -z "$test_node" ]]; then
  echo 'Node.jsが見つかりません。Codexからテスト環境を起動してください。'
  read '?Enterで終了'
  exit 1
fi
( /bin/sleep 1; /usr/bin/open 'http://127.0.0.1:4189/' ) &
"$test_node" server.mjs
