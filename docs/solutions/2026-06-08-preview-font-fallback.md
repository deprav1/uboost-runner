# Problem
Preview-рендеры и CI-артефакты из `npm run shots` показывали русские подписи квадратиками вместо текста. Это ломало `preview/*.png` в README и делало визуальную проверку бесполезной.

# Root Cause
Canvas-рендер в Node полагался на слишком узкий font stack (`Manrope`/`Inter` + generic fallback). В офлайн-среде `@napi-rs/canvas` не находил кириллический шрифт с корректными glyphs, поэтому текст падал в tofu.

# Solution
Расширен font stack в `src/engine/render.js` системными fallback'ами с кириллицей (`Segoe UI`, `Arial`, `DejaVu Sans`, `Liberation Sans`). Дополнительно `test/render-shot.mjs` стал детерминированным через фиксированный seed, чтобы превью и CI-артефакты не дрейфовали от случайности.

# Prevention
Если меняешь canvas-шрифты, сразу прогоняй `npm run shots` и визуально проверяй `preview/*.png`. Для всех новых preview/CI-сценариев держи кириллический fallback и не завязывайся на веб-шрифты, которые доступны только в браузере.
