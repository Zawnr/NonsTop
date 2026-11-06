#!/usr/bin/env bash
# Runs NonsTop in a detached tmux session, so it keeps running after the terminal closes.
#   scripts/serve-tmux.sh          start (or report that it already runs)
#   scripts/serve-tmux.sh restart  stop, then start again (after an update)
#   scripts/serve-tmux.sh stop     stop the server
#   tmux attach -t nonstop-server  watch the log (detach with Ctrl+b, then d)
set -euo pipefail
SESSION=nonstop-server
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 | tr -d "\"'" || true)"
HEALTH="http://127.0.0.1:${PORT:-8787}/api/health"

running() { tmux has-session -t "$SESSION" 2>/dev/null; }

stop() {
  if running; then
    # Ctrl+C lets the server close the database and remove its PID file.
    tmux send-keys -t "$SESSION" C-c
    for _ in $(seq 1 20); do running || break; sleep 0.5; done
    running && tmux kill-session -t "$SESSION"
  fi
  echo "NonsTop stopped."
}

start() {
  if running; then
    echo "NonsTop already runs in tmux session '$SESSION'."
    return
  fi
  tmux new-session -d -s "$SESSION" -c "$ROOT" "pnpm start; echo 'Server exited. Press Enter to close.'; read"
  for _ in $(seq 1 120); do
    if curl -sf "$HEALTH" >/dev/null; then
      echo "NonsTop runs: $(curl -s "$HEALTH")"
      return
    fi
    sleep 1
  done
  echo "NonsTop did not answer within 2 minutes. Check: tmux attach -t $SESSION" >&2
  exit 1
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  *) echo "Usage: $0 [start|stop|restart]" >&2; exit 2 ;;
esac
