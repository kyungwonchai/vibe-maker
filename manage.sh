#!/bin/bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PID_FILE=".app.pid"
LOG_FILE="app.log"
PORT=10147

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "Vibe Maker is already running (PID: $PID)"
            return
        fi
    fi
    echo "Starting Vibe Maker on port $PORT..."
    PORT="$PORT" setsid node "$DIR/server.mjs" >> "$LOG_FILE" 2>&1 &
    APP_PID=$!
    echo $APP_PID > "$PID_FILE"
    disown $APP_PID 2>/dev/null
    sleep 0.5
    APP_PID=$!
    echo "Started (PID: $APP_PID, Port: $PORT)"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        echo "Stopping Vibe Maker (PID: $PID)..."
        kill $PID 2>/dev/null
        sleep 1
        if ps -p $PID > /dev/null 2>&1; then
            kill -9 $PID 2>/dev/null
        fi
        rm -f "$PID_FILE"
        echo "Stopped"
    else
        echo "Not running"
    fi
}

status() {
    if [ -f "$PID_FILE" ] && ps -p $(cat "$PID_FILE") > /dev/null 2>&1; then
        echo "Running (PID: $(cat "$PID_FILE"))"
    else
        echo "Stopped"
    fi
}

case "$1" in
    start) start ;;
    stop) stop ;;
    status) status ;;
    restart) stop; sleep 1; start ;;
    *) echo "Usage: $0 {start|stop|status|restart}"; exit 1 ;;
esac
