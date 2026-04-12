#!/usr/bin/env bash
# install_classify_service.sh
# Registers oasis-classify as a systemd service so it survives reboots.
# Run once as the normal user (NOT root): bash scripts/install_classify_service.sh
#
# After install:
#   sudo systemctl start  oasis-classify   # start now
#   sudo systemctl status oasis-classify   # check status
#   journalctl -u oasis-classify -f        # live logs
#   sudo systemctl disable oasis-classify  # uninstall autostart
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="oasis-classify"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Detect Python: prefer venv python, fall back to python3
if [ -f "$REPO_DIR/venv/bin/python3" ]; then
    PYTHON="$REPO_DIR/venv/bin/python3"
elif [ -f "$REPO_DIR/venv/bin/python" ]; then
    PYTHON="$REPO_DIR/venv/bin/python"
else
    PYTHON="$(command -v python3)"
    echo "WARNING: No venv found — using system python3: $PYTHON"
    echo "  Packages (flask, sentence_transformers) must be installed system-wide."
fi

echo "Repo:   $REPO_DIR"
echo "Python: $PYTHON"

# Write the service file (requires sudo)
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=OASIS Classify Service (:5002)
After=local-fs.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=$USER
WorkingDirectory=$REPO_DIR/python/oasis-classify
ExecStart=$PYTHON service.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
# HuggingFace offline mode — model must be pre-cached (run with WiFi once)
Environment=HF_HUB_OFFLINE=1
Environment=TRANSFORMERS_OFFLINE=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "Done. oasis-classify is now enabled on boot."
echo "  Status: sudo systemctl status $SERVICE_NAME"
echo "  Logs:   journalctl -u $SERVICE_NAME -f"
