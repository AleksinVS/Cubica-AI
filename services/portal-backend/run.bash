#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    printf 'NVM is not installed at %s\n' "$NVM_DIR" >&2
    exit 1
fi

. "$NVM_DIR/nvm.sh"
nvm use
npm run develop
