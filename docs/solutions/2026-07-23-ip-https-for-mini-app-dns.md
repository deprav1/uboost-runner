# HTTPS по IP для Telegram Mini App без зависимости от wildcard DNS

## Problem

На части Android- и macOS-клиентов Telegram игра не открывалась. Android
показывал `net::ERR_NAME_NOT_RESOLVED` для технического домена
`uboost.31-130-148-55.sslip.io`.

## Root Cause

Запрос не доходил ни до nginx, ни до игры: клиентский DNS не разрешал
wildcard-домен `sslip.io`. Поэтому загрузочный экран и JavaScript-фолбэк не
могли помочь.

## Solution

- Получен короткий доверенный сертификат Let's Encrypt с SAN для
  `31.130.148.55` и старого имени `uboost.31-130-148-55.sslip.io`.
- Основной адрес Mini App переведён на `https://31.130.148.55/`.
- Старое имя оставлено рабочим для ранее разосланных ссылок.
- HTTP-01 challenge для обоих идентификаторов обслуживается из
  `/var/lib/letsencrypt`.
- Certbot 5.7 установлен изолированно в `/opt/certbot-ip`.
- `uboost-ip-cert-renew.timer` проверяет продление дважды в день; nginx
  перезагружается только после успешного обновления сертификата.

## Verification

- production- и staging-выпуск сертификата прошли успешно;
- `certbot renew --cert-name uboost-ip --dry-run` успешен;
- `https://31.130.148.55/v1/health` и старый HTTPS-домен отвечают `200`;
- checksum конфигурации соседнего сайта `varonia` не изменился.

## Prevention

Не использовать wildcard DNS (`sslip.io`, `nip.io`) как основной адрес
пользовательского Mini App. При появлении управляемого брендового поддомена
можно перенести игру на него, сохранив прямой IP как аварийный адрес.
