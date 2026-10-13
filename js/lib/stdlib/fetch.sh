#!/bin/sh
# js/lib/stdlib/fetch.sh — точна детермінована математика генерації (stdlib-js, Apache-2.0): порти fdlibm / FreeBSD msun
# (Sun) і Boost. Кожна функція — гілка deno пакета math-base-special-*: один ES-модуль без імпортів (працює без збирання
# й у module worker генератора). Усередині лише точні за IEEE 754 операції (з Math.* — sqrt, abs, floor, ceil, round),
# тож результат до біта однаковий у будь-якому рушії JS (CLAUDE.md, «Детермінізм генерації»). Версії закріплено тегами:
# зміна бітів після оновлення — тест LIB_GOLD (js/golden.js), а з ним і GEN.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
CDN=https://cdn.jsdelivr.net/gh/stdlib-js
RAW=https://raw.githubusercontent.com/stdlib-js
for e in sin:v0.3.1 cos:v0.3.1 cbrt:v0.2.3 log10:v0.3.1 erfcinv:v0.2.4; do
  f=${e%%:*}; v=${e#*:}
  curl -sfL "$CDN/math-base-special-$f@$v-deno/mod.js" | grep -v '^//# sourceMappingURL=' > "$D/$f.js"   # карти коду поруч немає
  if grep -q 'from"\|from "\|import(' "$D/$f.js"; then echo "$f.js імпортує інші модулі" >&2; exit 1; fi
  if grep -o 'Math\.[a-z0-9]*' "$D/$f.js" | grep -qv 'Math\.\(sqrt\|abs\|floor\|ceil\|round\)$'; then echo "$f.js: неточна функція Math" >&2; exit 1; fi
  echo "math-base-special-$f $v-deno" >> "$D/VERSION.tmp"
done
mv "$D/VERSION.tmp" "$D/VERSION"
curl -sfL "$RAW/math-base-special-sin/v0.3.1/LICENSE" -o "$D/LICENSE"                    # Apache-2.0 + FreeBSD (Sun): sin, cos, cbrt, log10
curl -sfL "$RAW/math-base-special-erfcinv/v0.2.4/LICENSE" -o "$D/LICENSE.erfcinv"        # Apache-2.0 + Boost: erfcinv
curl -sfL "$RAW/math-base-special-sin/v0.3.1/NOTICE" -o "$D/NOTICE"
