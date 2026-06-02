# Problem
При игре в капчу возникала ошибка/предупреждение о ненайденных спрайтах ловушек (decoy). Иконки-ловушки не отрисовывались.

# Root Cause
В `src/game/captcha.js` логика пыталась динамически загружать ловушки-децои под ключами от `decoy_0` до `decoy_7`:
`const spriteKey = \`minigame/${tile.correct ? this.task.key : 'decoy_' + (r * GRID + c) % DECOY_EMOJI.length}\`;`
При этом `manifest.json` и `STYLE_GUIDE.md` описывали только один общий спрайт для рамки — `decoy_frame`. В итоге спрайты никогда не находились.

# Solution
В `captcha.js` заменён ключ для неправильных (decoy) плиток с динамического на статический:
`const spriteKey = \`minigame/${tile.correct ? this.task.key : 'decoy_frame'}\`;`

# Prevention
Всегда сверять ключи в коде загрузки ресурсов с манифестом файлов. При добавлении fallback-логики для ресурсов указывать дефолтные имена ключей в константах, чтобы легко отслеживать их использование.
