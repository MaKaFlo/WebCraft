#!/usr/bin/env bash
# Downloads Paper (default 26.3) into .paper/ and unpacks it, so webcraft-plugin can compile against it.
# Needs: curl, python3 (to read the API answer), JDK 25.
#   tools/fetch-paper.sh [version]
set -euo pipefail
VERSION="${1:-26.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.paper"
mkdir -p "$DIR"
cd "$DIR"

URL=$(curl -fsSL "https://fill.papermc.io/v3/projects/paper/versions/$VERSION/builds/latest" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["downloads"]["server:default"]["url"])')
echo "Downloading $URL"
curl -fsSL -o paper.jar "$URL"

# Paperclip only unpacks the server and its libraries (versions/, libraries/) and exits
java -Dpaperclip.patchonly=true -jar paper.jar
echo "Paper $VERSION ready in $DIR"
