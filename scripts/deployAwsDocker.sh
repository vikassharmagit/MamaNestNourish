#!/usr/bin/env bash
set -euo pipefail

: "${AWS_HOST:?AWS_HOST is required}"
: "${AWS_USER:?AWS_USER is required}"
: "${AWS_SSH_KEY_PATH:?AWS_SSH_KEY_PATH is required}"

APP_DIR="${APP_DIR:-/home/ubuntu/MamaNestNourish}"
RUNTIME_DIR="${MAMANEST_RUNTIME_DIR:-/home/ubuntu/MamaNestNourish-runtime}"
ARCHIVE="$(mktemp -t mamanestnourish-deploy.XXXXXX.tar.gz)"

tar \
  --exclude='./node_modules' \
  --exclude='./.git' \
  --exclude='./runtime' \
  --exclude='./Admin_details.txt' \
  --exclude='./.idea' \
  --exclude='./android' \
  --exclude='./*.apk' \
  --exclude='./*.rar' \
  -czf "$ARCHIVE" .

scp -i "$AWS_SSH_KEY_PATH" -o StrictHostKeyChecking=no "$ARCHIVE" "$AWS_USER@$AWS_HOST:/tmp/MamaNestNourish-deploy.tar.gz"

ssh -i "$AWS_SSH_KEY_PATH" -o StrictHostKeyChecking=no "$AWS_USER@$AWS_HOST" \
  "APP_DIR='$APP_DIR' RUNTIME_DIR='$RUNTIME_DIR' bash -s" <<'REMOTE'
set -euo pipefail

mkdir -p "$APP_DIR" "$RUNTIME_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
tar -xzf /tmp/MamaNestNourish-deploy.tar.gz -C "$APP_DIR"
cd "$APP_DIR"

cat > .env <<ENVEOF
COGNITO_REGION=${COGNITO_REGION:-us-east-1}
COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID:-us-east-1_UHtfb9llg}
COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID:-6852oqkg22rilbn8nace83bk3t}
ADMIN_EMAILS=${ADMIN_EMAILS:-admin@mamanestnourish.com}
MAMANEST_RUNTIME_DIR=$RUNTIME_DIR
ENVEOF

sudo docker compose build
sudo docker compose up -d
sleep 5
curl -fsS http://127.0.0.1:3000/health
echo
sudo docker compose ps
REMOTE

rm -f "$ARCHIVE"
