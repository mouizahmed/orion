#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$repo_root/.runtime-logs"
state_path="$runtime_dir/local-dev-processes.tsv"
stripe_events=(
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  customer.subscription.paused
  customer.subscription.resumed
)
stripe_event_args=()
for stripe_event in "${stripe_events[@]}"; do
  stripe_event_args+=(--events "$stripe_event")
done
stripe_env=()

usage() {
  printf 'Usage: %s {start|status|stop}\n' "${0##*/}"
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

service_running() {
  local pid="$1"
  local pattern="$2"

  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -F -- "$pattern" >/dev/null 2>&1
}

load_state() {
  [[ -f "$state_path" ]] || return 0

  while IFS=$'\t' read -r service pid pattern stdout_path stderr_path; do
    [[ -n "${service:-}" ]] || continue
    printf '%s\t%s\t%s\t%s\t%s\n' "$service" "$pid" "$pattern" "$stdout_path" "$stderr_path"
  done < "$state_path"
}

write_state() {
  mkdir -p "$runtime_dir"
  local tmp_path="$state_path.tmp.$$"
  : > "$tmp_path"
  for service in "$@"; do
    printf '%s\n' "$service" >> "$tmp_path"
  done
  mv "$tmp_path" "$state_path"
}

remove_state() {
  rm -f "$state_path"
}

process_children() {
  local parent_pid="$1"
  local child_pid

  while read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    process_children "$child_pid"
    kill "$child_pid" 2>/dev/null || true
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

stop_pid() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    process_children "$pid"
    kill "$pid" 2>/dev/null || true
  fi
}

stop_state_services() {
  [[ -f "$state_path" ]] || return 0

  local -a services=()
  local service pid pattern stdout_path stderr_path
  while IFS=$'\t' read -r service pid pattern stdout_path stderr_path; do
    [[ -n "${service:-}" ]] || continue
    services+=("${service}"$'\t'"${pid}"$'\t'"${pattern}"$'\t'"${stdout_path}"$'\t'"${stderr_path}")
  done < "$state_path"

  local index record
  for ((index=${#services[@]} - 1; index >= 0; index--)); do
    IFS=$'\t' read -r service pid pattern stdout_path stderr_path <<< "${services[index]}"
    if kill -0 "$pid" 2>/dev/null; then
      printf 'Stopping %s (PID %s)...\n' "$service" "$pid"
      stop_pid "$pid"
    fi
  done
  remove_state
}

show_status() {
  if [[ ! -f "$state_path" ]]; then
    printf 'Orion local development is not managed by this script.\n'
    return 0
  fi

  printf '%-10s %-10s %-8s %s\n' 'SERVICE' 'STATUS' 'PID' 'LOG'
  local service pid pattern stdout_path stderr_path status
  while IFS=$'\t' read -r service pid pattern stdout_path stderr_path; do
    [[ -n "${service:-}" ]] || continue
    if service_running "$pid" "$pattern"; then
      status=running
    else
      status=stopped
    fi
    printf '%-10s %-10s %-8s %s\n' "$service" "$status" "$pid" "$stdout_path"
  done < "$state_path"
}

port_is_free() {
  local port="$1"
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
}

assert_port_free() {
  local port="$1"
  port_is_free "$port" || die "Port $port is already in use. Stop the existing process first."
}

wait_for_http() {
  local url="$1"
  local pid="$2"
  local timeout_seconds="$3"
  local deadline=$((SECONDS + timeout_seconds))

  while ((SECONDS < deadline)); do
    kill -0 "$pid" 2>/dev/null || return 1
    if curl --silent --show-error --max-time 2 --output /dev/null --write-out '%{http_code}' "$url" | grep -Eq '^[2345][0-9][0-9]$'; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_managed_process() {
  local name="$1"
  local working_directory="$2"
  local pattern="$3"
  shift 3

  local stdout_path="$runtime_dir/$name.out.log"
  local stderr_path="$runtime_dir/$name.err.log"
  (
    cd "$working_directory"
    exec nohup "$@" >"$stdout_path" 2>"$stderr_path"
  ) < /dev/null &
  local pid=$!
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$pid" "$pattern" "$stdout_path" "$stderr_path"
}

set_webhook_secret() {
  local secret="$1"
  local env_path="$repo_root/backend/cmd/api/.env.billing"
  local tmp_path="$env_path.tmp.$$"

  if [[ -f "$env_path" ]]; then
    awk -v secret="$secret" '
      BEGIN { found = 0 }
      /^STRIPE_WEBHOOK_SECRET=/ { print "STRIPE_WEBHOOK_SECRET=" secret; found = 1; next }
      { print }
      END { if (!found) print "STRIPE_WEBHOOK_SECRET=" secret }
    ' "$env_path" > "$tmp_path"
  else
    printf 'STRIPE_WEBHOOK_SECRET=%s\n' "$secret" > "$tmp_path"
  fi
  mv "$tmp_path" "$env_path"
}

stripe_authenticated() {
  local response
  response="$(env "$@" stripe whoami --format json 2>/dev/null)" || return 1
  ! grep -Eq '"authenticated"[[:space:]]*:[[:space:]]*false' <<< "$response"
}

get_stripe_secret() {
  local probe_dir probe_log stripe_pid secret line
  probe_dir="$(mktemp -d "$runtime_dir/stripe-probe.XXXXXX")"
  probe_log="$probe_dir/listen.log"

  if (( ${#stripe_env[@]} > 0 )); then
    env "${stripe_env[@]}" stripe listen --skip-update --print-secret \
      "${stripe_event_args[@]}" \
      >"$probe_log" 2>&1 &
  else
    stripe listen --skip-update --print-secret \
      "${stripe_event_args[@]}" \
      >"$probe_log" 2>&1 &
  fi
  stripe_pid=$!

  secret=''
  local deadline=$((SECONDS + 30))
  while ((SECONDS < deadline)); do
    if [[ -f "$probe_log" ]]; then
      secret="$(grep -Eo 'whsec_[A-Za-z0-9]+' "$probe_log" | head -n 1 || true)"
      [[ -n "$secret" ]] && break
    fi
    if ! kill -0 "$stripe_pid" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done

  if kill -0 "$stripe_pid" 2>/dev/null; then
    stop_pid "$stripe_pid"
  fi

  if [[ -z "$secret" ]]; then
    rm -rf "$probe_dir"
    die "Stripe CLI did not return a development webhook signing secret. Run 'stripe login' and try again."
  fi

  set_webhook_secret "$secret"
  rm -rf "$probe_dir"
}

start_local_dev() {
  if [[ -f "$state_path" ]]; then
    local running_count=0
    local service pid pattern stdout_path stderr_path
    while IFS=$'\t' read -r service pid pattern stdout_path stderr_path; do
      [[ -n "${service:-}" ]] || continue
      if service_running "$pid" "$pattern"; then
        running_count=$((running_count + 1))
      fi
    done < "$state_path"
    if ((running_count > 0)); then
      show_status
      die "Local development is already running. Use '$0 stop' first."
    fi
    remove_state
  fi

  require_command go
  require_command node
  require_command npm
  require_command stripe
  require_command ffmpeg
  require_command curl
  require_command lsof
  require_command pgrep

  local required_path
  for required_path in \
    "$repo_root/backend/cmd/api/.env" \
    "$repo_root/backend/cmd/api/.env.billing" \
    "$repo_root/desktop/.env.local" \
    "$repo_root/desktop/node_modules" \
    "$repo_root/web/node_modules"; do
    [[ -e "$required_path" ]] || die "Missing required local path: ${required_path#$repo_root/}"
  done

  for required_port in 8080 3000 5173; do
    assert_port_free "$required_port"
  done

  local stripe_api_key
  stripe_api_key="$(sed -n 's/^STRIPE_API_KEY=//p' "$repo_root/backend/cmd/api/.env.billing" | head -n 1 | tr -d '\r')"
  if ! stripe_authenticated; then
    if [[ -n "$stripe_api_key" ]] && stripe_authenticated STRIPE_API_KEY="$stripe_api_key"; then
      stripe_env=("STRIPE_API_KEY=$stripe_api_key")
    else
      die "Stripe CLI is not authenticated. Run 'stripe login' or configure STRIPE_API_KEY in backend/cmd/api/.env.billing and try again."
    fi
  fi
  mkdir -p "$runtime_dir"
  get_stripe_secret

  local -a services=()
  local record name pid pattern stdout_path stderr_path
  cleanup_on_error() {
    local cleanup_record
    for ((index=${#services[@]} - 1; index >= 0; index--)); do
      IFS=$'\t' read -r name pid pattern stdout_path stderr_path <<< "${services[index]}"
      stop_pid "$pid"
    done
    remove_state
  }
  trap cleanup_on_error ERR

  record="$(start_managed_process backend "$repo_root/backend" 'go run ./cmd/api/main.go' env API_HOST=127.0.0.1 go run ./cmd/api/main.go)"
  services+=("$record")
  write_state "${services[@]}"
  IFS=$'\t' read -r name pid pattern stdout_path stderr_path <<< "$record"
  wait_for_http http://127.0.0.1:8080/api/health "$pid" 45 || die "Backend did not become healthy. See $stderr_path and $stdout_path."

  record="$(start_managed_process web "$repo_root/web" 'npm run dev' npm run dev)"
  services+=("$record")
  write_state "${services[@]}"
  IFS=$'\t' read -r name pid pattern stdout_path stderr_path <<< "$record"
  wait_for_http http://127.0.0.1:3000 "$pid" 45 || die "Web app did not become ready. See $stderr_path and $stdout_path."

  record="$(start_managed_process desktop "$repo_root/desktop" 'npm run dev' npm run dev)"
  services+=("$record")
  write_state "${services[@]}"
  IFS=$'\t' read -r name pid pattern stdout_path stderr_path <<< "$record"
  wait_for_http http://localhost:5173 "$pid" 45 || die "Desktop renderer did not become ready. See $stderr_path and $stdout_path."

  if (( ${#stripe_env[@]} > 0 )); then
    record="$(start_managed_process stripe "$repo_root" 'stripe listen' env "${stripe_env[@]}" stripe listen --skip-update --forward-to http://127.0.0.1:8080/webhooks/stripe "${stripe_event_args[@]}")"
  else
    record="$(start_managed_process stripe "$repo_root" 'stripe listen' stripe listen --skip-update --forward-to http://127.0.0.1:8080/webhooks/stripe "${stripe_event_args[@]}")"
  fi
  services+=("$record")
  write_state "${services[@]}"
  IFS=$'\t' read -r name pid pattern stdout_path stderr_path <<< "$record"
  sleep 2
  kill -0 "$pid" 2>/dev/null || die "Stripe listener exited during startup. See $stderr_path and $stdout_path."

  trap - ERR
  printf 'Orion local development is ready.\n'
  printf '  API:     http://127.0.0.1:8080/api/health\n'
  printf '  Web:     http://localhost:3000\n'
  printf '  Desktop: http://localhost:5173 (Electron launched)\n'
  printf '  Logs:    %s\n' "$runtime_dir"
  printf "Run '%s status' or '%s stop'.\n" "$0" "$0"
}

case "${1:-start}" in
  start)
    start_local_dev
    ;;
  status)
    show_status
    ;;
  stop)
    stop_state_services
    printf 'Orion local development stopped.\n'
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
