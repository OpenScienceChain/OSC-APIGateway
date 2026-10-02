#!/usr/bin/env sh
set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
SCANNER="$REPO_DIR/scripts/security/check_npm_supply_chain.py"
PYTHON="${PYTHON:-python3}"
CI_MODE=false
OFFLINE=false

for argument in "$@"; do
  case "$argument" in
    --ci) CI_MODE=true ;;
    --offline-reviewed) OFFLINE=true ;;
    *)
      echo "Unknown argument: $argument" >&2
      exit 64
      ;;
  esac
done

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  PYTHON=python
fi

set -- "$SCANNER" --repo "$REPO_DIR"
if [ "$OFFLINE" = true ]; then
  set -- "$@" --offline-reviewed
fi

cd "$REPO_DIR"
"$PYTHON" "$@" --skip-installed
npm ci --ignore-scripts --no-audit --fund=false
npm audit signatures
"$PYTHON" "$@"
npm rebuild "bcrypt" --ignore-scripts=false
"$PYTHON" "$@"

if [ "$CI_MODE" = false ]; then
  npm run prepare --if-present
fi
