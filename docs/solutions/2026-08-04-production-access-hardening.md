# Минимальное укрепление доступа к production VPS

## Problem

Production VPS `31.130.148.55` был доступен по SSH под `root` с включённой
парольной аутентификацией. За семь дней в журнале было около 124 тысяч
неуспешных попыток входа. Часть файлов игры и Telegram-кампаний также имела
права записи для локальных пользователей, включая соседний аккаунт
`varonia-deploy`.

На сервере одновременно работают ЮБуст Раннер и отдельный проект Varonia,
поэтому изменения должны были быть локальными для SSH и `/opt/uboost` и не
затрагивать nginx-конфигурацию соседнего сайта.

## Root Cause

- В `/etc/ssh/sshd_config.d/50-cloud-init.conf` оставалась настройка
  `PasswordAuthentication yes`, которая переопределяла более позднее значение
  в основном конфиге.
- В части `/opt/uboost` были права `666/777`, позволяющие соседнему локальному
  пользователю менять статические файлы и campaign JSON.
- Отдельного администратора для безопасного отказа от root-доступа не было.

## Solution

- Добавлен `/etc/ssh/sshd_config.d/00-uboost-hardening.conf` с настройками:
  `PasswordAuthentication no`, `KbdInteractiveAuthentication no`,
  `PermitRootLogin prohibit-password`, `MaxAuthTries 3`,
  `MaxStartups 10:30:60`, `LoginGraceTime 20`.
- Конфигурация проверена через `sshd -t` и применена reload-ом SSH без
  перезапуска приложения или nginx.
- Создан системный пользователь `uboost-admin` с домашним каталогом и
  SSH-ключом, добавленный в группу `sudo`. Его пароль заблокирован; временно
  используется key-only `NOPASSWD` sudo, чтобы не хранить новый пароль в
  проекте или переписке.
- У production-кода, статики, кампаний и `ops` удалены права записи группы и
  остальных пользователей. Каталоги SQLite, `token-secret`, backups и
  `/etc/uboost/bot.env` не изменялись.
- Сохранена точка отката SSH-конфигурации на VPS в каталоге
  `/root/uboost-security-backup-20260804T141636Z`.

## Verification

- Новый SSH-сеанс под `uboost-admin` успешно выполняет `sudo id -u` и видит
  `uboost.service` как `active`.
- Вход под `root` по ключу сохранён; вход только по паролю отклоняется.
- `uboost.service`, nginx, health-check, backup timer и certificate-renewal
  timer активны.
- `/v1/health` возвращает `ok: true`, база и Telegram polling работают.
- `nginx -t` проходит успешно.
- `https://31-130-148-55.sslip.io/` возвращает `200`; `varonia-bot.service`
  активен и не перезапускался.
- `varonia-deploy` больше не может записывать `index.html` и campaign JSON.
- Хеши runtime-файлов ЮБуст не изменились.

## Remaining work

- Root-доступ по ключу оставлен как аварийный до отдельной проверки нового
  администратора; затем можно установить `PermitRootLogin no`.
- Для полного разделения доступа нужен отдельный passphrase-защищённый ключ
  `uboost-admin`, после чего текущий ключ можно убрать из root.
- Нужны fail2ban или firewall-ограничение SSH и внешний зашифрованный backup.

## Prevention

Перед изменениями SSH сначала создавать и проверять второй key-only доступ в
отдельной сессии. Для production-кода использовать root-owned read-only
release-файлы, а SQLite, секреты и backups держать в отдельных каталогах с
ограниченными правами. После каждого изменения проверять оба virtual host,
`nginx -t`, `/v1/health` и активность соседних сервисов.
