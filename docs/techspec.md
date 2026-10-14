# Робоче місце: запуск, тести, робота над проектом

Що потрібно на новій машині, щоб запустити гру, тести й продовжити роботу (зокрема Claude Code).

## Що встановити
| Що | Навіщо | Перевірено на |
|---|---|---|
| Linux | скрипти тестів — під Linux (групи процесів, `/tmp`) | Ubuntu 24.04, X11 |
| git, curl | репозиторій; `docs/playcanvas/fetch.sh` | — |
| Node.js 22 + npm | `npm test` (ESLint, `node --test`), скрипти `test/` | 22.20, npm 10.9 |
| Python 3 | `serve.py` — локальний сервер гри | 3.12 |
| Google Chrome | гра; браузерні тести — запускають саме команду `google-chrome` (`test/cdp.mjs`, `test/shots.mjs`), Chromium не підійде | 155 |
| Firefox (необов'язково) | `?strip` — детермінізм між рушіями. Snap-версія в headless бачить лише `~/snap/firefox/common/` | 157 (snap) |
| GPU NVIDIA + `nvidia-smi` (необов'язково) | заміри к/с; без GPU — лише перевірки помилок програмним рендером (`--sw`) | GTX 1660 Ti |
| Claude Code | робота з агентом; правила — `CLAUDE.md` і `docs/agent.md` у репозиторії, глобальних налаштувань не треба | — |

## Підготовка
```sh
git clone git@github.com:IClimber/echoverse.git
cd echoverse
npm ci                        # ESLint для npm test (node_modules не в git)
sh docs/playcanvas/fetch.sh   # документація й код PlayCanvas для читання (не в git)
git status                    # має бути чисто
```
`fetch.sh` заодно перезаписує `js/lib/playcanvas/` тією самою версією (2.23.2) — `git status` має лишитися чистим. Сама гра працює без нього: рушій і stdlib — у `js/lib/` в git, збирання немає, інтернет не потрібен.

## Запуск гри
```sh
python3 serve.py              # порт 8123; інший — python3 serve.py 8124
```
Відкривати `http://localhost:8123` — саме `localhost`: WebGPU браузер дає лише на захищених адресах; з `file://` модулі й worker не вантажаться. Сервер шле `Cache-Control: no-cache`, тож після змін коду досить перезавантажити сторінку.

Параметри адреси: `?dev` — `window.eco` для перевірок через CDP; стенди `?strip`, `?flora`, `?laws`, `?move`, `?light`.

## Тести
Без браузера:
```sh
npm test                      # лінтер + node --test test/*.test.mjs
node test/bench.mjs [зерно] [стовпців на бік]           # швидкість генерації
node test/laws-stats.mjs [--d=0] [--N=20000] [--seed=…] # розподіли законів
```
У браузері (headless Chrome через CDP; спершу запущений `python3 serve.py`):
```sh
nvidia-smi                    # GPU зайнятий — питати або --sw
node test/shots.mjs > shots.log 2>&1        # сцени, помилки консолі; знімки — у /tmp/echoverse-shots
node test/shots.mjs --sw > shots.log 2>&1   # програмний рендер: лише помилки, к/с так не міряти
node test/perf.mjs --api=webgpu --ports=8125,8124   # к/с A/B: версії — сервери на своїх портах (worktree)
node test/pixels.mjs --api=webgl2 --ports=8125,8124 # попіксельне порівняння кадрів двох версій
node test/stands.mjs > stands.log 2>&1       # стенди без помилок, ?strip — відбитки
pgrep -fc "[r]emote-debugging-port"         # після тестів — 0
```
Повні параметри — у шапці кожного скрипта. Вивід — у файл, не через `| tail`; нового рядка понад хвилину — зависання.

Заміри к/с:
- headless WebGL2 (ANGLE-Vulkan) у 3–8 разів повільніший за екран, headless WebGPU — ближчий;
- скрипти малюють з `--force-device-scale-factor=1.5` (полотно як на екрані 3840×2160 при масштабі 150 %);
- `--visible` у `perf.mjs` — видиме вікно через XWayland (`--ozone-platform=x11`): на Wayland вікно з окремим профілем не відкриває порт CDP.

## Перевірка, що все працює
1. `npm test` — без помилок.
2. `python3 serve.py` і `node test/shots.mjs` (без GPU — `--sw`) — сцени без помилок консолі.
3. `node test/stands.mjs` — стенди без помилок, `?strip` — «усі 12 відбитків збігаються» (Firefox — вручну `http://localhost:8123/?strip`).
