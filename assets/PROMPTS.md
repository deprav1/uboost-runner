# ЮБуст Раннер — Промпты для генерации ассетов

Используй промпты из этого файла в любом image-gen инструменте.
Перед каждым промптом применяй **общий префикс** из `STYLE_GUIDE.md`.

---

## ОБЩИЙ ПРЕФИКС (вставлять в начало каждого промпта)

```
flat vector neon sticker game sprite, pure black background #000000,
red glowing neon outline #ff2937, white and red only, transparent PNG,
no photorealism, no 3d render, no shadow, crisp clean edges, bold strokes
```

---

## 🚧 OBSTACLES (256×256 px, прозрачный фон)

### `obstacles/captcha.png`
**Что это:** Стена-капча с надписью «Я НЕ РОБОТ»

```
[PREFIX], CAPTCHA verification wall obstacle, 3x3 grid of small squares with red neon glow,
text "Я НЕ РОБОТ" in bold white letters, dark panel with red border,
robot check symbol, red warning glow, game enemy sprite
--ar 1:1 --no blue --no green
```

**Негатив:** photorealistic, 3d, blue tones, green, gradient, shadow, blurry

---

### `obstacles/geoblock.png`
**Что это:** Красная стена РКН с замком

```
[PREFIX], geo-blocking wall obstacle, massive red neon wall with padlock icon in center,
"ЗАБЛОКИРОВАНО" text, bold red frame, government censorship symbol,
impenetrable barrier, red glow, game enemy sprite 256x256
--ar 1:1
```

**Негатив:** photorealistic, 3d, blue, green, cute style, soft colors

---

### `obstacles/ad.png`
**Что это:** Всплывающая реклама казино/маркетплейса

```
[PREFIX], intrusive pop-up advertisement obstacle, casino ad window sprite,
bright flashing banner "1ХСТАВКА -90% КРЕДИТ 0%", cluttered info,
small X close button top-right, white border with red accent, meme satirical
--ar 1:1
```

**Негатив:** photorealistic, 3d, real brand logos, NSFW

---

### `obstacles/lag.png`
**Что это:** Глитч-блок «сервер упал»

```
[PREFIX], server lag glitch obstacle, dark broken server block sprite,
loading spinner icon (circle with gap), horizontal glitch scan lines in red and white,
"СБЕР ЛЁГ" text, corrupted pixels effect, error state
--ar 1:1
```

**Негатив:** photorealistic, 3d, cheerful colors, green

---

## 🌍 WORLD (разные размеры, тёмный фон)

### `world/skyline.png` (1024×256 px, тёмно-прозрачный фон)
**Что это:** Панорама рунет-горизонта, tileable

```
[PREFIX], runet city skyline tileable background layer, dark red neon city silhouette,
angular data-center towers, satellite dishes, server racks shaped as buildings,
dark background #0a0204 with subtle red glow at base,
seamless horizontal tile, 1024x256 format
--ar 4:1
```

**Негатив:** photorealistic, daylight, blue sky, windows, normal city buildings

---

### `world/core.png` (512×512 px, прозрачный)
**Что это:** Красное пульсирующее ядро / «солнце» в центре горизонта

```
[PREFIX], glowing red neon sun core sprite, perfect circle with horizontal black stripes,
intense red radial glow #ff2937, dark center with gradient bands,
synthwave retro sun style but red-and-black only, transparent background
--ar 1:1
```

**Негатив:** yellow, orange, cyan, magenta, realistic sun

---

### `world/tower_a.png` (64×256 px, прозрачный)
**Что это:** Узкая дата-башня для параллакса

```
[PREFIX], narrow data tower building silhouette, server rack shaped skyscraper,
dark with red neon edge lines, antenna on top, 64x256 portrait format,
transparent background, city background element
--ar 1:4
```

---

### `world/tower_b.png` (96×320 px, прозрачный)
**Что это:** Широкая дата-башня с антенной

```
[PREFIX], wide data center tower silhouette, brutalist building with red neon windows,
satellite dish on top, bold geometric shapes, 96x320 portrait sprite,
transparent background
--ar 3:10
```

---

## 🎮 MINIGAME (128×128 px, прозрачный)

### `minigame/traffic_light.png`
```
[PREFIX], traffic light icon sticker 128x128, three circles red/yellow/green,
bold black pole, cartoon flat vector, red top circle glowing, game UI icon
```

### `minigame/bus.png`
```
[PREFIX], city bus icon sticker 128x128, boxy cartoon bus side view,
red and white colors, bold outlines, simple flat vector, game UI icon
```

### `minigame/hydrant.png`
```
[PREFIX], fire hydrant icon sticker 128x128, classic round fire hydrant,
red neon outline, flat vector cartoon, bold strokes, game UI icon
```

### `minigame/storefront.png`
```
[PREFIX], shop storefront icon sticker 128x128, simple store facade with awning,
red neon sign above, flat vector cartoon, bold outlines, game UI icon
```

### `minigame/motorcycle.png`
```
[PREFIX], motorcycle icon sticker 128x128, side view of a motorbike,
red and white flat vector, bold lines, cartoon style, game UI icon
```

### `minigame/taxi.png`
```
[PREFIX], taxi car icon sticker 128x128, side view of a taxi cab,
checkered pattern, white and red colors, flat vector cartoon, bold outlines
```

### `minigame/decoy_frame.png`
**Что это:** Нейтральная рамка для «пустых» плиток

```
[PREFIX], empty square tile frame 128x128, subtle dark red dashed border,
slightly transparent dark fill, neutral game UI tile background
```

---

## 🎉 GAGS (мем-стикеры событий)

### `gags/heart.png` (128×128 px, прозрачный)
**Что это:** Пикап-сердце +1 жизнь

```
[PREFIX], heart life icon sticker 128x128, bold red heart shape,
intense red neon glow, white highlight, +1 life power-up, game collectible sprite
```

**Негатив:** pink, girly, realistic heart, anatomical

---

### `gags/sber_down.png` (256×128 px, прозрачный)
**Что это:** Мем-баннер «СБЕР ЛЁГ»

```
[PREFIX], meme banner "СБЕР ЛЁГ" 256x128, broken server error message sticker,
glitch lines through text, red neon glow, dark panel, Russian internet meme style,
error 503 vibe, satirical
```

---

### `gags/rkn_badge.png` (256×128 px, прозрачный)
**Что это:** Мем-знак «РКН ЗАМЕДЛИЛ»

```
[PREFIX], badge sticker "РКН ЗАМЕДЛИЛ" 256x128, censorship warning sign,
red octagon stop sign shape, bold white text, barbed wire decoration,
satirical Russian internet censorship meme
```

---

### `gags/ad_popup.png` (256×128 px, прозрачный)
**Что это:** Мем-попап «реклама»

```
[PREFIX], intrusive advertisement popup sticker 256x128, cluttered banner with fake offers,
"ВЫ ВЫИГРАЛИ 1 РУБЛЬ" text, tiny X close button, flashing casino-style,
meme about Russian internet ads, satirical
```

---

### `gags/combo_burst.png` (256×256 px, 4 кадра, прозрачный)
**Что это:** 4 кадра анимации комбо-вспышки (×10, ×25, ×50, ×100)

```
[PREFIX], combo burst animation sprite sheet 256x256, 4 frames arranged in 2x2 grid,
each frame shows an explosion burst with a number (×10, ×25, ×50, ×100),
red neon particle explosion, white text, game combo animation sprite
```

**Примечание:** Кадры в сетке 2×2 (каждый 128×128). Код вырезает по индексу кадра.

---

## Подсказки для разных генераторов

| Инструмент   | Советы                                                          |
|--------------|-----------------------------------------------------------------|
| Midjourney   | Добавь `--no photorealism --style raw --q 2` в конец           |
| DALL·E 3     | Добавь «in flat vector game art style» перед PREFIX            |
| Flux / SDXL  | Негатив: `photorealistic, 3d render, shadow, gradient, blurry` |
| Ideogram     | Хорошо работает с текстом на кириллице — укажи шрифт bold      |
