#!/bin/bash
set -e

echo "=== Installing and enabling SSH ==="

sudo apt-get update
sudo apt-get install -y openssh-server

sudo systemctl enable ssh
sudo systemctl restart ssh

if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow 22/tcp
    sudo ufw --force reload
fi

echo
echo "=== SSH SERVICE ==="
systemctl --no-pager --full status ssh || true

echo
echo "=== PORT 22 ==="
ss -lntp | grep ':22 ' || true

echo
echo "=== SERVER IP ==="
hostname -I

echo
echo "=== SSH SETUP COMPLETE ==="
