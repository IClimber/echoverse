# PlayCanvas — локальна копія документації й коду

Правило користувача (10.10.2026): «Для роботи з PlayCanvas не придумуй нічого свого, використовуй документацію PlayCanvas
і шукай best practice по написаню 3D ігор».

У git — лише цей файл і `fetch.sh`; решту (~25 МБ) відновлює `sh docs/playcanvas/fetch.sh`. Версії — у `VERSION`.

Рушій, на якому йде гра, — не тут, а в `js/lib/playcanvas/` (у git; import map `index.html` вказує туди, гра працює
без інтернету): повна збірка `build/playcanvas.mjs`, `scripts/esm/camera-controls.mjs` (стенд `?light`) і `LICENSE`.
Його кладе той самий `fetch.sh` з тієї самої версії — код для читання тут і рушій гри завжди однієї версії.

## З чого почати
`manual/llms/llms.txt` → `manual/llms/user-manual/engine/llms.txt` — офіційний покажчик PlayCanvas для ШІ-агентів
(правила рушія 2 і перелік сторінок). Посилання `/user-manual/…/` у ньому — це файли `manual/user-manual/….md`
(чи `…/index.md`).

## Що де
- `manual/` — посібник (developer-site, Markdown);
- `engine/src` — код рушія з JSDoc (типові шматки шейдерів — `engine/src/scene/shader-lib/{glsl,wgsl}/chunks/`);
- `engine/playcanvas.d.ts` — API;
- `engine/examples` — офіційні приклади; `engine/scripts` — готові скрипти (`camera-controls.mjs`, `sky/procedural-sky.mjs`…).

Оновити версію: змінити `ENGINE` / `SITE` у `fetch.sh`, запустити скрипт (оновить і `docs/playcanvas/`, і `js/lib/playcanvas/`;
import map у `index.html` версії не містить).

## Для наших задач
Посібник (`manual/user-manual/graphics/…`):
- `lighting/lights.md`, `lighting/shadows.md`, `lighting/clustered-lighting.md`, `lighting/ambient-occlusion.md`;
- `physical-rendering/environment-lighting.md` (envAtlas, `EnvLighting`);
- `transparency.md` (`opacityDither`), `particles.md`;
- `advanced-rendering/hardware-instancing.md`, `advanced-rendering/multi-draw.md`;
- `layers/index.md`, `shaders/*`;
- `manual/user-manual/engine/standalone.md` — без збирання (import map), `manual/user-manual/ecs/*`.

Приклади й скрипти:
- `engine/examples/shaders/trees.*` — вітер шматком трансформації;
- `engine/examples/graphics/procedural-sky.example.mjs`, `engine/scripts/sky/procedural-sky.mjs` — небо й IBL;
- `engine/examples/graphics/{clustered-omni-shadows,shadow-cascades,shadow-soft}.example.mjs`;
- `engine/examples/graphics/{dithered-transparency,instancing-basic,particles-snow,multi-draw,layers}.example.mjs`;
- `engine/examples/camera/multi.example.mjs`, `engine/scripts/camera-controls.mjs` — камера огляду.
