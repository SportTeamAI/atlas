#!/usr/bin/env bash
# deploy-backend.sh — sube el backend de Atlas/Kairos al VPS y reinicia el servicio.
# Uso: ./scripts/deploy-backend.sh
# Requiere: SSH_KEY_PATH y VPS_HOST en el entorno (o .secrets/vps_key).
set -euo pipefail

VPS_HOST="${VPS_HOST:-2.25.69.148}"
SSH_KEY="${SSH_KEY_PATH:-.secrets/vps_key}"
REMOTE_DIR="/opt/atlas/backend-new"
LIVE_DIR="/opt/atlas/backend"
SRC="tools/kairos/apps/backend/src"

echo "▶ Empaquetando backend…"
TARBALL="$(mktemp /tmp/atlas-backend-XXXX.tar.gz)"
tar -czf "$TARBALL" \
  --exclude="__pycache__" \
  --exclude="*.pyc" \
  --exclude=".venv" \
  -C "$SRC" .

echo "▶ Subiendo al VPS ($VPS_HOST)…"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "root@$VPS_HOST" "mkdir -p $REMOTE_DIR"
scp -i "$SSH_KEY" "$TARBALL" "root@$VPS_HOST:$REMOTE_DIR/backend.tar.gz"
rm "$TARBALL"

echo "▶ Instalando en el VPS…"
ssh -i "$SSH_KEY" "root@$VPS_HOST" bash <<'REMOTE'
set -euo pipefail
cd /opt/atlas
tar -xzf backend-new/backend.tar.gz -C backend-new
rm backend-new/backend.tar.gz
# swap atómico
[ -d backend-old ] && rm -rf backend-old
[ -d backend ]     && mv backend backend-old
mv backend-new backend
# Dependencias: el venv (/opt/atlas/venv) ya las tiene (se instalan 1 vez en el setup del VPS
# desde pyproject.toml). Un deploy solo cambia CÓDIGO, no dependencias. Si algún día cambian,
# actualizarlas a mano en el VPS. (Antes aquí había `pip install -r backend/requirements.txt`,
# archivo que NO existe → el paso abortaba SIEMPRE aunque el swap ya había ocurrido. Removido.)
# reiniciar
systemctl restart atlas-kairos
sleep 2
systemctl is-active --quiet atlas-kairos && echo "✅ atlas-kairos activo" || { echo "❌ falló"; systemctl status atlas-kairos --no-pager; exit 1; }
REMOTE

echo "✅ Backend desplegado."
