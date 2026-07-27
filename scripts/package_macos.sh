#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
release_dir="$project_dir/release/v0.7.2/macos-arm64"
app_dir="$release_dir/新T树洞.app"
contents="$app_dir/Contents"
cd "$project_dir"
cargo build --workspace --release
mkdir -p "$contents/MacOS" "$contents/Resources"
cp "$project_dir/target/release/newt-desktop" "$contents/MacOS/newt-desktop"
sips -s format icns "$project_dir/src-tauri/icons/icon.png" --out "$contents/Resources/AppIcon.icns" >/dev/null
cp "$project_dir/scripts/Info.plist" "$contents/Info.plist"
codesign --force --deep --sign - "$app_dir"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$release_dir/新T树洞-0.7.2-macos-arm64.zip"
echo "$app_dir"
