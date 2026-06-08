# ЮБуст Раннер — справка для AI-ассистента

Виральная HTML5 мини-игра (синтвейв 3-полосный раннер) для продвижения VPN-сервиса
«ЮБуст». Цель — Telegram WebApp + GitHub Pages, без билд-степа.

Репозиторий: https://github.com/deprav1/uboost-runner (owner: `deprav1`, ветка по
умолчанию: `main`). Деплой автоматический на GitHub Pages при пуше в `main`.

## Стек и ограничения
- **Чистый vanilla JS (ES-модули) + Canvas 2D, без сборки и без npm-зависимостей в рантайме.**
  Единственная dev-зависимость — `@napi-rs/canvas` (для офлайн-рендера превью/тестов).
- Никакого TypeScript, бандлера, фреймворка — НЕ предлагай их вводить.
- ES-модули требуют HTTP-сервер (`file://` не работает из-за CORS на модулях).
- Звук — процедурный WebAudio (без аудио-файлов). Графика — рисуется кодом
  (процедурные спрайты), AI-генерированные растровые ассеты сознательно отключены
  (см. «История решений» ниже) — слой `engine/assets.js` существует, но
  `loadAssets()` закомментирован в `src/main.js:27`.

## Структура
```
config.js          # ЕДИНЫЙ источник тюнингов/ссылок/палитры/строк-режима — правь тут
index.html         # разметка экранов (menu/game/gameover), Telegram WebApp script
styles/style.css   # вся вёрстка/анимации UI поверх canvas
src/
  main.js          # bootstrap, игровой цикл (rAF), машина состояний, оркестрация систем
  engine/
    render.js      # canvas setup (DPR), геометрия, scanlines, рельсы
    particles.js   # частицы и всплывающий текст
    input.js       # свайпы/тапы/клавиатура → onUp/onDown/onTap
    audio.js       # процедурный WebAudio (музыка/sfx)
    analytics.js   # provider-agnostic трекинг (см. ниже)
    assets.js      # загрузчик спрайтов из манифеста (сейчас не используется)
  game/
    world.js       # фон/параллакс/геометрия полос (geometry())
    player.js      # ракета-маскот: твин полосы, отрисовка, mood-состояния
    obstacles.js   # типы препятствий + nextSafeLane() — инвариант «честного коридора»
    collectibles.js# DataBit (поток данных), Heart (пикап жизни)
    boosts.js      # VPN-буст пикап
    captcha.js     # мини-игра «капча» (сетка тайлов, таймер, решаемость)
    events.js      # рандомные «гэги» (Сбер лёг, РКН и т.п.)
    stats.js       # счёт/дистанция/жизни/рекорд (localStorage)
    sharecard.js   # рендер шеринг-карточки (canvas → PNG/Blob)
  ui/
    screens.js     # DOM-обвязка экранов, HUD, fillStaticCopy()
    strings.js     # ВЕСЬ копирайт/мемы (raw + safe режимы, см. STRINGS_SAFE)
test/
  harness.mjs      # headless smoke-test (стабит DOM/Canvas/Audio, крутит 600 кадров)
  render-shot.mjs  # детерминированно рендерит preview/*.png реальным движком через @napi-rs/canvas
docs/solutions/    # журнал решённых багов в формате Problem/RootCause/Solution/Prevention
assets/            # PROMPTS.md, STYLE_GUIDE.md, manifest.json — для AI-спрайтов (не используются)
.github/workflows/ci.yml     # CI: PR/ветки → npm test + npm run shots + preview artifact
.github/workflows/pages.yml  # deploy на GitHub Pages при пуше в main после npm test
```

## Игровой цикл и архитектура (src/main.js)
- Машина состояний: `menu → play → (captcha) → dying → over → play...`
- Один `requestAnimationFrame` цикл `frame(now)`: update всех систем по `dt`, затем draw.
- Скорость: `baseSpeed()` растёт с дистанцией до `MAX_SPEED`; во время `invuln`
  (буст/капча-успех) — `BOOST_SPEED`. Гэги могут временно множить скорость (`events.speedMul()`).
- Спавн препятствий — «коридорами» (`spawnColumn`): на каждой колонне ровно одна
  безопасная полоса (`corridor.safeLane`), управляемая `nextSafeLane()` —
  гарантирует, что смещение между соседними безопасными полосами ≤ 1 (всегда достижимо).
- Коллизии (`handleCollisions`): обычные препятствия → смерть/смэш (если invuln);
  препятствия-капчи → запускают мини-игру вместо мгновенной смерти; данные/бусты/сердца — пикапы.
- Аналитика и шеринг вызываются в ключевых точках (`gameStart`, `gameOver`, `share`, `ctaClick`).

## Конфиг — единственное место для тюнинга (config.js)
Все игровые константы, ссылки (`STORE_URL`, `GAME_URL`, `TG_BOT_URL`), палитра
(`COLORS`), баланс сложности (`REACT_TIME`, `COL_SPACING_MIN`, `BLOCK2_*`, `DIFF_DIST`)
и переключатель копирайта `STRINGS_SAFE` находятся ТОЛЬКО здесь.
**Не хардкодь значения по месту в коде — выноси в `config.js`.**

- `STRINGS_SAFE: false` — оригинальные мемные бренды (Сбер, 1хСтавка, РКН, Госуслуги…).
- `STRINGS_SAFE: true` — вымышленные пародии без чужих ТМ (МЕГАБАНК, МЕГАШОП…), для
  платного трафика, чтобы не словить юридические/модерационные проблемы. Логика
  переключения — в `src/ui/strings.js` (`STR = CONFIG.STRINGS_SAFE ? {...raw, ...safe} : raw`).

## Аналитика (src/engine/analytics.js)
Провайдер-агностичный стаб: по умолчанию пишет в `console.debug`. Чтобы подключить
реальный трекинг — `Analytics.use(httpBeacon('https://...'))` или свой адаптер
с контрактом `{ track(event, props) }`. События: `game_start`, `game_over`, `share`,
`cta_click`. `Analytics.storeUrl()` добавляет UTM-метки к `STORE_URL`.

## Команды разработки
```bash
npm start    # python3 -m http.server 8000 — локальный запуск (нужен http, не file://)
npm test     # node test/harness.mjs — headless smoke-тест (модули, 600 кадров, инварианты)
npm run shots # node test/render-shot.mjs — рендер preview/*.png реальным движком (нужен @napi-rs/canvas)
npm run verify # полный локальный прогон: npm test + npm run shots
```
**После любых изменений в игровой логике — обязательно гоняй `npm test`.** Тест
проверяет не только отсутствие рантайм-ошибок за 600 кадров, но и игровые инварианты:
- решаемость капчи (число целевых плиток == `CAPTCHA_TARGETS`, не равно размеру сетки),
- систему жизней (старт/потеря/набор/cap по `MAX_LIVES`),
- честность коридора (`nextSafeLane`: полоса всегда в границах и достижима за 1 шаг).

Если меняешь визуал/спрайты — гоняй `npm run shots` и сверяй `preview/*.png`.
`render-shot.mjs` сидит на фиксированном seed, чтобы превью и CI-артефакты были
стабильными и не прыгали от случайности между запусками.

## CI/CD
- Два workflow:
  - `.github/workflows/ci.yml` — запускается на `pull_request`, push в любые ветки кроме `main`
    и вручную. Делает `npm ci`, `npm test`, `npm run shots`, затем выкладывает
    `preview/*.png` как artifact для ревью.
  - `.github/workflows/pages.yml` — deploy на GitHub Pages при push в `main` или вручную.
    Перед деплоем тоже делает `npm ci` и `npm test`, затем заливает корень репозитория
    как статику через `actions/upload-pages-artifact` + `actions/deploy-pages`.
- После первого деплоя нужно вручную включить **Settings → Pages → Source: GitHub Actions**.
- Адрес после деплоя: `https://deprav1.github.io/uboost-runner/` — должен совпадать
  с `CONFIG.GAME_URL` (используется в шеринге).

## История решений / известные грабли
- `docs/solutions/` — журнал в формате Problem/Root Cause/Solution/Prevention.
  Перед фиксом непонятного бага — проверь, не описан ли он уже там, и добавляй
  новые записи туда же по тому же шаблону (имя файла `YYYY-MM-DD-краткое-описание.md`).
- **AI-спрайты отключены намеренно** (коммит `57fcbd2`): несовпадение ключей в
  манифесте/коде ассетов ловило баги (см. `docs/solutions/2026-06-02-decoy-sprite-mismatch.md`).
  Решили, что процедурная графика выглядит лучше и надёжнее. `engine/assets.js`,
  `assets/manifest.json`, `assets/PROMPTS.md`, `assets/STYLE_GUIDE.md` оставлены
  «на будущее», но не подключены — не включай `loadAssets()` без согласования.
- При работе с ключами ассетов **всегда сверяй их с `manifest.json`** — расхождение
  статических констант и динамически собираемых строк-ключей уже ловило баг.

## Стиль кода / соглашения
- Комментарии и копирайт — на русском. Структура файлов — секциями с разделителями `// ---`.
- UI-копирайт и мемы централизованы в `src/ui/strings.js` — не размазывай строки по коду.
- Игровые объекты (Obstacle, DataBit, Heart, Boost) — простые классы с `update`/`draw`/`hitbox`.
- `geometry(W, H)` (из `world.js`) — единый источник истины по позициям полос/игрока;
  не пересчитывай геометрию заново в других местах.
- `FONT` в `src/engine/render.js` должен сохранять кириллические fallback'и
  (`Segoe UI`, `DejaVu Sans`, `Liberation Sans`), иначе `npm run shots` и CI-артефакты
  снова превратят русские подписи в квадраты.
