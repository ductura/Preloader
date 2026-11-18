#!/usr/bin/env bash
# Usage: bash scripts/playwright-install.sh <browser>...
# DAN-1097: installs Playwright browsers with their system packages
# (--with-deps) without waiting on a slow apt mirror until the job timeout.
# In run 44244472136 the runner's mirror us-east-2.ec2.archive.ubuntu.com
# served the 125 MB of packages at ~100 kB/s and the job was cancelled at 20 min.
# - Every attempt is capped by PLAYWRIGHT_INSTALL_TIMEOUT and the whole script
#   by PLAYWRIGHT_INSTALL_BUDGET (whole seconds); no attempt of the 3 gets more
#   than what is left of the budget. When it is spent: ::error:: and exit 1.
# - After a failed attempt the leftover apt is stopped and the Ubuntu archive
#   URLs in the apt sources move to the next fallback mirror (security.ubuntu.com
#   and other repositories stay as they are).
# - PLAYWRIGHT_APT_CACHE_DIR (a leading ~/ means $HOME) holds the .deb files
#   between runs: copied into the apt archive before the install, replaced by
#   what apt kept (after autoclean) after a success. A speed-up only.
# PLAYWRIGHT_APT_ROOT and PLAYWRIGHT_APT_ARCHIVES are for the tests only.
# Pattern: Ductus scripts/engineering/playwright-install.sh (DAN-663, DAN-705).
set -u

if [ "$#" -eq 0 ]; then
  echo "::error::usage: bash scripts/playwright-install.sh <browser>..."
  exit 1
fi
browsers="$*"
budget="${PLAYWRIGHT_INSTALL_BUDGET-660}"
limit="${PLAYWRIGHT_INSTALL_TIMEOUT-240}"
attempts=3
for value in "$budget" "$limit"; do
  case "$value" in
    [1-9] | [1-9][0-9] | [1-9][0-9][0-9] | [1-9][0-9][0-9][0-9] | [1-9][0-9][0-9][0-9][0-9]) ;;
    *)
      echo "::error::PLAYWRIGHT_INSTALL_BUDGET and PLAYWRIGHT_INSTALL_TIMEOUT must be whole seconds from 1 to 99999 without a leading zero"
      exit 1
      ;;
  esac
done
# Checked by use, not by name: GNU coreutils (ubuntu-24.04) and uutils
# (ubuntu-26.04, where the reusable node job runs the tests) both take it.
if ! timeout --kill-after=1 5 true >/dev/null 2>&1; then
  echo "::error::Playwright browsers (${browsers}) were not installed: no timeout command with --kill-after"
  exit 1
fi
cap() { timeout --kill-after=10 "$@"; }
start=$(date +%s)
# PLAYWRIGHT_INSTALL_DEADLINE (optional, Unix seconds) is the job's own end. The
# budget shrinks so that the last cap, --kill-after (10 s) and 5 s more end
# before it: the ::error:: comes before the job is cancelled.
deadline="${PLAYWRIGHT_INSTALL_DEADLINE-}"
if [ -n "$deadline" ]; then
  case "$deadline" in
    [1-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9] | [1-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *)
      echo "::error::PLAYWRIGHT_INSTALL_DEADLINE must be a Unix time in whole seconds"
      exit 1
      ;;
  esac
  room=$((deadline - start - 15))
  [ "$room" -lt "$budget" ] && budget=$room
  if [ "$budget" -le 0 ]; then
    echo "::error::Playwright browsers (${browsers}) were not installed: the job deadline leaves no time"
    exit 1
  fi
fi
# window <seconds>: the smaller of the given time and what is left of the budget.
window() {
  local left=$((budget - ($(date +%s) - start)))
  if [ "$left" -lt "$1" ]; then echo "$left"; else echo "$1"; fi
}

archives="${PLAYWRIGHT_APT_ARCHIVES:-/var/cache/apt/archives}"
apt_cache="${PLAYWRIGHT_APT_CACHE_DIR:-}"
case "$apt_cache" in \~/*) apt_cache="${HOME}/${apt_cache#\~/}" ;; esac

restore_apt_cache() {
  [ -n "$apt_cache" ] && compgen -G "${apt_cache}/*.deb" >/dev/null || return 0
  local t
  t=$(window 60)
  { [ "$t" -gt 0 ] && cap "$t" sudo cp "$apt_cache"/*.deb "$archives"/; } \
    || echo "::warning::could not restore the apt package cache from ${apt_cache}"
}

# Copies into a fresh directory first, so a cut-off copy never replaces the cache.
save_apt_cache() {
  [ -n "$apt_cache" ] || return 0
  local t part=""
  t=$(window 60)
  [ "$t" -gt 0 ] && cap "$t" sudo apt-get autoclean >/dev/null
  # Nothing kept means nothing current: stale copies must not be saved again.
  if ! compgen -G "${archives}/*.deb" >/dev/null; then
    rm -f "$apt_cache"/*.deb
    echo "::notice::apt left no .deb files in ${archives}; the apt package cache is emptied"
    return 0
  fi
  t=$(window 60)
  if [ "$t" -gt 0 ] && mkdir -p "$apt_cache" && part=$(mktemp -d "${apt_cache}/.part.XXXXXX") \
    && cap "$t" cp "$archives"/*.deb "$part"/ && rm -f "$apt_cache"/*.deb && mv -f "$part"/*.deb "$apt_cache"/; then
    rm -rf "$part"
    return 0
  fi
  [ -n "$part" ] && rm -rf "$part"
  echo "::warning::could not save the apt package cache to ${apt_cache}"
}

# use_mirror <host>: points every Ubuntu archive URL (http[s]://host/ubuntu[/]
# at the line start or after a space, and followed by a space or the line end)
# at <host>. URLs of security.ubuntu.com (any case, any port), also on a line
# with an archive URL, and mirror+http lists stay as they are.
fallbacks=(archive.ubuntu.com mirrors.edge.kernel.org)
use_mirror() {
  local f t etc="${PLAYWRIGHT_APT_ROOT:-}/etc/apt" files=()
  for f in "$etc/apt-mirrors.txt" "$etc/sources.list.d/ubuntu.sources" "$etc/sources.list"; do
    [ -f "$f" ] && files+=("$f")
  done
  [ "${#files[@]}" -gt 0 ] || return 0
  # perl for the lookahead: the space after one URL may start the next one.
  local edit="s{(^|\s)(https?://)(?!(?i:security\.ubuntu\.com)[:/])[^/\s]+/ubuntu(/?)(?=\s|\$)}{\$1\$2$1/ubuntu\$3}g"
  t=$(window 20)
  if [ "$t" -gt 0 ] && cap "$t" sudo perl -i -pe "$edit" "${files[@]}"; then
    echo "::warning::the apt sources now use $1 for the Ubuntu archive"
  else
    echo "::warning::the apt sources could not be switched to $1"
  fi
}

restore_apt_cache
tried=0
status=0
for attempt in $(seq 1 "$attempts"); do
  t=$(window "$limit")
  [ "$t" -gt 0 ] || break
  tried=$attempt
  cap "$t" pnpm exec playwright install --with-deps "$@"
  status=$?
  if [ "$status" -eq 0 ]; then
    save_apt_cache
    exit 0
  fi
  case "$status" in 124 | 137) what="timed out after ${t}s" ;; *) what="failed (exit ${status})" ;; esac
  echo "::warning::playwright install attempt ${attempt}/${attempts} ${what}"
  [ "$attempt" -lt "$attempts" ] || break
  # Leave no apt behind: sudo may not pass the kill on to apt-get.
  t=$(window 20); [ "$t" -gt 0 ] && cap "$t" sudo pkill -x apt-get
  t=$(window 20); [ "$t" -gt 0 ] && cap "$t" sudo pkill -f '[/]usr/lib/apt/methods'
  t=$(window 60); [ "$t" -gt 0 ] && cap "$t" sudo dpkg --configure -a
  use_mirror "${fallbacks[$((attempt - 1))]}"
done

echo "::error::Playwright browsers (${browsers}) could not be installed within ${budget}s (${tried} of ${attempts} attempts, last exit ${status}); see the warnings above. The apt mirrors may be slow: re-run the job."
exit 1
