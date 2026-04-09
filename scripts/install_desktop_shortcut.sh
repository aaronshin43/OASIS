#!/usr/bin/env bash
# install_desktop_shortcut.sh
# Creates an OASIS launcher on the Pi desktop.
# Run once: bash scripts/install_desktop_shortcut.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$HOME/Desktop"
SHORTCUT="$DESKTOP_DIR/OASIS.desktop"

mkdir -p "$DESKTOP_DIR"

cat > "$SHORTCUT" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=OASIS
Comment=Offline AI Survival & First-Aid Kit System
Exec=bash $REPO_DIR/run_oasis_gui.sh
Icon=$REPO_DIR/assets/oasis_icon.svg
Terminal=false
Categories=Utility;
StartupNotify=false
EOF

chmod +x "$SHORTCUT"

# Wayland/LXDE needs the gio trust flag to show the icon without "Execute?" prompt
if command -v gio &>/dev/null; then
    gio set "$SHORTCUT" metadata::trusted true 2>/dev/null || true
fi

echo "Done. Shortcut: $SHORTCUT"
echo "Repo path: $REPO_DIR"
