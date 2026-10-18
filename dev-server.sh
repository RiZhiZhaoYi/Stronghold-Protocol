#!/usr/bin/env bash
# 在 WSL 里管理 Stronghold 开发服务器（默认端口 6007）
#
#   bash dev-server.sh start [端口]      启动
#   bash dev-server.sh stop  [端口]      停止
#   bash dev-server.sh restart [端口]    重启
#   bash dev-server.sh status [端口]     状态
#   bash dev-server.sh logs  [端口]      跟踪日志
#
# 端口约定：6006 = 上游原版（worktree /home/rzzy/sp-upstream-0.2.2），6007 = 本 fork（含「恭喜发财」）
# 换目录：SHP_DIR=/别的/路径 bash dev-server.sh start 6006
# 后台方式：优先 screen，其次 tmux，都没有就用 setsid（PID 写 .run-<端口>.pid）
set -u

ACTION="${1:-status}"
PORT="${2:-6007}"

DIR="${SHP_DIR:-/home/rzzy/Stronghold-Protocol}"
export PATH="/home/rzzy/.local/node/bin:$PATH"

LOG="$DIR/run-$PORT.log"
PIDFILE="$DIR/.run-$PORT.pid"
SESSION="shp-$PORT"

cd "$DIR" || { echo "错误：找不到 $DIR"; exit 1; }

alive() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; }
have() { command -v "$1" >/dev/null 2>&1; }

do_start() {
  if alive; then echo "已在运行（pid $(cat "$PIDFILE")）"; return 0; fi
  echo "启动 $DIR （PORT=$PORT）"
  if have screen; then
    screen -dmS "$SESSION" bash -lc "cd '$DIR' && PORT=$PORT SP_NO_BROWSER=1 exec node server/index.js > '$LOG' 2>&1"
    echo "  后台方式：screen（screen -r $SESSION 进入，Ctrl+A 然后 D 脱离）"
  elif have tmux; then
    tmux new-session -d -s "$SESSION" "cd '$DIR' && PORT=$PORT SP_NO_BROWSER=1 exec node server/index.js > '$LOG' 2>&1"
    echo "  后台方式：tmux（tmux attach -t $SESSION）"
  else
    setsid bash -c "cd '$DIR' && PORT=$PORT SP_NO_BROWSER=1 exec node server/index.js > '$LOG' 2>&1" < /dev/null > /dev/null 2>&1 &
    echo $! > "$PIDFILE"
    echo "  后台方式：setsid（PID 见 $PIDFILE）"
  fi
  sleep 7
  curl -sS --max-time 6 "http://127.0.0.1:$PORT/healthz" && echo
  echo "日志：tail -f $LOG"
}

do_stop() {
  echo "停止端口 $PORT 的服务"
  if have screen && screen -ls 2>/dev/null | grep -q "[.]${SESSION}[[:space:]]"; then screen -S "$SESSION" -X quit 2>/dev/null; fi
  if have tmux && tmux has-session -t "$SESSION" 2>/dev/null; then tmux kill-session -t "$SESSION" 2>/dev/null; fi
  if [ -f "$PIDFILE" ]; then
    P=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "${P:-}" ]; then kill -TERM "-$P" 2>/dev/null; kill -TERM "$P" 2>/dev/null; sleep 1; kill -KILL "-$P" 2>/dev/null; fi
    rm -f "$PIDFILE"
  fi
  for p in $(pgrep -f 'node server/index.js' 2>/dev/null); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$DIR" ] && kill -KILL "$p" 2>/dev/null
  done
  sleep 1
  if ss -lntp 2>/dev/null | grep -q ":$PORT"; then echo "  端口 $PORT 仍被占用"; else echo "  已停止"; fi
}

case "$ACTION" in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop; sleep 1; do_start ;;
  status)
    echo "=== 端口 $PORT ==="
    curl -sS --max-time 6 "http://127.0.0.1:$PORT/healthz" 2>&1 || echo "  未在监听"
    echo
    if alive; then echo "PID 文件：pid $(cat "$PIDFILE")（存活）"; else echo "PID 文件：无"; fi
    echo "按 cwd 匹配的进程："
    for p in $(pgrep -f 'node server/index.js' 2>/dev/null); do
      [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$DIR" ] && echo "  pid=$p"
    done
    if have screen; then echo "screen："; screen -ls 2>/dev/null | grep -E "shp-|stronghold" || echo "  无"; fi
    ;;
  logs) tail -f "$LOG" ;;
  *) echo "用法: bash dev-server.sh {start|stop|restart|status|logs} [端口]"; exit 1 ;;
esac
