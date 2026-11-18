-- =====================================================================
-- وسم | WASM — مخطط PostgreSQL المستهدف (المراحل 1 → 4)
-- المرحلة الأولى تعمل حالياً على SQLite بنفس الجداول الأساسية (server/migrations).
-- هذا المخطط هو مرجع الانتقال إلى الإنتاج، ويتضمن جداول المراحل القادمة
-- حتى تُضاف الميزات دون إعادة تصميم الجداول الأساسية.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- بحث نصي عربي تقريبي

-- ---------- أنواع ----------
CREATE TYPE user_role AS ENUM ('user','owner','trader','broker','company','provider','country_admin','super_admin');
CREATE TYPE camel_sex AS ENUM ('female','male');
CREATE TYPE camel_status AS ENUM ('active','pregnant','nursing','sold','dead','transferred');
CREATE TYPE mating_outcome AS ENUM ('pending','confirmed_pregnant','not_pregnant','born','aborted');
CREATE TYPE event_type AS ENUM ('weaning','vaccination','treatment','vet_visit','sale','purchase','transfer','checkup','achievement','note');
CREATE TYPE listing_status AS ENUM ('draft','pending_review','active','reserved','sold','expired','rejected','removed');
CREATE TYPE auction_status AS ENUM ('draft','scheduled','live','ended','cancelled','settled');

-- =====================================================================
-- المرحلة 1: الهوية والحلال
-- =====================================================================
CREATE TABLE countries (
  code CHAR(2) PRIMARY KEY,
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
  currency CHAR(3) NOT NULL, phone_prefix TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  phone TEXT,
  phone_verified_at TIMESTAMPTZ,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  role user_role NOT NULL DEFAULT 'owner',
  gestation_days SMALLINT NOT NULL DEFAULT 390 CHECK (gestation_days BETWEEN 330 AND 420),
  birth_alert_days SMALLINT NOT NULL DEFAULT 14 CHECK (birth_alert_days BETWEEN 1 AND 60),
  ai_image_training_consent BOOLEAN NOT NULL DEFAULT FALSE,
  partner_data_sharing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc BYTEA,                         -- المرحلة 2: مصادقة ثنائية
  failed_logins SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- صلاحيات مدير الدولة (قد يدير أكثر من دولة)
CREATE TABLE admin_country_scopes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  permissions TEXT[] NOT NULL DEFAULT '{}',     -- listings.review, reports.handle, partners.manage, ...
  PRIMARY KEY (user_id, country_code)
);

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip INET, user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  area_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX farms_owner_idx ON farms(owner_id);

CREATE TABLE camels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  tag_number TEXT,
  microchip TEXT,
  sex camel_sex NOT NULL,
  breed TEXT, color TEXT,
  birth_date DATE,
  birth_date_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  dam_id UUID REFERENCES camels(id) ON DELETE SET NULL,
  sire_id UUID REFERENCES camels(id) ON DELETE SET NULL,
  dam_name_text TEXT, sire_name_text TEXT,
  pedigree_verified BOOLEAN NOT NULL DEFAULT FALSE,
  pedigree_verified_by TEXT,                    -- جهة التحقق المعتمدة
  status camel_status NOT NULL DEFAULT 'active',
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT camels_not_self_parent CHECK (dam_id IS DISTINCT FROM id AND sire_id IS DISTINCT FROM id),
  CONSTRAINT camels_tag_uq UNIQUE (owner_id, tag_number)
);
CREATE INDEX camels_owner_idx ON camels(owner_id);
CREATE INDEX camels_name_trgm ON camels USING gin (name_norm gin_trgm_ops);
CREATE INDEX camels_dam_idx ON camels(dam_id);
CREATE INDEX camels_sire_idx ON camels(sire_id);

CREATE TABLE matings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dam_id UUID NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  sire_id UUID REFERENCES camels(id) ON DELETE SET NULL,
  sire_name_text TEXT,
  mating_date DATE NOT NULL,
  expected_birth_date DATE NOT NULL,
  outcome mating_outcome NOT NULL DEFAULT 'pending',
  birth_id UUID,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','assistant','import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matings_sire_present CHECK (sire_id IS NOT NULL OR sire_name_text IS NOT NULL)
);
CREATE INDEX matings_owner_due_idx ON matings(owner_id, expected_birth_date) WHERE outcome IN ('pending','confirmed_pregnant');
CREATE INDEX matings_dam_idx ON matings(dam_id, mating_date DESC);

CREATE TABLE births (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dam_id UUID NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  mating_id UUID REFERENCES matings(id) ON DELETE SET NULL,
  calf_id UUID REFERENCES camels(id) ON DELETE SET NULL,
  birth_date DATE NOT NULL,
  calf_sex camel_sex,
  outcome TEXT NOT NULL DEFAULT 'live' CHECK (outcome IN ('live','stillborn')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE matings ADD CONSTRAINT matings_birth_fk FOREIGN KEY (birth_id) REFERENCES births(id) ON DELETE SET NULL;
CREATE INDEX births_dam_idx ON births(dam_id, birth_date DESC);

CREATE TABLE camel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id UUID NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  type event_type NOT NULL,
  event_date DATE NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  next_due_date DATE,
  counterparty TEXT,
  amount NUMERIC(14,2) CHECK (amount >= 0),
  currency CHAR(3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_camel_idx ON camel_events(camel_id, event_date DESC);
CREATE INDEX events_due_idx ON camel_events(owner_id, next_due_date) WHERE next_due_date IS NOT NULL;

CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id UUID REFERENCES camels(id) ON DELETE CASCADE,
  listing_id UUID,                              -- المرحلة 2
  kind TEXT NOT NULL CHECK (kind IN ('photo','document')),
  storage_key TEXT NOT NULL UNIQUE,             -- مفتاح التخزين السحابي (S3/R2) — خاص، يُخدم بروابط موقعة
  mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 CHAR(64) NOT NULL,
  phash BIGINT,                                 -- المرحلة 2: بصمة إدراكية لاكتشاف الصور المتشابهة
  caption TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  training_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_camel_idx ON media(camel_id);
CREATE INDEX media_sha_idx ON media(sha256);

CREATE TABLE share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id UUID NOT NULL REFERENCES camels(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'basic' CHECK (scope IN ('basic','pedigree','full')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- سجل تدقيق إلحاقي فقط (append-only) — يُمنع التعديل والحذف بقاعدة
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  camel_id UUID,
  diff JSONB,
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_camel_idx ON audit_log(camel_id, created_at DESC);
CREATE INDEX audit_actor_idx ON audit_log(actor_id, created_at DESC);
CREATE RULE audit_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  meta JSONB,
  provider TEXT, tokens_in INTEGER, tokens_out INTEGER,   -- لمراقبة تكلفة الذكاء الاصطناعي
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_user_idx ON ai_messages(user_id, created_at);

CREATE TABLE ai_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- upcoming_birth, outbid, auction_ending, offer, message ...
  title TEXT NOT NULL, body TEXT,
  link TEXT,
  channel TEXT[] NOT NULL DEFAULT '{in_app}',   -- in_app, push, email, sms, whatsapp
  dedupe_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE devices (                          -- إشعارات الجوال (Flutter / FCM / APNs)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- المرحلة 2: السوق والإعلانات والبحث وتحليل الصور
-- =====================================================================
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id UUID REFERENCES camels(id) ON DELETE SET NULL,   -- إعلان من ملف المطية (اختياري)
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  city TEXT,
  title TEXT NOT NULL,
  camel_name TEXT,
  breed TEXT, color TEXT, sex camel_sex, age_years NUMERIC(4,1),
  dam_name TEXT, sire_name TEXT, pedigree_documented BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL,
  description_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  price NUMERIC(14,2), currency CHAR(3) NOT NULL,
  negotiable BOOLEAN NOT NULL DEFAULT TRUE,
  contact_mode TEXT NOT NULL DEFAULT 'in_app' CHECK (contact_mode IN ('in_app','phone','whatsapp')),
  status listing_status NOT NULL DEFAULT 'pending_review',
  views INTEGER NOT NULL DEFAULT 0,
  promoted_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  search_tsv TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listings_browse_idx ON listings(country_code, status, breed, sex, price);
CREATE INDEX listings_tsv_idx ON listings USING gin(search_tsv);
ALTER TABLE media ADD CONSTRAINT media_listing_fk FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

CREATE TABLE listing_favorites (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','countered','accepted','rejected','withdrawn','expired')),
  parent_offer_id UUID REFERENCES offers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (                          -- البلاغات والشكاوى
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing','user','auction','message','post')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL, details TEXT,
  country_code CHAR(2) REFERENCES countries(code),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','actioned','dismissed')),
  handled_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE conversation_members (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages(conversation_id, created_at);

CREATE TABLE ai_image_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, model TEXT NOT NULL,
  result JSONB NOT NULL,                        -- color, category_guess, confidence, visible_traits, caveats
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- المرحلة 3: المزادات والوساطة والشركاء
-- =====================================================================
CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id),
  listing_id UUID REFERENCES listings(id),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  title TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  start_price NUMERIC(14,2) NOT NULL CHECK (start_price > 0),
  min_increment NUMERIC(14,2) NOT NULL CHECK (min_increment > 0),
  reserve_price NUMERIC(14,2),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  anti_snipe_seconds INTEGER NOT NULL DEFAULT 120,   -- تمديد عند مزايدة في آخر دقيقتين
  status auction_status NOT NULL DEFAULT 'draft',
  current_price NUMERIC(14,2),
  current_winner_id UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 0,               -- قفل تفاؤلي
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- المزايدات: تُدرج فقط عبر دالة خادم داخل معاملة SERIALIZABLE؛ لا تعديل ولا حذف
CREATE TABLE bids (
  id BIGSERIAL PRIMARY KEY,
  auction_id UUID NOT NULL REFERENCES auctions(id),
  bidder_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(14,2) NOT NULL,
  server_time TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ip INET,
  prev_hash CHAR(64), hash CHAR(64) NOT NULL,      -- سلسلة تجزئة تكشف أي تلاعب بالسجل
  flagged BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX bids_auction_idx ON bids(auction_id, id);
CREATE RULE bids_no_update AS ON UPDATE TO bids DO INSTEAD NOTHING;
CREATE RULE bids_no_delete AS ON DELETE TO bids DO INSTEAD NOTHING;

CREATE TABLE bid_alerts (                         -- أنماط مزايدة غير معتادة للمراجعة البشرية
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auctions(id),
  reason TEXT NOT NULL, evidence JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared','actioned')),
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deals (                              -- الصفقات (من إعلان أو مزاد أو وسيط)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('listing','auction','broker')),
  source_id UUID,
  seller_id UUID NOT NULL REFERENCES users(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  broker_id UUID REFERENCES users(id),
  camel_id UUID REFERENCES camels(id),
  amount NUMERIC(14,2) NOT NULL, currency CHAR(3) NOT NULL,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'agreed' CHECK (status IN ('agreed','paid','transferred','completed','cancelled','disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name_ar TEXT NOT NULL, name_en TEXT,
  category TEXT NOT NULL CHECK (category IN ('feed','vet_pharma','supplies','transport','vet_services','other')),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  cr_number TEXT,                                 -- السجل التجاري
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ad_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar TEXT NOT NULL,
  placement TEXT NOT NULL,                        -- home_banner, section_sponsor, listing_boost ...
  duration_days INTEGER NOT NULL,
  price NUMERIC(12,2) NOT NULL, currency CHAR(3) NOT NULL,
  country_code CHAR(2) REFERENCES countries(code),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  package_id UUID REFERENCES ad_packages(id),
  section TEXT,                                   -- رعاية قسم
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  creative JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','ended','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE campaign_stats_daily (
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, day)
);
CREATE TABLE discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL UNIQUE,
  percent NUMERIC(5,2), amount NUMERIC(12,2),
  valid_from DATE, valid_to DATE, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  referrer_user_id UUID REFERENCES users(id),
  referred_user_id UUID REFERENCES users(id),
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sponsorship_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  section TEXT NOT NULL,
  value NUMERIC(14,2) NOT NULL, currency CHAR(3) NOT NULL,
  starts_on DATE NOT NULL, ends_on DATE NOT NULL,
  document_media_id UUID REFERENCES media(id),
  renewal_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id UUID REFERENCES users(id),
  company_id UUID REFERENCES companies(id),
  purpose TEXT NOT NULL,                          -- package, listing_boost, commission, subscription
  ref_id UUID,
  amount NUMERIC(14,2) NOT NULL, currency CHAR(3) NOT NULL,
  gateway TEXT NOT NULL, gateway_ref TEXT,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','succeeded','failed','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- المرحلة 4: التثمين والمجتمع والمزاين
-- =====================================================================
CREATE TABLE valuation_samples (                  -- صفقات حقيقية مجهولة الهوية لبناء التثمين الاسترشادي
  id BIGSERIAL PRIMARY KEY,
  deal_id UUID REFERENCES deals(id),
  country_code CHAR(2), breed TEXT, sex camel_sex, age_years NUMERIC(4,1), color TEXT,
  price_qar NUMERIC(14,2) NOT NULL,
  sold_on DATE NOT NULL
);
CREATE TABLE festivals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar TEXT NOT NULL, country_code CHAR(2) REFERENCES countries(code),
  starts_on DATE, ends_on DATE
);
CREATE TABLE festival_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id UUID REFERENCES festivals(id) ON DELETE CASCADE,
  category TEXT NOT NULL, rank SMALLINT,
  camel_id UUID REFERENCES camels(id) ON DELETE SET NULL,   -- يُربط فقط بموافقة المالك
  camel_name TEXT, owner_display TEXT
);
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- أمان على مستوى الصفوف (RLS): طبقة دفاع ثانية لعزل حلال كل مستخدم
-- التطبيق يضبط: SET LOCAL app.user_id = '<uuid>' في كل معاملة.
-- =====================================================================
ALTER TABLE camels ENABLE ROW LEVEL SECURITY;
ALTER TABLE matings ENABLE ROW LEVEL SECURITY;
ALTER TABLE births ENABLE ROW LEVEL SECURITY;
ALTER TABLE camel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_camels ON camels USING (owner_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY own_matings ON matings USING (owner_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY own_births ON births USING (owner_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY own_events ON camel_events USING (owner_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY own_media ON media USING (owner_id = current_setting('app.user_id', true)::uuid);

INSERT INTO countries VALUES
 ('SA','السعودية','Saudi Arabia','SAR','+966',TRUE),('QA','قطر','Qatar','QAR','+974',TRUE),
 ('AE','الإمارات','United Arab Emirates','AED','+971',TRUE),('KW','الكويت','Kuwait','KWD','+965',TRUE),
 ('BH','البحرين','Bahrain','BHD','+973',TRUE),('OM','عُمان','Oman','OMR','+968',TRUE);
