# 5. توثيق الواجهة البرمجية (REST API) — v0.1

- كل الطلبات والردود JSON بترميز UTF-8.
- المصادقة: كوكي جلسة `wasm_sid` (HttpOnly, SameSite=Strict, Secure في الإنتاج).
- **كل طلب يغيّر البيانات** يجب أن يحمل الترويسة `X-WASM-Client: 1` (حماية CSRF).
- الأخطاء: `{ "error": "code", "message": "رسالة عربية" }` مع رمز HTTP المناسب (400/401/403/404/409/413/415/423/429).
- تطبيق Flutter مستقبلاً يستخدم نفس الـ API (سيُضاف رمز Bearer بجانب الكوكي في المرحلة 2).

## الحسابات
| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/api/auth/register` | `{email, password, display_name, country_code, role?, phone?}` — الأدوار الإدارية لا تُختار ذاتياً |
| POST | `/api/auth/login` | `{email, password}` — قفل 15 دقيقة بعد 5 محاولات، حد 20 محاولة/15 دقيقة لكل IP |
| POST | `/api/auth/logout` | |
| GET / PATCH | `/api/me` | الملف الشخصي، مدة الحمل، التنبيه، الموافقات |
| POST | `/api/me/password` | `{current_password, new_password}` — ينهي الجلسات الأخرى |
| GET | `/api/me/export` | تصدير كل بيانات المستخدم |
| GET | `/api/countries` | الدول الست |

## الحلال
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/dashboard` | إحصاءات + ولادات متوقعة + تنبيهات + نشاط |
| GET | `/api/alerts` | تنبيهات الولادة (قادمة/متجاوزة)، المتابعات، تأكيد اللقاح |
| GET/POST | `/api/farms` | العزب |
| GET | `/api/camels?q=&sex=&status=&breed=` | قائمة حلال المستخدم |
| POST | `/api/camels` | إنشاء مطية |
| GET/PATCH/DELETE | `/api/camels/:id` | الملف الكامل (تلقيح، ولادات، مواليد، أحداث، صور، مستندات) |
| GET | `/api/camels/:id/pedigree?depth=3` | الشجرة + النسل |
| GET | `/api/camels/:id/history` | سجل التعديلات |
| POST | `/api/camels/:id/events` | `{type, title, event_date, next_due_date?, details?, counterparty?, amount?, currency?}` |
| DELETE | `/api/events/:id` | |
| POST | `/api/matings` | `{dam_id, sire_id \| sire_name_text, mating_date, notes?}` ← يرجع `expected_birth_date` |
| PATCH/DELETE | `/api/matings/:id` | `{outcome}` |
| POST | `/api/births` | `{dam_id, birth_date, outcome, calf_sex, calf_name?, calf_tag?, mating_id?}` ← ينشئ ملف المولود |
| GET | `/api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | (حد أقصى 400 يوم) |

## الوسائط والمشاركة
| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/api/camels/:id/media` | `{data_base64, kind: photo\|document, caption?, is_primary?}` — حد 5MB، JPG/PNG/WEBP/PDF بالفحص الفعلي للبايتات؛ يرجع تنبيهات التكرار |
| GET/DELETE | `/api/media/:id` | للمالك فقط |
| GET/POST | `/api/camels/:id/shares` | `{scope: basic\|pedigree\|full, days: 1–90}` ← الرمز يظهر مرة واحدة |
| DELETE | `/api/shares/:id` | إلغاء |
| GET | `/api/public/share/:token` | عام — بيانات منقحة حسب النطاق |
| GET | `/api/public/share/:token/photo/:mid` | عام |

## المساعد الذكي
| الطريقة | المسار | الوصف |
|---|---|---|
| GET/DELETE | `/api/ai/messages` | السجل / مسح |
| POST | `/api/ai/messages` | `{text}` ← `{reply, intent, source, cards?, action?, options?}` — حد 30 رسالة/دقيقة |
| POST | `/api/ai/actions/:id/confirm` | تنفيذ الإجراء المقترح (مرة واحدة فقط) |
| POST | `/api/ai/actions/:id/cancel` | |
| POST | `/api/ai/analyze-photo` | `{data_base64}` — يُفعّل عند ضبط مزود يدعم الرؤية (م2) |

`source`: `records` = من قاعدة البيانات • `ai_draft` = مسودة مولدة من السجلات • `ai` = إجابة نموذج لغوي.

## مثال
```bash
curl -c c.txt -H 'Content-Type: application/json' -X POST localhost:3000/api/auth/login \
  -d '{"email":"demo@wasm.demo","password":"Wasm-demo-2026"}'
curl -b c.txt -H 'X-WASM-Client: 1' -H 'Content-Type: application/json' -X POST localhost:3000/api/ai/messages \
  -d '{"text":"أي النوق عندي بتولد الشهر القادم؟"}'
```

---
## المراحل 2–4

### السوق والعروض والرسائل
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/listings?country=&breed=&sex=&age=&min_price=&max_price=&min_age=&max_age=&q=&sort=&favorites=1&seller=me` | تصفح (عام) |
| POST | `/api/listings` | `{camel_id?, title, description, price?, currency?, country_code, city?, breed?, sex?, age_years?, color?, negotiable, contact_mode, contact_phone?, broker_id?, include_photos?}` |
| POST | `/api/listings/draft` | `{camel_id}` ← عنوان ووصف من سجلات المطية |
| GET | `/api/listings/:id` • `/similar` • `/api/listings/recommended` • `/api/listings/compare?ids=a,b` | |
| PATCH | `/api/listings/:id` | تعديل + تغيير الحالة (محجوز/حذف/إعادة إرسال) |
| POST | `/api/listings/:id/favorite` • `/photos` • `/offers` • `/messages` | |
| GET | `/api/listing-photos/:id` | صورة إعلان منشور (عام) |
| POST | `/api/offers/:id/respond` | `{action: accept\|reject\|counter\|withdraw, amount?}` — القبول ينشئ صفقة ويحجز الإعلان |
| GET/POST | `/api/conversations` • `/:id` • `/:id/messages` • `/:id/summary` | |
| GET/PATCH | `/api/deals` • `/api/deals/:id` `{status: completed\|cancelled}` | الإتمام يسجل البيع في الحلال |
| POST | `/api/reports` | `{target_type, target_id, reason, details?}` |
| GET | `/api/valuation?breed=&sex=&age_years=&country=` | تثمين استرشادي (م4) |

### الإشعارات والبث
| GET | `/api/notifications` • POST `/api/notifications/read` • GET `/api/unread` | |
|---|---|---|
| GET | `/api/stream[?auction=ID]` | Server-Sent Events: `notification`, `message`, `bid`, `status` |

### المزادات
| GET/POST | `/api/auctions` | `{title, start_price, min_increment?, reserve_price?, starts_at, ends_at, country_code, listing_id?, camel_id?}` |
|---|---|---|
| GET | `/api/auctions/:id` • `/verify` | التحقق من سلسلة تجزئة السجل |
| POST | `/api/auctions/:id/bids` `{amount}` • `/watch` • `/cancel` | المزايدة 409 مع `min_next_bid` إذا كانت أقل من المسموح |

### الوسطاء والشركاء
`GET /api/brokers` • `GET|PUT /api/brokers/me` • `GET /api/directory?category=&country=` • `GET|POST|PATCH /api/partner` • `POST /api/partner/offerings|campaigns|codes` • `GET /api/sponsor?section=` • `POST /api/campaigns/:id/click` • `POST /api/codes/redeem` • `GET /api/referral`

### المجتمع والمزاين
`GET|POST /api/posts` • `GET|DELETE /api/posts/:id` • `POST /api/posts/:id/like|comments` • `GET|POST /api/festivals` • `POST /api/festivals/:id/results` • `POST /api/festival-results/:id/link`

### الإدارة (مدير عام = كل الدول، مدير دولة = دولته فقط)
`GET /api/admin/stats` • `GET /api/admin/listings` • `POST /api/admin/listings/:id/review|remove` • `GET /api/admin/auctions` • `POST /api/admin/auctions/:id/review` • `GET /api/admin/reports` • `POST /api/admin/reports/:id {action: remove|suspend_user|dismiss}` • `GET /api/admin/alerts` • `POST /api/admin/alerts/:id` • `GET /api/admin/users` • `POST /api/admin/users/:id/suspend|role` • `POST /api/admin/countries/:code` • `GET|PATCH /api/admin/settings` • `GET /api/admin/partners` • `POST /api/admin/companies/:id|campaigns/:id|packages|contracts`
