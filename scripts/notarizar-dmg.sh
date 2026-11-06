#!/bin/zsh
# Assina, notariza e grampeia o DMG gerado pelo electron-builder (que só notariza o .app).
# Uso: scripts/notarizar-dmg.sh   (lê a versão do package.json)
set -euo pipefail
here=${0:A:h}
version=$(node -p "require('$here/../package.json').version")
dmg="$HOME/Library/Developer/Aerolince/release/Aerolince-$version-arm64.dmg"
codesign --force --timestamp --sign "Developer ID Application: SALOMAO Filho (RW5PXM3VUN)" "$dmg"
xcrun notarytool submit "$dmg" --keychain-profile "${APPLE_KEYCHAIN_PROFILE:-notary}" --wait
xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose "$dmg"
shasum -a 256 "$dmg" | sed 's#  .*/#  #' > "$dmg.sha256"
echo "pronto: $dmg"
