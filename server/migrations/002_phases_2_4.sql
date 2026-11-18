-- وسم | WASM — المراحل 2 و 3 و 4
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN bio TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral ON users(referral_code);
ALTER TABLE media ADD COLUMN listing_id TEXT;
ALTER TABLE media ADD COLUMN company_id TEXT;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings(key, value) VALUES
  ('listing_auto_approve', '0'),
  ('deal_commission_percent', '1'),
  ('auction_anti_snipe_seconds', '120'),
  ('valuation_min_samples', '5');

-- ===================== المرحلة 2: السوق =====================
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camel_id TEXT REFERENCES camels(id) ON DELETE SET NULL,
  broker_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  city TEXT,
  title TEXT NOT NULL,
  camel_name TEXT,
  breed TEXT, color TEXT,
  sex TEXT CHECK (sex IN ('female','male')),
  age_years REAL,
  dam_name TEXT, sire_name TEXT,
  pedigree_documented INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  description_ai INTEGER NOT NULL DEFAULT 0,
  price REAL, currency TEXT NOT NULL,
  negotiable INTEGER NOT NULL DEFAULT 1,
  contact_phone TEXT,
  contact_mode TEXT NOT NULL DEFAULT 'in_app' CHECK (contact_mode IN ('in_app','phone','whatsapp')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('draft','pending_review','active','reserved','sold','expired','rejected','removed')),
  reject_reason TEXT,
  flags TEXT,                         -- مثل duplicate_photo
  views INTEGER NOT NULL DEFAULT 0,
  promoted_until TEXT,
  search_norm TEXT NOT NULL DEFAULT '',
  published_at TEXT, expires_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_browse ON listings(status, country_code, breed, sex, price);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);

CREATE TABLE IF NOT EXISTS listing_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','countered','accepted','rejected','withdrawn','expired')),
  parent_offer_id TEXT REFERENCES offers(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing','user','auction','message','post','company')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL, details TEXT,
  country_code TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  handled_by TEXT, handled_note TEXT, handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, country_code);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
  auction_id TEXT,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TEXT,
  a_read_at TEXT, b_read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (listing_id, user_a, user_b)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','offer','system')),
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT, link TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);

-- ===================== المرحلة 3: المزادات والصفقات =====================
CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
  camel_id TEXT REFERENCES camels(id) ON DELETE SET NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  title TEXT NOT NULL, description TEXT,
  breed TEXT, sex TEXT, age_years REAL,
  currency TEXT NOT NULL,
  start_price REAL NOT NULL CHECK (start_price > 0),
  min_increment REAL NOT NULL CHECK (min_increment > 0),
  reserve_price REAL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  original_ends_at TEXT NOT NULL,
  anti_snipe_seconds INTEGER NOT NULL DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','scheduled','live','ended','cancelled','rejected')),
  current_price REAL,
  current_winner_id TEXT REFERENCES users(id),
  bid_count INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT REFERENCES users(id),
  final_price REAL,
  reserve_met INTEGER,
  ending_notified INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status, ends_at);

-- المزايدات: إلحاقية فقط، كل سجل يحمل تجزئة السجل السابق (سلسلة تكشف أي تلاعب)
CREATE TABLE IF NOT EXISTS bids (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  bidder_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  server_time TEXT NOT NULL,
  ip TEXT,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  extended_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id, seq);
CREATE TRIGGER IF NOT EXISTS bids_no_update BEFORE UPDATE ON bids BEGIN SELECT RAISE(ABORT, 'bids are append-only'); END;
CREATE TRIGGER IF NOT EXISTS bids_no_delete BEFORE DELETE ON bids BEGIN SELECT RAISE(ABORT, 'bids are append-only'); END;

CREATE TABLE IF NOT EXISTS auction_watchers (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (auction_id, user_id)
);

CREATE TABLE IF NOT EXISTS ai_alerts (           -- تنبيهات للمراجعة البشرية (مزايدة غير معتادة، صور مكررة...)
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  country_code TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  reason TEXT NOT NULL, evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared','actioned')),
  reviewed_by TEXT, review_note TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_status ON ai_alerts(status, country_code);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('listing','auction','broker')),
  source_id TEXT,
  seller_id TEXT NOT NULL REFERENCES users(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  broker_id TEXT REFERENCES users(id),
  camel_id TEXT,
  country_code TEXT NOT NULL,
  breed TEXT, sex TEXT, age_years REAL, color TEXT,
  amount REAL NOT NULL, currency TEXT NOT NULL,
  amount_qar REAL NOT NULL,
  commission_amount REAL NOT NULL DEFAULT 0,
  broker_commission REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'agreed' CHECK (status IN ('agreed','completed','cancelled','disputed')),
  summary TEXT,
  completed_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_val ON deals(status, breed, sex);

CREATE TABLE IF NOT EXISTS broker_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  city TEXT, phone TEXT,
  commission_percent REAL NOT NULL DEFAULT 2.5 CHECK (commission_percent BETWEEN 0 AND 20),
  bio TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ===================== شركاء وسم =====================
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_ar TEXT NOT NULL, name_en TEXT,
  category TEXT NOT NULL CHECK (category IN ('feed','vet_pharma','supplies','transport','vet_services','other')),
  country_code TEXT NOT NULL REFERENCES countries(code),
  city TEXT, phone TEXT, website TEXT,
  cr_number TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
  verified_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_companies_cat ON companies(status, category, country_code);

CREATE TABLE IF NOT EXISTS company_offerings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT,
  price REAL, currency TEXT, unit TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ad_packages (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  placement TEXT NOT NULL CHECK (placement IN ('home_banner','section_sponsor','directory_top','listing_boost')),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'QAR',
  country_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES ad_packages(id),
  section TEXT,
  headline TEXT NOT NULL, body TEXT, link TEXT,
  starts_at TEXT, ends_at TEXT,
  amount REAL NOT NULL, currency TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','ended','rejected')),
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_live ON campaigns(status, section);

CREATE TABLE IF NOT EXISTS discount_codes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  percent REAL CHECK (percent IS NULL OR (percent > 0 AND percent <= 90)),
  valid_to TEXT,
  max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS code_redemptions (
  code_id TEXT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (code_id, user_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  commission_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sponsorship_contracts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  value REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'QAR',
  starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
  notes TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ends_on >= starts_on)
);

-- ===================== المرحلة 4: المجتمع والمزاين =====================
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','question','experience','news')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','removed')),
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(status, created_at);
CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS festivals (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  location TEXT,
  starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
  description TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS festival_results (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  camel_name TEXT NOT NULL,
  owner_display TEXT,
  camel_id TEXT REFERENCES camels(id) ON DELETE SET NULL,   -- يُربط فقط من المالك نفسه
  linked_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS search_log (           -- لتوصيات بسيطة (ما يبحث عنه المستخدم)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  breed TEXT, sex TEXT, country_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_search_user ON search_log(user_id, created_at);

INSERT OR IGNORE INTO ad_packages(id, name_ar, placement, duration_days, price, currency) VALUES
  ('pkg-home-7',   'بانر الصفحة الرئيسية — أسبوع', 'home_banner', 7, 1500, 'QAR'),
  ('pkg-sponsor-30','رعاية قسم — شهر', 'section_sponsor', 30, 3000, 'QAR'),
  ('pkg-dir-30',   'أعلى نتائج الدليل — شهر', 'directory_top', 30, 800, 'QAR'),
  ('pkg-boost-7',  'تمييز إعلان — أسبوع', 'listing_boost', 7, 150, 'QAR');
