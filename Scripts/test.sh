#!/usr/bin/env bash
set -euo pipefail

if ! xcode-select -p >/dev/null 2>&1 || [[ "$(xcode-select -p)" == "/Library/Developer/CommandLineTools" ]]; then
  echo "A full Xcode installation must be selected with xcode-select before running app tests." >&2
  exit 2
fi

xcodebuild \
  -project "${PROJECT:-Financial Tracking.xcodeproj}" \
  -scheme "${SCHEME:-Financial TrackingTests_macOS}" \
  -destination 'platform=macOS' \
  test