#!/bin/zsh
set -eu
cd "${0:A:h}"
trap 'printf "\nSetup stopped. Review the message above, then press Return.\n"; read -r' ZERR

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
    *) printf 'Unsupported Mac architecture.\n'; exit 1 ;;
  esac
  package="node-${version}-darwin-${arch}"
  if [[ ! -x "$runtime/$package/bin/node" ]]; then
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
  printf 'Installing Story Studio dependencies…\n'
  npm ci --no-audit --no-fund
  cp package-lock.json node_modules/.story-studio-lock
fi

url="http://127.0.0.1:${PORT:-4317}"
node server.mjs &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; if [[ -n "${staging:-}" ]]; then rm -rf "$staging"; fi' EXIT
trap 'exit 0' INT TERM
for attempt in {1..50}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then wait "$server_pid"; fi
  if curl -fsS "$url/api/state" >/dev/null 2>&1; then
    open "$url/"
    printf 'Leave this window open while writing. Press Control-C to stop Story Studio.\n'
    wait "$server_pid"
    exit 0
  fi
  sleep 0.2
done
printf 'Story Studio did not start at %s\n' "$url"
exit 1
