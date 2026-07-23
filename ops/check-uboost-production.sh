#!/usr/bin/env bash
set -euo pipefail

notify_failure() {
  local code=$?
  local admin="${BOT_ADMIN_IDS%%,*}"
  if [[ -n "${BOT_TOKEN:-}" && "${admin:-}" =~ ^[0-9]+$ ]]; then
    curl --silent --show-error --max-time 10 \
      --request POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      --header 'Content-Type: application/json' \
      --data "{\"chat_id\":\"${admin}\",\"text\":\"⚠️ ЮБуст Раннер: production healthcheck не прошёл на $(hostname). Проверь systemctl status uboost-healthcheck.service\"}" \
      >/dev/null || true
  fi
  exit "$code"
}
trap notify_failure ERR

certificate="$(mktemp)"
trap 'rm -f "$certificate"' EXIT
openssl s_client -connect 127.0.0.1:443 -servername 31.130.148.55 </dev/null 2>/dev/null \
  | openssl x509 -outform PEM >"$certificate"
# Не ждём последнего часа: если до конца меньше трёх суток, проверка красная.
openssl x509 -checkend 259200 -noout -in "$certificate"

health="$(curl --silent --show-error --fail --max-time 15 \
  --resolve 31.130.148.55:443:127.0.0.1 \
  https://31.130.148.55/v1/health)"
grep -q '"ok":true' <<<"$health"

echo "uBoost Runner production healthcheck ok"
