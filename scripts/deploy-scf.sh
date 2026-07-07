#!/usr/bin/env bash
set -euo pipefail

: "${TENCENTCLOUD_SECRET_ID:?Missing TENCENTCLOUD_SECRET_ID}"
: "${TENCENTCLOUD_SECRET_KEY:?Missing TENCENTCLOUD_SECRET_KEY}"
: "${SCF_REGION:?Missing SCF_REGION}"
: "${SCF_FUNCTION_NAME:?Missing SCF_FUNCTION_NAME}"

NAMESPACE="${SCF_NAMESPACE:-default}"
ZIP_FILE="${ZIP_FILE:-function.zip}"

if [[ ! -f "$ZIP_FILE" ]]; then
  echo "Zip file not found: $ZIP_FILE" >&2
  exit 1
fi

declare -A DEFAULTS=(
  [SILICONFLOW_BASE_URL]="https://api.siliconflow.cn/v1"
  [AI_CHAT_MODEL]="THUDM/GLM-4-9B-0414"
  [AI_CASE_MODEL]="Qwen/Qwen3-8B"
  [AI_EVALUATE_MODEL]="deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
  [AI_IMAGE_MODEL]="Kwai-Kolors/Kolors"
  [TCB_REGION]="ap-shanghai"
  [DB_ADAPTER]="memory"
  [KV_ADAPTER]="memory"
  [BLOB_ADAPTER]="local"
)

KEYS=(
  SILICONFLOW_API_KEY
  SILICONFLOW_BASE_URL
  AI_CHAT_MODEL
  AI_CASE_MODEL
  AI_EVALUATE_MODEL
  AI_IMAGE_MODEL
  TCB_ENV_ID
  TCB_PUBLIC_ENV_ID
  TCB_REGION
  TCB_SECRET_ID
  TCB_SECRET_KEY
  DB_ADAPTER
  MONGODB_URI
  MONGODB_DB
  KV_ADAPTER
  EO_SECRET_ID
  EO_SECRET_KEY
  EO_ZONE_ID
  KV_NAMESPACE
  BLOB_ADAPTER
  BLOB_PUBLIC_BASE_URL
  EO_BLOB_UPLOAD_URL
  EO_BLOB_UPLOAD_TOKEN
  ADMIN_SECRET
)

export ENV_KEYS=$(printf '%s,' "${KEYS[@]}")
export ENV_KEYS="${ENV_KEYS%,}"

ENV_JSON=$(python3 - <<'PY'
import json, os, sys

defaults = {
    "SILICONFLOW_BASE_URL": "https://api.siliconflow.cn/v1",
    "AI_CHAT_MODEL": "THUDM/GLM-4-9B-0414",
    "AI_CASE_MODEL": "Qwen/Qwen3-8B",
    "AI_EVALUATE_MODEL": "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    "AI_IMAGE_MODEL": "Kwai-Kolors/Kolors",
    "TCB_REGION": "ap-shanghai",
    "DB_ADAPTER": "memory",
    "KV_ADAPTER": "memory",
    "BLOB_ADAPTER": "local",
}

keys = os.environ.get("ENV_KEYS", "").split(",")
variables = []
for key in keys:
    key = key.strip()
    if not key:
        continue
    value = os.environ.get(key) or defaults.get(key)
    if value:
        variables.append({"Key": key, "Value": value})

print(json.dumps({"Variables": variables}, ensure_ascii=False))
PY
)

echo "Uploading function code..."
tccli scf UpdateFunctionCode \
  --region "$SCF_REGION" \
  --FunctionName "$SCF_FUNCTION_NAME" \
  --Namespace "$NAMESPACE" \
  --Handler cloud-functions/index.main \
  --ZipFile "fileb://${ZIP_FILE}" \
  --Publish TRUE

echo "Updating function configuration..."
tccli scf UpdateFunctionConfiguration \
  --region "$SCF_REGION" \
  --FunctionName "$SCF_FUNCTION_NAME" \
  --Namespace "$NAMESPACE" \
  --Timeout 120 \
  --MemorySize 512 \
  --Environment "$ENV_JSON"

echo "Deploy complete."
