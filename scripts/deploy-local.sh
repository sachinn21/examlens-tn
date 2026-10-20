#!/usr/bin/env bash
# Refresh the dataset and publish it to Netlify.
#
# Run by launchd (see deploy/in.examlens.refresh.plist) because the Tamil Nadu
# board endpoints are not reachable from GitHub's hosted runners. It can also be
# run by hand at any time.
set -u

PROJECT="/Users/sachin/Development/rust site/examlens"
SITE_ID="6d48c4a4-9c68-47f0-bce3-836bf7820493"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SITE_URL="https://examlens-tn.netlify.app"
export ASTRO_TELEMETRY_DISABLED=1

LOG_DIR="$HOME/Library/Logs"
mkdir -p "$LOG_DIR" "$HOME/.config/examlens"
LOG="$LOG_DIR/examlens-refresh.log"

cd "$PROJECT" || exit 1
{
  echo "=== refresh $(date -u +%FT%TZ)"
  pnpm refresh || echo "REFRESH_FAILED"
  pnpm validate || echo "VALIDATE_FAILED"
  pnpm build || exit 1
  npx --yes netlify-cli@latest deploy --prod --dir=dist \
    --site "$SITE_ID" \
    --auth "$(cat "$HOME/.config/examlens/netlify-token")" \
    --message "scheduled refresh $(date -u +%FT%TZ)"
  # Keep the repository in step with the deployed data.
  if ! git diff --quiet -- data/; then
    git add data/
    git commit -m "data: refresh $(date -u +%FT%TZ)" || true
    git pull --rebase -q origin main || true
    git push -q || true
  fi
  echo "=== done $(date -u +%FT%TZ)"
} >> "$LOG" 2>&1
