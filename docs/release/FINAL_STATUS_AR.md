# حالة إصدار طيبة POS — 2026-08-30

## الحقيقة التشغيلية
هذه النسخة تحتوي على بنية Cloudflare Workers + Google Apps Script + Google Sheets + Cloudflare KV، لكن **ليست بعد إصدارًا Cloudflare Production حقيقيًا يعتمد على Google Sheets بنسبة 100%**.

السبب: عدد من مسارات الـAPI الأساسية ما زال يعتمد على Prisma/SQLite داخليًا. ملف `GoogleAppsScript.gs` وطبقة `sheets-source.ts` يوفّران جسر Sheets/Cache، لكنهما لا يستبدلان طبقة البيانات لجميع العمليات بعد.

## ما تم تجهيزه
- Google Apps Script API محمي بـ `TAYBA_API_TOKEN`.
- `LockService` على عمليات الكتابة في Apps Script.
- Cloudflare KV cache مع fallback محلي للتطوير.
- Health endpoint للبنية.
- إعداد Wrangler/vinext مبدئي.
- الحفاظ على Google Sheets كمصدر حقيقة **في تصميم الطبقة الجديدة**.

## ما لم يتم الادعاء بإتمامه
- لم يتم تحويل جميع routes من Prisma إلى Sheets.
- SQLite ليست Cache-only في جميع أجزاء التطبيق الحالية بعد.
- لا تعتبر هذه النسخة جاهزة لتخزين مبيعات حقيقية على Cloudflare قبل إكمال Data Layer migration.

## طريقة الاستخدام الآمنة الآن
للتجربة المحلية: استخدم SQLite الحالية.
لـCloudflare: أكمل نقل جميع الـroutes إلى `sheets-source.ts`/Apps Script ثم فعّل KV.

لا تستخدم هذه النسخة الحالية كمخزن مبيعات Production على Cloudflare قبل إكمال التحويل.
