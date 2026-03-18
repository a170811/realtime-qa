#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://api.openai.com}"
BASE_URL="${BASE_URL%/}"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "Error: OPENAI_API_KEY is not set" >&2
  exit 1
fi

curl -s "${BASE_URL}/v1/realtime/client_secrets" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"session":{"type":"realtime","model":"gpt-realtime"}}' | python3 -m json.tool
