-- وسم | WASM — المرحلة الأولى (SQLite للتشغيل المحلي، مطابق منطقياً لمخطط PostgreSQL في db/postgres)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY,              -- SA, QA, AE, KW, BH, OM
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  currency TEXT NOT NULL,
  phone_prefix TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('user','owner','trader','broker','company','provider','country_admin','super_admin')),
  admin_country_code TEXT REFERENCES countries(code),
  gestation_days INTEGER NOT NULL DEFAULT 390,
  birth_alert_days INTEGER NOT NULL DEFAULT 14,
  ai_image_training_consent INTEGER NOT NULL DEFAULT 0,
  partner_data_sharing_consent INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- العزب (مواقع الحلال) — يملكها المستخدم
CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  area_text TEXT,                      -- وصف نصي للمنطقة فقط (لا إحداثيات دقيقة في المرحلة الأولى)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_farms_owner ON farms(owner_id);

-- الإبل (الملف الرقمي لكل مطية)
CREATE TABLE IF NOT EXISTS camels (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id TEXT REFERENCES farms(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,             -- اسم مُطبَّع للبحث العربي
  tag_number TEXT,                     -- رقم المطية أو الوسم
  microchip TEXT,
  sex TEXT NOT NULL CHECK (sex IN ('female','male')),
  breed TEXT,                          -- مغاتير، مجاهيم، أصايل، ...
  color TEXT,
  birth_date TEXT,                     -- YYYY-MM-DD إن توفر
  birth_date_estimated INTEGER NOT NULL DEFAULT 0,
  dam_id TEXT REFERENCES camels(id) ON DELETE SET NULL,
  sire_id TEXT REFERENCES camels(id) ON DELETE SET NULL,
  dam_name_text TEXT,                  -- أم خارج الحلال (غير مسجلة)
  sire_name_text TEXT,                 -- أب خارج الحلال
  pedigree_verified INTEGER NOT NULL DEFAULT 0,  -- لا يُعتبر موثقاً إلا بمستند/جهة معتمدة
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','pregnant','nursing','sold','dead','transferred')),
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_id, tag_number)
);
CREATE INDEX IF NOT EXISTS idx_camels_owner ON camels(owner_id);
CREATE INDEX IF NOT EXISTS idx_camels_owner_name ON camels(owner_id, name_norm);
CREATE INDEX IF NOT EXISTS idx_camels_dam ON camels(dam_id);
CREATE INDEX IF NOT EXISTS idx_camels_sire ON camels(sire_id);

-- التلقيح
CREATE TABLE IF NOT EXISTS matings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dam_id TEXT NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  sire_id TEXT REFERENCES camels(id) ON DELETE SET NULL,
  sire_name_text TEXT,                 -- فحل من خارج الحلال
  mating_date TEXT NOT NULL,
  expected_birth_date TEXT NOT NULL,   -- تقديري = تاريخ التلقيح + مدة الحمل
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','confirmed_pregnant','not_pregnant','born','aborted')),
  birth_id TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','assistant','import')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_matings_owner_due ON matings(owner_id, expected_birth_date);
CREATE INDEX IF NOT EXISTS idx_matings_dam ON matings(dam_id, mating_date);

-- الولادات
CREATE TABLE IF NOT EXISTS births (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dam_id TEXT NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  mating_id TEXT REFERENCES matings(id) ON DELETE SET NULL,
  calf_id TEXT REFERENCES camels(id) ON DELETE SET NULL,
  birth_date TEXT NOT NULL,
  calf_sex TEXT CHECK (calf_sex IN ('female','male')),
  outcome TEXT NOT NULL DEFAULT 'live' CHECK (outcome IN ('live','stillborn')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_births_dam ON births(dam_id, birth_date);

-- أحداث صحية وتشغيلية: فطام، تحصين، علاج، زيارة بيطرية، بيع، شراء، نقل، فحص، ملاحظة
CREATE TABLE IF NOT EXISTS camel_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id TEXT NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('weaning','vaccination','treatment','vet_visit','sale','purchase','transfer','checkup','achievement','note')),
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  next_due_date TEXT,                  -- موعد متابعة قادم (جرعة ثانية مثلاً)
  counterparty TEXT,                   -- المشتري/البائع/الطبيب
  amount REAL,
  currency TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_camel ON camel_events(camel_id, event_date);
CREATE INDEX IF NOT EXISTS idx_events_owner_due ON camel_events(owner_id, next_due_date);

-- الوسائط والمستندات (مخزنة خارج قاعدة البيانات، تُخدم بعد التحقق من الصلاحية)
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id TEXT REFERENCES camels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo','document')),
  storage_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,                -- لاكتشاف الصور المكررة
  caption TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_camel ON media(camel_id);
CREATE INDEX IF NOT EXISTS idx_media_sha ON media(sha256);

-- روابط المشاركة محدودة الصلاحية
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id TEXT NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'basic' CHECK (scope IN ('basic','pedigree','full')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- سجل التعديلات لكل مطية + سجل تدقيق عام
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  camel_id TEXT,
  diff_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_camel ON audit_log(camel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at);

-- المساعد الذكي: المحادثات والإجراءات المعلقة بانتظار تأكيد المستخدم
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_user ON ai_messages(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
