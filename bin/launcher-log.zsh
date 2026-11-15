# Launcher diagnostics must work before Node.js is installed. Pass only fixed
# stage names and exit codes. Command output can contain private information.
studio_log_directory() {
  if [[ -n "${STORY_STUDIO_LOG_DIR:-}" ]]; then
    printf '%s\n' "$STORY_STUDIO_LOG_DIR"
  elif [[ -n "${STORY_STUDIO_DATA:-}" ]]; then
    printf '%s\n' "$STORY_STUDIO_DATA/logs"
  else
    printf '%s\n' "$HOME/Library/Logs/Story Studio"
  fi
}

studio_log() {
  local log_directory file
  log_directory="$(studio_log_directory)"
  file="$log_directory/setup.log"
  (
    umask 077
    mkdir -p "$log_directory" || exit 1
    if [[ -f "$file" ]] && (( $(wc -c < "$file") >= 1048576 )); then
      mv -f "$file" "$file.1"
    fi
    printf '{"time":"%s","level":"%s","component":"launcher","event":"%s","pid":%d,"exitCode":%d}\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" "$2" "$$" "${3:-0}" >> "$file"
  ) 2>/dev/null || printf 'Story Studio could not write its setup diagnostic log.\n' >&2
}
