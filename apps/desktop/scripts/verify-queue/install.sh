#!/bin/bash
# Instala o actualiza la cola en la máquina. Corre como root desde esta carpeta.
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
install -d -o verify -g verify /var/lib/verify-queue
install -d /opt/verify-queue /etc/verify-queue
install -m 0644 "$here/server.mjs" /opt/verify-queue/server.mjs
install -m 0644 "$here/repos.json" /etc/verify-queue/repos.json
install -m 0755 "$here/verify-idle-stop" /usr/local/bin/verify-idle-stop
install -m 0644 "$here/verify-queue.service" /etc/systemd/system/verify-queue.service
systemctl daemon-reload
systemctl enable verify-queue >/dev/null 2>&1
systemctl restart verify-queue
