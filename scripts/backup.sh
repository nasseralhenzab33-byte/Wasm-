#!/bin/sh
# نسخة احتياطية متسقة لقاعدة البيانات والصور — شغّله يومياً عبر cron:
#   15 3 * * * /opt/wasm/scripts/backup.sh
set -eu
cd "$(dirname "$0")/.."
DEST=${BACKUP_DIR:-./backups}
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
node --disable-warning=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_FILE || './data/wasm.db');
db.exec(\"VACUUM INTO '$DEST/wasm-$STAMP.db'\");"
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C ./data uploads 2>/dev/null || true
# الاحتفاظ بآخر 14 نسخة
ls -1t "$DEST"/wasm-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$DEST"/uploads-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "backup ok: $DEST/wasm-$STAMP.db"
