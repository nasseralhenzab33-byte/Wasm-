#!/bin/bash
# تحديث وسم إلى نسخة جديدة مع الحفاظ على البيانات والإعدادات
# الاستخدام: ارفع الملف الجديد wasm-phase1.zip إلى الخادم ثم:
#   unzip -o wasm-phase1.zip && sudo bash wasm/deploy/update.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "❌ شغّل الأمر بـ sudo"; exit 1; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/wasm
[ "$SRC" = "$APP" ] && { echo "❌ شغّل السكربت من مجلد النسخة الجديدة وليس من $APP"; exit 1; }

echo "==> نسخة احتياطية قبل التحديث"
sudo -u wasm bash -c "cd $APP && ./scripts/backup.sh"

echo "==> نسخ الملفات الجديدة (البيانات و .env لا تُمس)"
for d in server public scripts deploy db docs tests; do rm -rf "$APP/$d"; cp -r "$SRC/$d" "$APP/"; done
cp "$SRC/package.json" "$SRC/README.md" "$SRC/.env.example" "$APP/"
chown -R wasm:wasm "$APP"
chmod +x "$APP/scripts/backup.sh" "$APP/deploy/"*.sh
cp "$APP/deploy/wasm.service" /etc/systemd/system/wasm.service
systemctl daemon-reload

echo "==> إعادة التشغيل"
systemctl restart wasm
sleep 2
if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then echo "✅ تم التحديث"; else
  echo "❌ مشكلة بعد التحديث:"; journalctl -u wasm -n 40 --no-pager; exit 1; fi
