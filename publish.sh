#!/bin/sh
# Publish app qua Cloudflare Tunnel (quick tunnel, không cần config).
# Dùng: ./publish.sh [port]   (mặc định 3000, hoặc PORT=3000 ./publish.sh)
set -eu

PORT="${1:-${PORT:-3000}}"
URL="http://localhost:${PORT}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Thiếu cloudflared. Cài bằng: brew install cloudflared" >&2
  exit 1
fi

APP_PID=""
cleanup() {
  if [ -n "${APP_PID}" ] && kill -0 "${APP_PID}" 2>/dev/null; then
    echo "Dừng app (pid ${APP_PID})..."
    kill "${APP_PID}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

port_open() {
  (echo > "/dev/tcp/127.0.0.1/${PORT}") >/dev/null 2>&1
}

if port_open; then
  echo "Port ${PORT} đang chạy sẵn -> bỏ qua bước start app."
else
  echo "Start app ở port ${PORT}..."
  PORT="${PORT}" npm run start > "./publish-app.log" 2>&1 &
  APP_PID="$!"
  echo "App pid ${APP_PID} (log: ./publish-app.log), chờ port mở..."
  for _ in $(seq 1 60); do
    if port_open; then
      echo "App đã lên ở ${URL}."
      break
    fi
    if ! kill -0 "${APP_PID}" 2>/dev/null; then
      echo "App thoát bất thường, xem ./publish-app.log" >&2
      exit 1
    fi
    sleep 1
  done
  if ! port_open; then
    echo "Quá 60s port ${PORT} chưa mở, xem ./publish-app.log" >&2
    exit 1
  fi
fi

echo "Mở tunnel: cloudflared tunnel --url ${URL}"
echo "Link public https://....trycloudflare.com sẽ hiện trong log bên dưới."
exec cloudflared tunnel --url "${URL}"
