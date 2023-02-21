#!/bin/sh
set -e

while :
do
  node index.js || true

  # wait 5 minutes
  echo Waiting 5 minutes...
  sleep 300
done