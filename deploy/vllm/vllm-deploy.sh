#!/usr/bin/env bash
set -euo pipefail

# Deploy or replace a Docker based vLLM OpenAI-compatible server.
# Secrets are kept in a root-readable file and mounted into the container as a
# read-only secret. The API key is never written to the Docker environment or
# printed by this script.

SCRIPT_NAME="$(basename "$0")"
USER_HOME="${HOME:-/tmp}"

if [[ "$(id -u)" -eq 0 ]]; then
  DEFAULT_STATE_DIR="/opt/vllm"
else
  DEFAULT_STATE_DIR="${XDG_STATE_HOME:-$USER_HOME/.local/state}/vllm"
fi

MODEL="${VLLM_MODEL:-Qwen/Qwen3.6-35B-A3B-FP8}"
PORT="${VLLM_PORT:-18000}"
HOST="${VLLM_HOST:-0.0.0.0}"
IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.19.0}"
CONTAINER_NAME="${VLLM_CONTAINER_NAME:-vllm-qwen}"
STATE_DIR="${VLLM_STATE_DIR:-$DEFAULT_STATE_DIR}"
MODEL_CACHE_DIR="${VLLM_MODEL_CACHE_DIR:-}"
COMPILE_CACHE_DIR="${VLLM_COMPILE_CACHE_DIR:-}"
HF_ENDPOINT="${VLLM_HF_ENDPOINT:-https://hf-mirror.com}"
TP_SIZE="${VLLM_TP_SIZE:-2}"
MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN:-32768}"
GPU_MEMORY_UTILIZATION="${VLLM_GPU_MEMORY_UTILIZATION:-0.90}"
MAX_NUM_BATCHED_TOKENS="${VLLM_MAX_NUM_BATCHED_TOKENS:-1024}"
MAX_NUM_SEQS="${VLLM_MAX_NUM_SEQS:-1}"
DTYPE="${VLLM_DTYPE:-auto}"
KV_CACHE_DTYPE="${VLLM_KV_CACHE_DTYPE:-auto}"
SHM_SIZE="${VLLM_SHM_SIZE:-16g}"
CHAT_TEMPLATE="${VLLM_CHAT_TEMPLATE:-}"
SERVED_MODEL_NAME="${VLLM_SERVED_MODEL_NAME:-}"
ENFORCE_EAGER="${VLLM_ENFORCE_EAGER:-1}"
STARTUP_TIMEOUT="${VLLM_STARTUP_TIMEOUT:-900}"
API_KEY="${VLLM_API_KEY:-}"
API_KEY_INPUT_FILE=""
ROTATE_KEY=0
REPLACE=0
SKIP_PULL=0
DRY_RUN=0
QUIET=0

fail() {
  echo "$SCRIPT_NAME: $*" >&2
  exit 2
}

log() {
  ((QUIET)) || printf '%s\n' "$*"
}

usage() {
  cat <<'EOF'
Deploy a Docker vLLM OpenAI-compatible server with API-key authentication.

usage:
  vllm-deploy.sh [options]

Core options:
  --model MODEL                  Hugging Face model ID or cached model path.
  --port PORT                    Host/API port (default: 18000).
  --host ADDRESS                 vLLM bind address (default: 0.0.0.0).
  --api-key KEY                  Set/rotate a key. Prefer --api-key-file.
  --api-key-file FILE            Read one key line from a 0400/0600 file.
  --rotate-key                   Generate a new key if no key is supplied.
  --container-name NAME          Docker container name (default: vllm-qwen).
  --state-dir DIR                State, secret, cache and backup root.
  --image IMAGE                  vLLM image (default: vllm/vllm-openai:v0.19.0).

Runtime options:
  --tensor-parallel-size N       GPU tensor parallel size (default: 2).
  --max-model-len N              Context length (default: 32768).
  --gpu-memory-utilization F     GPU memory fraction (default: 0.90).
  --max-num-batched-tokens N     Batch token cap (default: 1024).
  --max-num-seqs N               Concurrent sequence cap (default: 1).
  --dtype VALUE                  vLLM dtype (default: auto).
  --kv-cache-dtype VALUE         KV cache dtype (default: auto).
  --chat-template FILE           Optional chat template path in the container.
  --served-model-name NAME       Optional public model alias.
  --no-enforce-eager             Allow CUDA graphs (higher throughput, more VRAM).
  --shm-size SIZE                Docker shared memory size (default: 16g).
  --hf-endpoint URL              Hugging Face endpoint (default: hf-mirror.com).
  --model-cache DIR              Host Hugging Face cache directory.
  --compile-cache DIR            Host vLLM/Torch compile cache directory.
  --startup-timeout SECONDS      Readiness timeout (default: 900).

Safety and execution:
  --replace                      Rename an existing container before replacing it.
  --skip-pull                    Do not pull the Docker image.
  --dry-run                      Validate and print the planned deployment only.
  --quiet                        Suppress progress messages.
  -h, --help                     Show this help.

Examples:
  # First deployment; generates a key and stores it under the state directory.
  sudo ./deploy/vllm/vllm-deploy.sh \
    --model Qwen/Qwen3.6-35B-A3B-FP8 --port 18000 \
    --tensor-parallel-size 2 --replace

  # Reuse a caller-managed key without putting it in shell history.
  sudo ./deploy/vllm/vllm-deploy.sh \
    --api-key-file /root/vllm-api-key \
    --model Qwen/Qwen3.6-35B-A3B-FP8 --port 18000 --replace
EOF
}

is_uint() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

validate_port() {
  is_uint "$1" || fail "port must be an integer: $1"
  ((1 <= 10#$1 && 10#$1 <= 65535)) || fail "port out of range: $1"
}

validate_positive_int() {
  is_uint "$1" || fail "value must be a positive integer: $1"
  ((10#$1 > 0)) || fail "value must be greater than zero: $1"
}

validate_decimal() {
  [[ "$1" =~ ^0?\.[0-9]+$|^1(\.0+)?$ ]] || fail "expected a fraction from 0 to 1: $1"
}

validate_single_line() {
  local value="$1" label="$2"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "$label must be one line"
}

generate_api_key() {
  if command -v openssl >/dev/null 2>&1; then
    printf 'sk-%s\n' "$(openssl rand -hex 24)"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print("sk-" + secrets.token_hex(24))
PY
  else
    fail 'generating an API key requires openssl or python3; pass --api-key-file instead'
  fi
}

mask_secret() {
  local value="$1"
  if ((${#value} <= 6)); then
    printf '%s' '***'
  else
    printf '%s***%s' "${value:0:3}" "${value: -2}"
  fi
}

read_key_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail "API key file is missing or is a symlink: $path"
  local mode
  mode="$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path" 2>/dev/null || true)"
  if [[ -n "$mode" && "$mode" != 400 && "$mode" != 600 ]]; then
    fail "API key file must have mode 0400 or 0600: $path (current $mode)"
  fi
  tr -d '\r\n' < "$path"
}

write_private_file() {
  local path="$1" mode="$2" content="$3"
  local temporary="${path}.tmp.$$"
  umask 077
  printf '%s\n' "$content" > "$temporary"
  chmod "$mode" "$temporary"
  mv -f -- "$temporary" "$path"
}

write_env_file() {
  local path="$1"
  local temporary="${path}.tmp.$$"
  umask 077
  {
    printf 'VLLM_MODEL=%s\n' "$MODEL"
    printf 'VLLM_HOST=%s\n' "$HOST"
    printf 'VLLM_PORT=%s\n' "$PORT"
    printf 'VLLM_TP_SIZE=%s\n' "$TP_SIZE"
    printf 'VLLM_MAX_MODEL_LEN=%s\n' "$MAX_MODEL_LEN"
    printf 'VLLM_GPU_MEMORY_UTILIZATION=%s\n' "$GPU_MEMORY_UTILIZATION"
    printf 'VLLM_MAX_NUM_BATCHED_TOKENS=%s\n' "$MAX_NUM_BATCHED_TOKENS"
    printf 'VLLM_MAX_NUM_SEQS=%s\n' "$MAX_NUM_SEQS"
    printf 'VLLM_DTYPE=%s\n' "$DTYPE"
    printf 'VLLM_KV_CACHE_DTYPE=%s\n' "$KV_CACHE_DTYPE"
    printf 'VLLM_ENFORCE_EAGER=%s\n' "$ENFORCE_EAGER"
    printf 'VLLM_CHAT_TEMPLATE=%s\n' "$CHAT_TEMPLATE"
    printf 'VLLM_SERVED_MODEL_NAME=%s\n' "$SERVED_MODEL_NAME"
    printf 'HF_ENDPOINT=%s\n' "$HF_ENDPOINT"
    printf 'HF_HOME=/root/.cache/huggingface\n'
    printf 'VLLM_CACHE_ROOT=/root/.cache/vllm\n'
    printf 'TORCHINDUCTOR_CACHE_DIR=/root/.cache/torch\n'
  } > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$path"
}

write_entrypoint() {
  local path="$1"
  local temporary="${path}.tmp.$$"
  cat > "$temporary" <<'EOF'
#!/bin/sh
set -eu

KEY_FILE=/run/secrets/vllm_api_key
[ -r "$KEY_FILE" ] || { echo 'vLLM API key secret is not readable' >&2; exit 1; }
VLLM_API_KEY="$(cat "$KEY_FILE")"
[ -n "$VLLM_API_KEY" ] || { echo 'vLLM API key secret is empty' >&2; exit 1; }

set -- vllm serve "$VLLM_MODEL" \
  --host "$VLLM_HOST" \
  --port "$VLLM_PORT" \
  --api-key "$VLLM_API_KEY" \
  --tensor-parallel-size "$VLLM_TP_SIZE" \
  --max-model-len "$VLLM_MAX_MODEL_LEN" \
  --gpu-memory-utilization "$VLLM_GPU_MEMORY_UTILIZATION" \
  --max-num-batched-tokens "$VLLM_MAX_NUM_BATCHED_TOKENS" \
  --max-num-seqs "$VLLM_MAX_NUM_SEQS" \
  --trust-remote-code

if [ -n "${VLLM_DTYPE:-}" ] && [ "$VLLM_DTYPE" != auto ]; then
  set -- "$@" --dtype "$VLLM_DTYPE"
fi
if [ -n "${VLLM_KV_CACHE_DTYPE:-}" ] && [ "$VLLM_KV_CACHE_DTYPE" != auto ]; then
  set -- "$@" --kv-cache-dtype "$VLLM_KV_CACHE_DTYPE"
fi

if [ "${VLLM_ENFORCE_EAGER:-0}" = 1 ]; then
  set -- "$@" --enforce-eager
fi
if [ -n "${VLLM_CHAT_TEMPLATE:-}" ]; then
  set -- "$@" --chat-template "$VLLM_CHAT_TEMPLATE"
fi
if [ -n "${VLLM_SERVED_MODEL_NAME:-}" ]; then
  set -- "$@" --served-model-name "$VLLM_SERVED_MODEL_NAME"
fi

exec "$@"
EOF
  chmod 700 "$temporary"
  mv -f -- "$temporary" "$path"
}

container_exists() {
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)" == true ]]
}

backup_existing_container() {
  local backup_dir="$1"
  local previous_name="${CONTAINER_NAME}.previous-${STAMP}"
  if docker container inspect "$previous_name" >/dev/null 2>&1; then
    previous_name="${previous_name}-$$"
  fi
  docker inspect "$CONTAINER_NAME" > "$backup_dir/old-container.inspect.json"
  docker logs --tail 300 "$CONTAINER_NAME" > "$backup_dir/old-container.log" 2>&1 || true
  if container_running; then
    log "停止旧容器 $CONTAINER_NAME …"
    docker stop -t 30 "$CONTAINER_NAME" >/dev/null
  fi
  docker rename "$CONTAINER_NAME" "$previous_name"
  printf '%s\n' "$previous_name" > "$backup_dir/old-container.name"
  OLD_CONTAINER_NAME="$previous_name"
}

restore_old_container() {
  local backup_dir="$1"
  [[ -n "${OLD_CONTAINER_NAME:-}" ]] || return 0
  if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if docker container inspect "$OLD_CONTAINER_NAME" >/dev/null 2>&1; then
    if [[ -f "$backup_dir/old-api-key" ]]; then
      cp "$backup_dir/old-api-key" "$KEY_FILE"
      chmod 600 "$KEY_FILE"
    fi
    docker rename "$OLD_CONTAINER_NAME" "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
    log "已尝试恢复旧容器；回滚证据：$backup_dir"
  fi
}

run_container() {
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --gpus all \
    --network host \
    --ipc host \
    --shm-size "$SHM_SIZE" \
    --env-file "$ENV_FILE" \
    --mount "type=bind,src=$KEY_FILE,dst=/run/secrets/vllm_api_key,readonly" \
    --mount "type=bind,src=$ENTRYPOINT_FILE,dst=/usr/local/bin/vllm-entrypoint,readonly" \
    --mount "type=bind,src=$MODEL_CACHE_DIR,dst=/root/.cache/huggingface" \
    --mount "type=bind,src=$COMPILE_CACHE_DIR,dst=/root/.cache/vllm" \
    --mount "type=bind,src=$COMPILE_CACHE_DIR,dst=/root/.cache/torch" \
    --entrypoint /bin/sh \
    "$IMAGE" /usr/local/bin/vllm-entrypoint
}

http_status() {
  local url="$1"
  shift
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" "$@" 2>/dev/null || printf '000'
}

wait_for_ready() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT))
  local health_code model_code
  while ((SECONDS < deadline)); do
    health_code="$(http_status "http://127.0.0.1:$PORT/health")"
    model_code="$(http_status "http://127.0.0.1:$PORT/v1/models" -H "Authorization: Bearer $API_KEY")"
    if [[ "$health_code" == 200 && "$model_code" == 200 ]]; then
      return 0
    fi
    log "等待 vLLM 就绪：health=$health_code models=$model_code …"
    sleep 5
  done
  return 1
}

verify_auth() {
  local no_key_code key_code
  no_key_code="$(http_status "http://127.0.0.1:$PORT/v1/models")"
  key_code="$(http_status "http://127.0.0.1:$PORT/v1/models" -H "Authorization: Bearer $API_KEY")"
  [[ "$key_code" == 200 ]] || fail "带 API key 的 /v1/models 验证失败：HTTP $key_code"
  [[ "$no_key_code" == 401 || "$no_key_code" == 403 ]] || fail "无 API key 的鉴权验证失败：HTTP $no_key_code"
  log "鉴权验证通过：无 key=${no_key_code}，有 key=${key_code}"
}

print_model_ids() {
  local body
  body="$(curl -sS --connect-timeout 5 --max-time 15 \
    "http://127.0.0.1:$PORT/v1/models" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null || true)"
  if [[ -n "$body" && -x "$(command -v python3 2>/dev/null || true)" ]]; then
    python3 - "$body" <<'PY' 2>/dev/null || true
import json
import sys
try:
    value = json.loads(sys.argv[1])
    ids = [item.get("id") for item in value.get("data", []) if item.get("id")]
    if ids:
        print("模型列表：" + ", ".join(ids))
except Exception:
    pass
PY
  fi
}

while (($#)); do
  case "$1" in
    --model)
      [[ $# -ge 2 ]] || fail '--model requires a value'
      MODEL="$2"; shift 2 ;;
    --port)
      [[ $# -ge 2 ]] || fail '--port requires a value'
      PORT="$2"; shift 2 ;;
    --host)
      [[ $# -ge 2 ]] || fail '--host requires a value'
      HOST="$2"; shift 2 ;;
    --api-key|--key)
      [[ $# -ge 2 ]] || fail '--api-key requires a value'
      API_KEY="$2"; shift 2 ;;
    --api-key-file)
      [[ $# -ge 2 ]] || fail '--api-key-file requires a path'
      API_KEY_INPUT_FILE="$2"; shift 2 ;;
    --rotate-key)
      ROTATE_KEY=1; shift ;;
    --container-name)
      [[ $# -ge 2 ]] || fail '--container-name requires a value'
      CONTAINER_NAME="$2"; shift 2 ;;
    --state-dir)
      [[ $# -ge 2 ]] || fail '--state-dir requires a path'
      STATE_DIR="$2"; shift 2 ;;
    --model-cache)
      [[ $# -ge 2 ]] || fail '--model-cache requires a path'
      MODEL_CACHE_DIR="$2"; shift 2 ;;
    --compile-cache)
      [[ $# -ge 2 ]] || fail '--compile-cache requires a path'
      COMPILE_CACHE_DIR="$2"; shift 2 ;;
    --image)
      [[ $# -ge 2 ]] || fail '--image requires a value'
      IMAGE="$2"; shift 2 ;;
    --tensor-parallel-size|--tp)
      [[ $# -ge 2 ]] || fail '--tensor-parallel-size requires a value'
      TP_SIZE="$2"; shift 2 ;;
    --max-model-len)
      [[ $# -ge 2 ]] || fail '--max-model-len requires a value'
      MAX_MODEL_LEN="$2"; shift 2 ;;
    --gpu-memory-utilization)
      [[ $# -ge 2 ]] || fail '--gpu-memory-utilization requires a value'
      GPU_MEMORY_UTILIZATION="$2"; shift 2 ;;
    --max-num-batched-tokens)
      [[ $# -ge 2 ]] || fail '--max-num-batched-tokens requires a value'
      MAX_NUM_BATCHED_TOKENS="$2"; shift 2 ;;
    --max-num-seqs)
      [[ $# -ge 2 ]] || fail '--max-num-seqs requires a value'
      MAX_NUM_SEQS="$2"; shift 2 ;;
    --dtype)
      [[ $# -ge 2 ]] || fail '--dtype requires a value'
      DTYPE="$2"; shift 2 ;;
    --kv-cache-dtype)
      [[ $# -ge 2 ]] || fail '--kv-cache-dtype requires a value'
      KV_CACHE_DTYPE="$2"; shift 2 ;;
    --chat-template)
      [[ $# -ge 2 ]] || fail '--chat-template requires a value'
      CHAT_TEMPLATE="$2"; shift 2 ;;
    --served-model-name)
      [[ $# -ge 2 ]] || fail '--served-model-name requires a value'
      SERVED_MODEL_NAME="$2"; shift 2 ;;
    --no-enforce-eager)
      ENFORCE_EAGER=0; shift ;;
    --shm-size)
      [[ $# -ge 2 ]] || fail '--shm-size requires a value'
      SHM_SIZE="$2"; shift 2 ;;
    --hf-endpoint)
      [[ $# -ge 2 ]] || fail '--hf-endpoint requires a value'
      HF_ENDPOINT="$2"; shift 2 ;;
    --startup-timeout)
      [[ $# -ge 2 ]] || fail '--startup-timeout requires a value'
      STARTUP_TIMEOUT="$2"; shift 2 ;;
    --replace)
      REPLACE=1; shift ;;
    --skip-pull)
      SKIP_PULL=1; shift ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    --quiet)
      QUIET=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

validate_single_line "$MODEL" model
validate_single_line "$HOST" host
validate_single_line "$IMAGE" image
validate_single_line "$CONTAINER_NAME" container-name
[[ "$MODEL" != *[[:space:]]* ]] || fail 'model cannot contain whitespace'
[[ "$CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || fail 'container-name contains unsupported characters'
validate_port "$PORT"
validate_positive_int "$TP_SIZE"
validate_positive_int "$MAX_MODEL_LEN"
validate_positive_int "$MAX_NUM_BATCHED_TOKENS"
validate_positive_int "$MAX_NUM_SEQS"
validate_positive_int "$STARTUP_TIMEOUT"
validate_decimal "$GPU_MEMORY_UTILIZATION"
[[ "$ENFORCE_EAGER" == 0 || "$ENFORCE_EAGER" == 1 ]] || fail 'enforce-eager must be 0 or 1'

if [[ -z "$MODEL_CACHE_DIR" ]]; then
  MODEL_CACHE_DIR="$STATE_DIR/huggingface"
fi
if [[ -z "$COMPILE_CACHE_DIR" ]]; then
  COMPILE_CACHE_DIR="$STATE_DIR/compile-cache"
fi
ENV_FILE="$STATE_DIR/$CONTAINER_NAME.env"
KEY_DIR="$STATE_DIR/secrets"
KEY_FILE="$KEY_DIR/api-key"
ENTRYPOINT_FILE="$STATE_DIR/vllm-entrypoint.sh"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BACKUP_DIR="$STATE_DIR/backups/$STAMP"
OLD_CONTAINER_NAME=""

if [[ -n "$API_KEY_INPUT_FILE" ]]; then
  [[ -z "$API_KEY" ]] || fail 'use either --api-key or --api-key-file, not both'
  API_KEY="$(read_key_file "$API_KEY_INPUT_FILE")"
fi
if [[ -z "$API_KEY" && "$ROTATE_KEY" -eq 0 && -f "$KEY_FILE" ]]; then
  API_KEY="$(read_key_file "$KEY_FILE")"
fi
if [[ -z "$API_KEY" ]]; then
  API_KEY="$(generate_api_key)"
fi
validate_single_line "$API_KEY" API-key
[[ "$API_KEY" != *[[:space:]]* ]] || fail 'API key cannot contain whitespace'
[[ ${#API_KEY} -ge 8 ]] || fail 'API key must be at least 8 characters'

if [[ "$DRY_RUN" -eq 1 ]]; then
  cat <<EOF
planned vLLM deployment
  model:       $MODEL
  image:       $IMAGE
  container:   $CONTAINER_NAME
  bind:        $HOST:$PORT (Docker host network)
  tensor-par:  $TP_SIZE
  context:     $MAX_MODEL_LEN
  state-dir:   $STATE_DIR
  key-file:    $KEY_FILE
  key-preview: $(mask_secret "$API_KEY")
  replace:     $REPLACE
EOF
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail 'docker is required; install Docker Engine before running this script'
command -v curl >/dev/null 2>&1 || fail 'curl is required for readiness checks'

if container_exists && [[ "$REPLACE" -eq 0 ]]; then
  fail "container $CONTAINER_NAME already exists; pass --replace to preserve and replace it"
fi

mkdir -p "$STATE_DIR" "$KEY_DIR" "$MODEL_CACHE_DIR" "$COMPILE_CACHE_DIR" "$BACKUP_DIR"
chmod 700 "$STATE_DIR" "$KEY_DIR" "$BACKUP_DIR"
if container_exists && [[ -f "$KEY_FILE" ]]; then
  cp "$KEY_FILE" "$BACKUP_DIR/old-api-key"
  chmod 600 "$BACKUP_DIR/old-api-key"
fi
write_private_file "$KEY_FILE" 600 "$API_KEY"
write_env_file "$ENV_FILE"
write_entrypoint "$ENTRYPOINT_FILE"

if [[ "$SKIP_PULL" -eq 0 ]]; then
  log "拉取镜像 $IMAGE …"
  docker pull "$IMAGE"
fi

if container_exists; then
  [[ "$REPLACE" -eq 1 ]] || fail "container $CONTAINER_NAME already exists; pass --replace to preserve and replace it"
  backup_existing_container "$BACKUP_DIR"
fi

log "启动 vLLM：$MODEL @ $HOST:$PORT …"
if ! run_container > "$BACKUP_DIR/new-container.id"; then
  log '新容器创建失败，尝试回滚旧容器 …'
  restore_old_container "$BACKUP_DIR"
  exit 1
fi

if ! wait_for_ready; then
  docker logs --tail 500 "$CONTAINER_NAME" > "$BACKUP_DIR/new-container.log" 2>&1 || true
  log "vLLM 在 ${STARTUP_TIMEOUT}s 内未就绪，尝试回滚旧容器；日志：$BACKUP_DIR/new-container.log"
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  restore_old_container "$BACKUP_DIR"
  exit 1
fi

if ! verify_auth; then
  docker logs --tail 500 "$CONTAINER_NAME" > "$BACKUP_DIR/new-container.log" 2>&1 || true
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  restore_old_container "$BACKUP_DIR"
  exit 1
fi

print_model_ids
log ''
log 'vLLM 部署完成。'
log "  Bind:       $HOST:$PORT"
log "  Local URL:  http://127.0.0.1:$PORT/v1"
log "  Model:      $MODEL"
log "  Container:  $CONTAINER_NAME"
log "  API key:    $(mask_secret "$API_KEY")（完整值保存在 ${KEY_FILE}，权限 0600）"
log "  Env file:   $ENV_FILE"
log "  Backup:     $BACKUP_DIR"
log ''
log '测试（在服务器上执行，命令不会把 key 写入 shell 历史）：'
log "  curl -sS http://127.0.0.1:$PORT/v1/models -H \"Authorization: Bearer \$(cat '$KEY_FILE')\""
