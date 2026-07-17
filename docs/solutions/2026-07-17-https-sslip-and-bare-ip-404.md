# HTTPS на sslip.io + как certbot убил ссылку по голому IP

## Problem
Прод раздавался по голому HTTP (`http://31.130.148.55/`), из-за чего
`isSecureContext === false` и в браузере отсутствовали `navigator.clipboard`,
`navigator.share`, `crypto.randomUUID`. Это калечило шеринг (главный виральный
механизм), копирование промокода и закрывало Telegram Mini App. Все фиксы в коде
были лишь обходами отсутствия TLS.

После включения HTTPS вылезла вторая проблема: **`http://31.130.148.55/` стал
отдавать 404** — старая ссылка на игру, уже разошедшаяся по чатам, умерла.

## Root Cause

**1. Почему не было HTTPS.** Let's Encrypt не выдаёт сертификаты на IP-адрес,
нужно доменное имя. Домен `uboost.download` у проекта есть, но смотрит на другой
хостинг (магазин), а поддомен для игры заведён не был.

**2. Почему сломался IP.** `certbot --nginx --redirect` переписал блок на `:80`
по своему шаблону:

```nginx
server {
    if ($host = uboost.31-130-148-55.sslip.io) { return 301 https://$host$request_uri; }
    listen 80;
    server_name uboost.31-130-148-55.sslip.io;
    return 404;   # managed by Certbot
}
```

Ни один блок не помечен `default_server`, поэтому nginx отдаёт запрос с
неизвестным `Host` **первому блоку по порядку**, а `sites-enabled` подключается
глобом по алфавиту: `uboost` идёт раньше `varonia`. Запрос с `Host: 31.130.148.55`
попадал в этот блок, не совпадал с `if` и получал `return 404`.
До certbot тот же блок проксировал всё подряд на `127.0.0.1:8080`, поэтому голый
IP работал «сам собой» — на этом и держалась старая ссылка.

## Solution

**HTTPS без покупки домена.** В nginx уже было имя `uboost.31-130-148-55.sslip.io`
(sslip.io бесплатно резолвит имена с зашитым в них IP), и оно **уже лежало в
allowlist `API_ORIGIN` в `config.js`** — то есть доска и API заработали на нём без
единой правки кода. Сертификат выпущен на это имя:

```
certbot --nginx -d uboost.31-130-148-55.sslip.io --non-interactive --agree-tos -m ... --redirect
```

Некрасивый адрес допустим потому, что игра живёт внутри Telegram Mini App, где
URL пользователю не показывается.

**Возврат IP-ссылки** — отдельный блок `/etc/nginx/sites-available/uboost-ip-redirect`:

```nginx
server {
    listen 80;
    server_name 31.130.148.55;   # ЯВНО, без default_server — рядом чужой varonia
    return 301 https://uboost.31-130-148-55.sslip.io$request_uri;
}
```

Старая ссылка снова живая и вдобавок сразу поднимает игрока в secure context.

Итог проверки: `isSecureContext: true`, `clipboard: true`, `randomUUID: true`,
`API_ORIGIN` = same-origin, доска и бот `@ubostrun_bot` работают, varonia цела
(md5 конфига совпал с досертификатным), `certbot renew --dry-run` успешен.

## Prevention
- **`certbot --nginx --redirect` ломает всё, что жило на этом порту без явного
  `server_name`.** Если сайт был доступен по IP или «как получится» — после
  certbot он получит `return 404`. Проверять голый IP сразу после выпуска.
- **На сервере есть ЧУЖОЙ сайт `varonia`** (`/var/www/varonia`, свой `server_name`).
  Никогда не помечать блоки uboost как `default_server` и не использовать
  `server_name _` — перехватит чужой трафик. Перед правками nginx: бэкап
  (`tar czf /root/nginx-backup-<ts>.tgz -C /etc nginx`) и `md5sum` конфига varonia
  до/после.
- `certbot` может быть заблокирован политикой агента (правит системный конфиг +
  регистрируется во внешнем CA) — тогда команду выполняет пользователь сам.
- Сертификат sslip.io истекает 2026-10-15, `certbot.timer` активен, продление
  проверено вхолостую. Если проект переедет на `game.uboost.download` — добавить
  хост в `API_ORIGIN` в `config.js`, иначе игра сочтёт, что сервера нет, и молча
  свалится на локальную доску.
