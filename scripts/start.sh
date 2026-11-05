#!/bin/sh
# Container entrypoint: apply migrations, start the worker in the background,
# then serve the app. If either process exits, the container stops so the
# host restarts it.
set -e
npm run db:migrate
npx tsx src/worker/index.ts &
WORKER=$!
npx next start -p "${PORT:-3000}" &
WEB=$!
trap 'kill $WORKER $WEB 2>/dev/null' TERM INT
while kill -0 $WORKER 2>/dev/null && kill -0 $WEB 2>/dev/null; do sleep 5; done
kill $WORKER $WEB 2>/dev/null || true
exit 1
