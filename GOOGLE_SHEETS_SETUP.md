# 📊 دليل إعداد Google Sheets — 3 طرق

هذه النسخة تستخدم Google Apps Script كطبقة الوصول الوحيدة إلى Google Sheets. Google Sheets هو مصدر الحقيقة الدائم.

| الطريقة | الصعوبة | الميزات | متى تستخدمها؟ |
|---|---|---|---|
| **2️⃣ Apps Script** ⭐ موصى بها | ⭐ سهلة جداً (5 دقائق) | مزامنة تلقائية كاملة | **للجميع — ابدأ بها** |
| **3️⃣ (Removed in this release)** | ⭐⭐⭐ صعبة | مزادنة تلقائية كاملة | لو Apps Script لا يعمل |
| **1️⃣ Excel/CSV Export** | ⭐ سهلة | يدوي فقط (تنزيل ملف) | لو لا تريد auto-sync |

---

## 🚀 الطريقة 2 — Google Apps Script (موصى بها — الأسهل)

**المزايا**:
- ✅ لا يحتاج Google Cloud Project
- ✅ لا يحتاج Service Account أو مفاتيح خاصة
- ✅ يعمل على أي حساب Google (شخصي أو Workspace)
- ✅ لا يتأثر بسياسات Organization
- ✅ إعداد في 5 دقائق فقط

### الخطوات

#### 1. أنشئ Google Sheet جديد
1. اذهب إلى https://sheets.google.com
2. اضغط **+ Blank** لإنشاء sheet جديد
3. سمّه: `طيبة - بيانات المتجر`

#### 2. افتح Apps Script
1. من داخل Google Sheet، من القائمة العلوية: **Extensions → Apps Script**
   (بالإنجليزية: Extensions → Apps Script)
   (بالإنجليزية: الإضافات → برمجة التطبيقات)
2. سيفتح محرر Apps Script في تبويب جديد

#### 3. الصق كود طيبة
1. **احذف** أي كود موجود في المحرر (عادة `function myFunction() {}`)
2. افتح ملف `GoogleAppsScript.gs` (تجده في مجلد المشروع أو حمّله من رابط التنزيل)
3. **انسخ كل الكود** والصقه في محرر Apps Script
4. اضغط **Ctrl+S** (أو Cmd+S على Mac) للحفظ
5. سمّ المشروع: `Tayba Sync` (اكتب الاسم في الحقل أعلى المحرر)

#### 4. Deploy كـ Web App
1. من أعلى اليمين، اضغط **Deploy → New deployment**
2. اضغط أيقونة الترس ⚙️ بجانب "Select type" → اختر **Web app**
3. املأ الإعدادات:
   - **Description**: `Tayba Sync`
   - **Execute as**: **Me** (تنفيذ باسمي — حسابك)
   - **Who has access**: **Anyone** (أي شخص — مهم جداً!)
4. اضغط **Deploy**

#### 5. اقبل الأذونات
1. سيظهر تحذير "Authorization required"
2. اضغط **Authorize access**
3. اختر حساب Google الخاص بك
4. سيظهر "Google hasn't verified this app" — اضغط **Advanced** في الأسفل
5. اضغط **Go to Tayba Sync (unsafe)**
6. اضغط **Allow**

#### 6. انسخ الـ Web App URL
1. سيظهر لك "Deployment ID" و **Web app URL**
2. انسخ الـ URL (يبدأ بـ `https://script.google.com/macros/s/...`)
3. هذا هو الرابط الذي ستضعه في طيبة

#### 7. اربطه بطيبة
1. افتح نظام طيبة → سجل دخول
2. اذهب إلى **المزامنة** من القائمة الجانبية
3. في قسم **الطريقة 2 — Google Apps Script**:
   - الصق الرابط في حقل "رابط Apps Script Web App"
   - اضغط **حفظ الرابط**
4. اضغط **اختبار الاتصال** للتأكد
5. اضغط **مزامنة الآن** لتحديث كل الأوراق الـ 18

---

## ℹ️ ملاحظة

> ⚠️ **لو ظهر لك خطأ "Service account key creation is disabled"** — استخدم الطريقة 2 (Apps Script) بدلاً منها. هذا خطأ شائع من Google.

هذه النسخة تعتمد على Apps Script فقط. لا تحتاج Service Account.

---

## 📥 الطريقة 1 — تصدير Excel/CSV (يدوي)

### متى تستخدمها؟
- لو لا تريد auto-sync
- لو تريد نسخة احتياطية فقط
- لو تريد فتح البيانات في Excel

### الخطوات
1. افتح طيبة → المزامنة → الطريقة 1
2. اضغط **تنزيل Excel (.xlsx)**
3. سيتم تنزيل ملف بـ 18 ورقة عمل
4. افتحه في Excel أو اسحبه لـ Google Sheets

---

## 🔄 المزامنة التلقائية (Hybrid Sync)

بمجرد إعداد أي طريقة (2 أو 3)، يتم تفعيل المزامنة التلقائية:

| العملية في طيبة | الأوراق المتأثرة في Google Sheet |
|---|---|
| 🛒 بيع | Sales + SaleItems + Customers |
| 📦 شراء | Purchases + PurchaseItems + Variants + Suppliers |
| ↩️ مرتجع | SaleReturns + Variants + Customers |
| 💰 دفعة عميل | CustomerPayments + Customers |
| 💵 دفعة مورد | SupplierPayments + Suppliers |
| 🔧 تعديل مخزون | StockAdjustments + Variants |
| 👕 تعديل منتج | Products + Variants |

**المزايا**:
- ✅ POS سريع (Google Sheets محلي)
- ✅ Google Sheet محدّث تلقائياً بعد كل عملية
- ✅ Best-effort: فشل المزامنة لا يوقف العملية
- ✅ زر تفعيل/إيقاف Auto-Sync في صفحة المزامنة

---

## ❌ استكشاف الأخطاء

### خطأ: "Service account key creation is disabled"
**السبب**: حسابك تابع لـ Organization تمنع إنشاء مفاتيح.
**الحل**: استخدم الطريقة 2 (Apps Script) — لا تحتاج Service Account.

### خطأ: "Apps Script returned 401/403"
**السبب**: لم تقبل الأذونات، أو لم تضبط "Who has access: Anyone".
**الحل**: أعد Deploy وتأكد من اختيار **Anyone**.

### خطأ: "Apps Script returned 404"
**السبب**: الرابط غير صحيح أو تم حذف الـ deployment.
**الحل**: في Apps Script، اضغط Deploy → Manage deployments → انسخ الرابط الصحيح.

### خطأ: "Google hasn't verified this app"
**هذا تحذير طبيعي** (وليس خطأ):
1. اضغط **Advanced** في الأسفل
2. اضغط **Go to Tayba Sync (unsafe)**
3. اضغط **Allow**

### Apps Script لا يحفظ التغييرات
- تأكد أنك ضغطت **Ctrl+S** قبل Deploy
- تأكد أنك تختار **New deployment** وليس تعديل القديم

---

## 📝 Checklist سريع (الطريقة 2 الموصى بها)

- [ ] أنشأت Google Sheet جديد
- [ ] فتحت Extensions → Apps Script
- [ ] لصقت كود `GoogleAppsScript.gs`
- [ ] حفظت المشروع باسم "Tayba Sync"
- [ ] عملت Deploy → Web app
- [ ] اخترت "Execute as: Me" + "Anyone"
- [ ] قبلت الأذونات
- [ ] نسخت الـ Web App URL
- [ ] فتحت طيبة → المزامنة
- [ ] لصقت الرابط في الطريقة 2
- [ ] حفظت الرابط
- [ ] اختبرت الاتصال
- [ ] عملت "مزامنة الآن"
- [ ] تحققت من ظهور 18 ورقة في Google Sheet

---

🎉 **تهانينا! طيبة متصل بـ Google Sheets بنجاح.**

