# عقارات — موقع وساطة عقارية (واجهة ثابتة + Supabase)

- **الواجهة**: ملفات HTML/JS ثابتة تُنشر على GitHub Pages.
- **البيانات والصور والحماية**: Supabase (قاعدة بيانات Postgres + تخزين + دخول المدير).
- **المخطط**: `supabase/schema.sql` (الصقه كاملاً في Supabase ← SQL Editor ← Run).

## الصفحات
- `index.html` الزبائن  ·  `owner.html` أصحاب الشقق  ·  `admin.html` لوحتك (لا رابط لها في الموقع).

## الإعداد
1. شغّل `supabase/schema.sql` في SQL Editor.
2. أنشئ حساب المدير: Authentication ← Users ← Add user (بريد + كلمة مرور، مع Auto Confirm).
3. اجعله مديراً (غيّر البريد):
   `insert into public.admins (user_id) select id from auth.users where email = 'بريدك@example.com';`
4. عطّل التسجيل العام: Authentication ← Sign In / Providers ← أوقف Allow new users to sign up.
5. ضع المفتاح العام (anon / publishable) في `config.js`.
6. فعّل GitHub Pages: Settings ← Pages ← Deploy from a branch ← `main` / root.

## ملاحظات
- لا تضع أبداً مفتاح `service_role` ولا كلمة مرور قاعدة البيانات في هذا المستودع.
- لا يطلب الموقع أي وثائق هوية من الزبائن. بطاقة العامل فقط تُحفظ في حاوية خاصة بالمدير.

## تحديثات قاعدة البيانات
بعد `supabase/schema.sql` شغّل بالترتيب الملفات في `supabase/migrations/`:
- `002_bookings_payment.sql` — تواريخ الحجز، منع التداخل، حالة الدفع، العمال بدون بطاقة.
- `003_notifications.sql` — إشعارات تيليغرام/واتساب (تُضبط من الإعدادات في لوحة المدير).
