#!/usr/bin/env bash
# Démarre / arrête le serveur local de développement (usage : ./run.sh start|stop|restart).
set -euo pipefail
PID_FILE=/tmp/edt-ulco.pid
PORT=${PORT:-3111}
cd "$(dirname "$0")"
case "${1:-restart}" in
  stop|restart)
    [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    [ "${1:-restart}" = stop ] && exit 0
    sleep 1
    ;;
esac
PORT="$PORT" nohup node --experimental-strip-types server/src/index.ts > /tmp/edt-ulco.log 2>&1 &
echo $! > "$PID_FILE"
sleep 3
echo "serveur sur http://localhost:$PORT (pid $(cat "$PID_FILE"))"
