#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-Financial Tracking.xcodeproj}"
SCHEME="${SCHEME:-Financial Tracking_macOS}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA="${DERIVED_DATA:-$PWD/DerivedData}"

if ! xcode-select -p >/dev/null 2>&1 || [[ "$(xcode-select -p)" == "/Library/Developer/CommandLineTools" ]]; then
  echo "A full Xcode installation must be selected with xcode-select before building the app." >&2
  exit 2
fi

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_DATA" \
  build