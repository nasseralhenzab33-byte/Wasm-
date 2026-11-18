#!/bin/bash
# =====================================================================
# وسم | WASM — تثبيت كامل على خادم Ubuntu 24.04 بأمر واحد
# الاستخدام:   sudo bash wasm/deploy/install.sh  النطاق.com  [--demo]
#   --demo  ينشئ الحساب التجريبي (احذفه قبل الإطلاق العام)
# يمكن تشغيله أكثر من مرة بأمان.
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
DEMO="${2:-}"
if [ -z "$DOMAIN" ] || [[ "$DOMAIN" == -* ]]; then
  echo "❌ اكتب النطاق بعد الأمر، مثال: sudo bash wasm/deploy/install.sh wasm-camel.com"; exit 1
fi
if [ "$(id -u)" -ne 0 ]; then echo "❌ شغّل الأمر بـ sudo أو كمستخدم root"; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/wasm
step() { echo; echo "==> $1"; }

step "1/8 تحديث النظام"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg unzip ufw debian-keyring debian-archive-keyring apt-transport-https

step "2/8 تثبيت Node.js 22"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

step "3/8 تثبيت Caddy (خادم الويب + شهادة HTTPS تلقائية)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

step "4/8 نسخ ملفات وسم إلى $APP"
id wasm >/dev/null 2>&1 || adduser --system --group --home "$APP" --no-create-home wasm
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then
  for d in server public scripts deploy db docs tests; do rm -rf "$APP/$d"; cp -r "$SRC/$d" "$APP/"; done
  cp "$SRC/package.json" "$SRC/README.md" "$SRC/.env.example" "$APP/"
fi
mkdir -p "$APP/data" "$APP/backups"
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  sed -i 's/^NODE_ENV=.*/NODE_ENV=production/; s/^HOST=.*/HOST=127.0.0.1/; s/^TRUST_PROXY=.*/TRUST_PROXY=1/' "$APP/.env"
fi
chown -R wasm:wasm "$APP"
chmod 600 "$APP/.env"
chmod +x "$APP/scripts/backup.sh" "$APP/deploy/"*.sh

step "5/8 تشغيل وسم كخدمة دائمة"
cp "$APP/deploy/wasm.service" /etc/systemd/system/wasm.service
systemctl daemon-reload
systemctl enable wasm >/dev/null
systemctl restart wasm
sleep 2
if ! curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  echo "❌ التطبيق لم يعمل. السجل:"; journalctl -u wasm -n 40 --no-pager; exit 1
fi

if [ "$DEMO" = "--demo" ]; then
  step "إنشاء الحساب التجريبي"
  sudo -u wasm bash -c "cd $APP && set -a && . ./.env && set +a && node --disable-warning=ExperimentalWarning scripts/seed.js"
fi

step "6/8 ضبط النطاق $DOMAIN وشهادة HTTPS"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN, www.$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 8MB
	}
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

step "7/8 الجدار الناري"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

step "8/8 النسخ الاحتياطي اليومي (3:15 فجراً)"
echo "15 3 * * * wasm cd $APP && ./scripts/backup.sh >> $APP/backups/backup.log 2>&1" > /etc/cron.d/wasm-backup
chmod 644 /etc/cron.d/wasm-backup

echo
echo "✅ تم التثبيت."
echo "   افتح: https://$DOMAIN"
echo "   (إذا ما فتح، انتظر دقائق حتى يتعرف الإنترنت على النطاق، ثم: sudo systemctl reload caddy)"
[ "$DEMO" = "--demo" ] && echo "   الحساب التجريبي: demo@wasm.demo / Wasm-demo-2026  — احذفه قبل الإطلاق: sudo bash $APP/deploy/remove-demo.sh"
exit 0
