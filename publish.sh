#!/bin/sh
# Publish app qua Cloudflare Tunnel (named tunnel + domain riêng).
# Dùng: ./publish.sh [port] [domain] [--build]
#   port   mặc định 3000 (hoặc PORT=3000 ./publish.sh)
#   domain mặc định duyna.online (hoặc DOMAIN=... ./publish.sh / ./publish.sh 3000 duyna.online)
# Env:
#   PORT         cổng app (mặc định 3000)
#   DOMAIN       hostname đã add vào Cloudflare (mặc định duyna.online)
#   TUNNEL_NAME  tên tunnel (mặc định simulator-battle)
# Yêu cầu: đã `cloudflared tunnel login` bằng account mtv.duyna@gmail.com.
set -eu

# Tách cờ --build ra khỏi tham số vị trí (POSIX sh, không dùng mảng bash).
DO_BUILD=0
ARGS=""
for a in "$@"; do
  if [ "$a" = "--build" ]; then
    DO_BUILD=1
  else
    ARGS="${ARGS} ${a}"
  fi
done
# shellcheck disable=SC2086
set -- $ARGS

PORT="${1:-${PORT:-3000}}"
DOMAIN="${2:-${DOMAIN:-duyna.online}}"
TUNNEL_NAME="${TUNNEL_NAME:-simulator-battle}"
URL="http://localhost:${PORT}"
CONFIG="${HOME}/.cloudflared/${TUNNEL_NAME}.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Thiếu cloudflared. Cài bằng: brew install cloudflared" >&2
  exit 1
fi

if [ ! -f "${HOME}/.cloudflared/cert.pem" ]; then
  echo "Chưa login Cloudflare. Chạy: cloudflared tunnel login (account mtv.duyna@gmail.com)" >&2
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

if [ "${DO_BUILD}" = "1" ] || [ ! -d "./.next" ]; then
  echo "Build app (next build)..."
  npm run build
fi

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

if cloudflared tunnel list --name "${TUNNEL_NAME}" 2>/dev/null | grep -q "${TUNNEL_NAME}"; then
  echo "Tunnel '${TUNNEL_NAME}' đã có."
else
  echo "Tạo tunnel '${TUNNEL_NAME}'..."
  cloudflared tunnel create "${TUNNEL_NAME}"
fi

TUNNEL_ID="$(cloudflared tunnel list --name "${TUNNEL_NAME}" --output json 2>/dev/null | grep -o '"id": *"[^"]*"' | head -n 1 | cut -d'"' -f4)"
if [ -z "${TUNNEL_ID}" ]; then
  echo "Không lấy được tunnel ID cho '${TUNNEL_NAME}'" >&2
  exit 1
fi
CREDS="${HOME}/.cloudflared/${TUNNEL_ID}.json"
if [ ! -f "${CREDS}" ]; then
  echo "Thiếu credentials ${CREDS}" >&2
  exit 1
fi

echo "Gán DNS ${DOMAIN} -> tunnel ${TUNNEL_NAME}..."
if cloudflared tunnel route dns "${TUNNEL_NAME}" "${DOMAIN}" 2>&1; then
  echo "Đã route DNS ${DOMAIN}."
else
  echo "(Bỏ qua lỗi route DNS — thường là hostname đã được gán cho tunnel này.)"
fi

cat > "${CONFIG}" <<EOF
# Tự sinh bởi publish.sh cho ${DOMAIN} (tunnel ${TUNNEL_NAME}).
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS}

ingress:
  - hostname: ${DOMAIN}
    service: ${URL}
  - service: http_status:404
EOF
echo "Đã ghi config ${CONFIG}."

echo "Mở tunnel: https://${DOMAIN} -> ${URL}"
exec cloudflared tunnel --config "${CONFIG}" run "${TUNNEL_NAME}"
