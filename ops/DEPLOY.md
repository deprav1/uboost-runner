# Деплой в production (VPS 31.130.148.55)

Прод — это **не git-репозиторий**: `/opt/uboost` наполняется копированием файлов.
Поэтому «задеплоить» = аккуратно синхронизировать нужные файлы из коммита и
перезапустить `uboost.service`. GitHub Pages (`push` в `main`) — только зеркало;
`CONFIG.GAME_URL` и Mini App ведут на VPS, так что прод обновляет ЭТА процедура.

Рядом на том же сервере живёт ЧУЖОЙ проект **varonia** — nginx не трогаем
(см. `docs/solutions/2026-07-17-https-sslip-and-bare-ip-404.md`).

## 0. Перед деплоем

```bash
npm run verify                 # тесты + рендер превью
```

Сверить, что окружение прода согласовано с кодом (иначе клиент попадёт в
reload-петлю `uboost:ruleset-mismatch`):

```bash
ssh root@31.130.148.55 'grep -E "^RULESET_VERSION=" /etc/uboost/bot.env'
grep RULESET_VERSION config.js
```

## 1. Понять, что реально стоит на проде

Прод раздавался с Windows-машины, поэтому файлы там с **CRLF** — сравнивать
хеши нужно с нормализацией переводов строк, иначе «изменилось всё»:

```bash
git ls-tree -r --name-only HEAD | grep -v '^preview/' > /tmp/all.txt
ssh root@31.130.148.55 'cd /opt/uboost && while read -r f; do
  [ -f "$f" ] && printf "%s %s\n" "$(tr -d "\r" < "$f" | sha256sum | cut -d" " -f1)" "$f" \
             || printf "MISSING %s\n" "$f"; done' < /tmp/all.txt > /tmp/prod.txt
while read -r f; do
  l=$(git show HEAD:"$f" | tr -d '\r' | sha256sum | cut -d' ' -f1)
  p=$(grep -F " $f" /tmp/prod.txt | head -1 | awk '{print $1}')
  [ "$l" = "$p" ] || echo "$f"
done < /tmp/all.txt
```

Так 2026-08-05 выяснилось, что прод отставал на два коммита (клиентский фикс
порядка сабмита и серверный стабильный ключ кампании), хотя в репозитории всё
было слито. **Всегда делай эту сверку** — «в main всё есть» ≠ «на проде всё есть».

## 2. Бэкапы (обязательно, до копирования)

```bash
ssh root@31.130.148.55 'set -e
TS=$(date -u +%Y%m%dT%H%M%SZ)
systemctl start uboost-db-backup.service        # VACUUM INTO → /opt/uboost/backups/db
ls -la /opt/uboost/backups/db | tail -2
tar czf /root/uboost-code-backup-$TS.tgz -C /opt/uboost \
    --exclude=backend/data --exclude=backups --exclude=node_modules .'
```

Если релиз содержит миграцию (например `UPDATE runs SET started_at = …`),
снять метрики БД до и после — они должны меняться только ожидаемо:

```bash
ssh root@31.130.148.55 'node -e "
const { DatabaseSync } = require(\"node:sqlite\");
const db = new DatabaseSync(\"/opt/uboost/backend/data/uboost.db\", { readOnly: true });
const q = (s) => db.prepare(s).get().c;
console.log(JSON.stringify({
  runs: q(\"SELECT COUNT(*) c FROM runs\"),
  verified: q(\"SELECT COUNT(*) c FROM runs WHERE verified=1\"),
  players: q(\"SELECT COUNT(*) c FROM players\"),
  links: q(\"SELECT COUNT(*) c FROM telegram_links\"),
  bestVerified: q(\"SELECT MAX(score) c FROM runs WHERE verified=1\")
}));"'
```

## 3. Копирование файлов

Staging из коммита (не из рабочей копии — так в прод не уедет случайная правка):

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
git archive HEAD -- <список файлов> | ssh root@31.130.148.55 \
  "mkdir -p /root/deploy-$TS && tar -x -C /root/deploy-$TS && node --check /root/deploy-$TS/backend/server.js"
ssh root@31.130.148.55 "cd /root/deploy-$TS && find . -type f | sed 's|^\./||' | while read -r f; do
  mkdir -p \"/opt/uboost/\$(dirname \"\$f\")\"; cp -f \"\$f\" \"/opt/uboost/\$f\"; done"
```

`cp -f` пишет в существующий файл и **сохраняет владельца и права** (в
`/opt/uboost` часть файлов root:root 644, часть uboost:uboost 664 — не ломай это
через `rsync --delete` или `install -o root`).

## 4. Перезапуск и проверка

```bash
ssh root@31.130.148.55 'set -e
systemctl restart uboost.service; sleep 6; systemctl is-active uboost.service
curl -s --resolve 31.130.148.55:443:127.0.0.1 https://31.130.148.55/v1/health; echo
journalctl -u uboost.service --since "-2min" --no-pager | tail -10
systemctl start uboost-healthcheck.service; systemctl show uboost-healthcheck.service -p ExecMainStatus
systemctl is-active varonia-bot.service nginx; nginx -t'
```

Дальше — глазами игрока: открыть `https://31.130.148.55/` (обязательно с
обходом кэша: `?cachebust=…`), убедиться, что `window.__uboostBooted === true`,
консоль чистая, новый UI на месте. Telegram-часть (`/lite`, `/top`, кнопка
«Играть») проверяется вручную в боте — сервер только подтверждает
`bot.polling: true`.

## 5. Откат

```bash
ssh root@31.130.148.55 'set -e
tar xzf /root/uboost-code-backup-<TS>.tgz -C /opt/uboost
systemctl restart uboost.service
curl -s --resolve 31.130.148.55:443:127.0.0.1 https://31.130.148.55/v1/health'
```

База откатывается копированием снапшота из `/opt/uboost/backups/db` **на
остановленном сервисе** (иначе WAL перепишет данные) — и только если релиз
действительно испортил данные; обычный откод кода этого не требует.

## Грабли, проверенные на живом проде

- **index.html кэшируется дольше js.** Игрок может держать СТАРУЮ разметку и
  подтянуть СВЕЖИЙ `main.js` (URL модуля с `?v=` живёт в кэшированном html, а
  файл nginx отдаёт новый). Любое обращение к новому элементу без проверки
  роняет весь bootstrap — белый экран. Новые элементы читай через `setText()`
  / `dom.x?.`; версию `?v=` в `index.html` поднимай парой css+js (тест следит).
- **Прод может отставать от main.** Сверка хешей из шага 1 — единственный
  честный ответ на «что стоит на проде».
- **CRLF на проде** — это нормально (деплой с Windows), не «дрейф».
- **nginx и varonia не трогать.** Никаких `default_server` / `server_name _`
  в блоках uboost.
