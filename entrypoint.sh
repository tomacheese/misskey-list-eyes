#!/bin/sh
set -e

while :
do
  ./node_modules/.bin/ts-node -r tsconfig-paths/register ./src/main.ts || true

  # wait 5 minutes
  echo Waiting 5 minutes...
  sleep 300
done