#!/bin/sh
set -eu

if [ "${RELEASE_COMMAND:-}" = "1" ]; then
    if [ "$#" -eq 0 ]; then
        echo "Fly release command did not provide a command" >&2
        exit 64
    fi
    exec "$@"
fi

exec /usr/local/bin/buzz-relay "$@"
