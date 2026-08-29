#!/bin/bash
set -e
pnpm install --frozen-lockfile
rm -rf artifacts/web/node_modules/.vite
pnpm --filter db push-force
