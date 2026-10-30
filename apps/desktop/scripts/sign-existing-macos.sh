#!/bin/bash
set -euo pipefail
app="$PWD/candidate/Terminus.app"
scratch=$(mktemp -d)
keychain="$scratch/signing.keychain-db"
mount="$scratch/mount"
mounted=0
cleanup() {
  if [ "$mounted" = 1 ]; then hdiutil detach "$mount" >/dev/null || true; fi
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT
if [ "${1:-}" = inspect ]; then
  python3 apps/desktop/scripts/candidate-native-macos.py
  mkdir "$mount"
  hdiutil attach candidate/template.dmg -readonly -nobrowse -mountpoint "$mount" >/dev/null
  mounted=1
  node apps/desktop/scripts/candidate-signing.mjs dmg "$mount"
  exit 0
fi
for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_P8; do
  test -n "${!name:-}" || { echo "Missing $name" >&2; exit 1; }
done
codesign --verify --deep --strict --verbose=2 "$app"
info=$(codesign -dv --verbose=4 "$app" 2>&1)
echo "$info" | grep -q 'Developer ID Application: Software y Servicios Danil'
echo "$info" | grep -q 'TeamIdentifier=ATG57AXYTS'
echo "$info" | grep -q 'flags=.*runtime'
umask 077
printf '%s' "$APPLE_API_KEY_P8" | tr -d '\r' > "$scratch/key.p8"
ditto -c -k --keepParent "$app" "$scratch/app.zip"
xcrun notarytool submit "$scratch/app.zip" --key "$scratch/key.p8" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait --output-format json > "$scratch/app-result.json"
node -e 'const r=require(process.argv[1]);if(r.status!=="Accepted")process.exit(1)' "$scratch/app-result.json"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
password=$(openssl rand -hex 24)
security create-keychain -p "$password" "$keychain"
security unlock-keychain -p "$password" "$keychain"
printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$scratch/certificate.p12"
security import "$scratch/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
rm "$scratch/certificate.p12"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
hdiutil convert candidate/template.dmg -format UDRW -o "$scratch/editable.dmg" >/dev/null
mkdir "$mount"
hdiutil attach "$scratch/editable.dmg" -nobrowse -mountpoint "$mount" >/dev/null
mounted=1
test -d "$mount/Terminus.app"
rm -rf "$mount/Terminus.app"
ditto "$app" "$mount/Terminus.app"
node apps/desktop/scripts/candidate-signing.mjs dmg-final "$mount"
hdiutil detach "$mount" >/dev/null
mounted=0
mkdir -p output
hdiutil convert "$scratch/editable.dmg" -format UDZO -o output/Terminus-macOS.dmg >/dev/null
codesign --force --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY" output/Terminus-macOS.dmg
codesign --verify --verbose=2 output/Terminus-macOS.dmg
xcrun notarytool submit output/Terminus-macOS.dmg --key "$scratch/key.p8" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait --output-format json > "$scratch/dmg-result.json"
node -e 'const r=require(process.argv[1]);if(r.status!=="Accepted")process.exit(1)' "$scratch/dmg-result.json"
xcrun stapler staple output/Terminus-macOS.dmg
xcrun stapler validate output/Terminus-macOS.dmg
hdiutil attach output/Terminus-macOS.dmg -readonly -nobrowse -mountpoint "$mount" >/dev/null
mounted=1
node apps/desktop/scripts/candidate-signing.mjs dmg-final "$mount"
xcrun stapler validate "$mount/Terminus.app"
hdiutil detach "$mount" >/dev/null
mounted=0
spctl --assess --type execute --verbose=2 "$app"
tar -czf output/Terminus.app.tar.gz -C candidate Terminus.app
cp "$scratch/app-result.json" output/notary-app.json
cp "$scratch/dmg-result.json" output/notary-dmg.json
shasum -a 256 output/Terminus-macOS.dmg output/Terminus.app.tar.gz > output/macos-signing-hashes.txt
