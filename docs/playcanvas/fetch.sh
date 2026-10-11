#!/bin/sh
# docs/playcanvas/fetch.sh — PlayCanvas для гри й для читання, одна версія на все:
# - js/lib/playcanvas/ (у git) — рушій, на якому йде гра (повна збірка build/playcanvas.mjs, не мінімізована — читабельні
#   стеки помилок), скрипт камери для стенду ?light і LICENSE (MIT: текст ліцензії — поруч з копією); import map у
#   index.html вказує туди — гра працює без інтернету;
# - docs/playcanvas/ (у git — лише цей скрипт і README.md) — код рушія з JSDoc, приклади, скрипти й посібник для читання.
# Версії: рушій — тег ENGINE, посібник — коміт SITE репозиторію developer-site
set -eu
ENGINE=v2.23.2
SITE=758cc212fe089a7734f1ac4a4fb93941f1136c23
D=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
git -c advice.detachedHead=false clone -q --depth 1 --branch "$ENGINE" --filter=blob:none --sparse https://github.com/playcanvas/engine "$T/engine"
git -C "$T/engine" sparse-checkout set src examples/src/examples scripts/esm
git clone -q --filter=blob:none --no-checkout https://github.com/playcanvas/developer-site "$T/site"
git -C "$T/site" sparse-checkout set docs llms
git -C "$T/site" -c advice.detachedHead=false checkout -q "$SITE"
rm -rf "$D/manual" "$D/engine"
mkdir -p "$D/manual" "$D/engine"
(cd "$T/site/docs" && find . -type f \( -name '*.md' -o -name '*.mdx' \) | while read -r f; do
  mkdir -p "$D/manual/$(dirname "$f")"; cp "$f" "$D/manual/$f"; done)
cp -r "$T/site/llms" "$D/manual/llms"          # офіційний покажчик PlayCanvas для ШІ-агентів (llms.txt)
cp -r "$T/engine/src" "$D/engine/src"
cp -r "$T/engine/examples/src/examples" "$D/engine/examples"
cp -r "$T/engine/scripts/esm" "$D/engine/scripts"
curl -sfL "https://cdn.jsdelivr.net/npm/playcanvas@${ENGINE#v}/build/playcanvas.d.ts" -o "$D/engine/playcanvas.d.ts"
echo "$ENGINE $SITE $(date -u +%F)" > "$D/VERSION"
# рушій для гри — з npm-пакета тієї самої версії
L="$D/../../js/lib/playcanvas"
NPM="https://cdn.jsdelivr.net/npm/playcanvas@${ENGINE#v}"
rm -rf "$L"
mkdir -p "$L/build" "$L/scripts/esm"
curl -sfL "$NPM/build/playcanvas.mjs" -o "$L/build/playcanvas.mjs"
curl -sfL "$NPM/scripts/esm/camera-controls.mjs" -o "$L/scripts/esm/camera-controls.mjs"
curl -sfL "$NPM/LICENSE" -o "$L/LICENSE"
echo "$ENGINE" > "$L/VERSION"
