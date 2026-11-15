#!/bin/zsh
set -eu
cd "${0:A:h}"
source bin/launcher-log.zsh
launch_stage=launcher_started
studio_log info "$launch_stage"
trap 'setup_status=$?; studio_log error "$launch_stage" "$setup_status"; printf "\nSetup stopped. Logs are in %s\n" "$(studio_log_directory)"; if [[ -t 0 ]]; then printf "Press Return to close.\n"; read -r; fi; exit "$setup_status"' ZERR

# Finder's default PATH can omit tools installed via Homebrew.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
runtime="$HOME/Library/Application Support/Story Studio Runtime"
version=v24.22.3

if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 20 ? 1 : 0)'; then
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64)
      if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then arch=arm64; else arch=x64; fi
      ;;
    *) studio_log error unsupported_architecture 1; printf 'Unsupported Mac architecture.\n'; exit 1 ;;
  esac
  package="node-${version}-darwin-${arch}"
  if [[ ! -x "$runtime/$package/bin/node" ]]; then
    launch_stage=node_download
    studio_log info "$launch_stage"
    printf 'Downloading Node.js from nodejs.org…\n'
    mkdir -p "$runtime"
    staging="$(mktemp -d)"
    trap 'rm -rf "$staging"' EXIT
    (
      cd "$staging"
      curl --proto '=https' -fsSLO "https://nodejs.org/dist/$version/$package.tar.gz"
      curl --proto '=https' -fsSLO "https://nodejs.org/dist/$version/SHASUMS256.txt"
      awk -v archive="$package.tar.gz" '$2 == archive {print}' SHASUMS256.txt > checksum
      [[ -s checksum ]]
      shasum -a 256 -c checksum
      tar -xzf "$package.tar.gz" -C "$runtime"
    )
  fi
  export PATH="$runtime/$package/bin:$PATH"
fi

if [[ ! -d node_modules/@modelcontextprotocol/sdk ]] || ! cmp -s package-lock.json node_modules/.story-studio-lock; then
  launch_stage=dependencies_install
  studio_log info "$launch_stage"
  printf 'Installing Story Studio dependencies…\n'
  npm ci --no-audit --no-fund
  cp package-lock.json node_modules/.story-studio-lock
fi

url="http://127.0.0.1:${PORT:-4317}"
launch_stage=server_start
studio_log info "$launch_stage"
node server.mjs &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; if [[ -n "${staging:-}" ]]; then rm -rf "$staging"; fi' EXIT
trap 'exit 0' INT TERM
for attempt in {1..50}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then wait "$server_pid"; fi
  if curl -fsS "$url/api/state" >/dev/null 2>&1; then
    studio_log info server_ready
    launch_stage=browser_open
    open "$url/"
    printf 'Diagnostic logs: %s\n' "$(studio_log_directory)"
    printf 'Leave this window open while writing. Press Control-C to stop Story Studio.\n'
    launch_stage=server_exit
    wait "$server_pid"
    exit 0
  fi
  sleep 0.2
done
studio_log error server_readiness_timeout 1
printf 'Story Studio did not start at %s\n' "$url"
exit 1
