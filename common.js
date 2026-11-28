const $ = (s, r = document) => r.querySelector(s);
const CFG = window.AQARAT;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

// بناء عناصر DOM بأمان (بدون innerHTML) لتفادي حقن الشيفرة
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
// المبلغ معزول بالكامل (LRI..PDI) كي لا يغيّر النص العربي ترتيب أرقامه أبداً
const money = n => '\u2066' + fmt(n) + '\u00A0DA' + '\u2069';
const fdate = t => '\u2066' + new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '\u2069';
const fd = d => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return '\u2066' + dd + '/' + m + '/' + y + '\u2069'; };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = new Date(s + 'T00:00:00'), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return iso(d); };
const withRate = (price, rate) => price + Math.floor(price * rate / 100 + 0.5);

// رسائل الخطأ العربية القادمة من قاعدة البيانات تُعرض كما هي، وغيرها برسالة عامة
function fail(error) {
  const m = (error && error.message) || '';
  return new Error(/[؀-ۿ]/.test(m) ? m : 'حدث خطأ، تأكد من الاتصال وحاول مرة أخرى');
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw fail(error);
  return data;
}
async function ok(promise) {
  const { data, error } = await promise;
  if (error) throw fail(error);
  return data;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// تصغير الصورة قبل الرفع (أقصى بعد 1400px) لتسريع الرفع وتوفير البيانات
function resizeToBlob(file, max = 1400, q = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('اختر ملف صورة'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('تعذر معالجة الصورة')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')); };
    img.src = url;
  });
}

async function uploadTo(bucket, file) {
  const blob = await resizeToBlob(file);
  const path = uuid() + '.jpg';
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error('تعذر رفع الصورة، حاول مرة أخرى');
  return path;
}
const photoUrl = path => `${CFG.SUPABASE_URL}/storage/v1/object/public/listing-photos/${path}`;

function toast(msg, good = true) {
  const t = h('div', { class: 'toast ' + (good ? 'ok' : 'err') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

function mapEmbed(l) {
  if (l.lat != null && l.lng != null)
    return h('iframe', { class: 'map', loading: 'lazy', referrerpolicy: 'no-referrer',
      src: `https://maps.google.com/maps?q=${encodeURIComponent(l.lat + ',' + l.lng)}&z=16&output=embed` });
  return null;
}
function mapLink(l) {
  const href = l.map_url || (l.lat != null ? `https://www.google.com/maps?q=${l.lat},${l.lng}`
    : `https://www.google.com/maps/search/${encodeURIComponent(l.address + ' واد سوف')}`);
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, '📍 فتح الموقع في الخرائط');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- واتساب: رسائل جاهزة (تُرسَل بضغطة من المرسِل) ----------
const intl = p => p.startsWith('0') ? '213' + p.slice(1) : p.replace(/^\+/, '');
const wa = (phone, txt) => `https://wa.me/${intl(phone)}?text=${encodeURIComponent(txt)}`;
const waBtn = (label, href, cls = 'btn sm') => h('a', { class: cls, style: 'text-decoration:none', target: '_blank', rel: 'noopener', href }, label);
const period = o => `من ${fd(o.start_date)} إلى ${fd(o.end_date)}`;
const unitWord = o => o.kind === 'furnished' ? 'يوم' : 'شهر';
// رسالة لصاحب الشقة: تم كراء سكنك
const ownerMsg = (o, paid) => `السلام عليكم ${o.owner_name}، ${paid ? 'تم تسليم المبلغ و' : ''}تم كراء شقتك «${o.listing_title}» من طرف الزبون ${o.client_name} (هاتفه: ${o.client_phone}) لمدة ${o.units} ${unitWord(o)} ${period(o)}. المبلغ المستحق لك: ${money(o.owner_total)}. نرجو تنبيه الزبون على الحفاظ على نظافة الشقة وتجهيزاتها. (عقارات سوف)`;
// رسالة للزبون عند الموافقة: المبلغ للوسيط والمبلغ لصاحب الشقة كلٌّ على حدة
const splitLines = o => `\n• تسلّم للوسيط: ${money(o.commission)}\n• تسلّم لصاحب الشقة: ${money(o.owner_total)}\n• المجموع: ${money(o.total)}\n`;
const clientApprovedMsg = o => `السلام عليكم ${o.client_name}، تمت الموافقة على حجزك «${o.listing_title}» ${period(o)}.\nالمبالغ المطلوبة منك:${splitLines(o)}سلّم مبلغ الوسيط وسنرسل لك رقم صاحب الشقة. (عقارات سوف)`;
// رسالة للزبون عند تسليم المبلغ
const clientPaidMsg = o => `السلام عليكم ${o.client_name}، تم حجز الشقة «${o.listing_title}» ${period(o)}.\nالمبالغ:${splitLines(o)}رقم صاحب الشقة للتواصل المباشر: ${o.owner_name} ${o.owner_phone}\nالعنوان: ${o.address}\nنتمنى لكم إقامة طيبة. (عقارات سوف)`;

// نافذة فيها أزرار واتساب جاهزة
function showMsgs(title, items) {
  const m = h('div', { class: 'modal', onclick: e => { if (e.target === m) m.remove(); } },
    h('div', { class: 'box', style: 'max-width:420px' },
      h('h3', {}, title), h('div', { class: 'muted' }, 'اضغط كل زر لفتح واتساب برسالة جاهزة ثم اضغط إرسال.'),
      h('div', { style: 'display:grid;gap:8px;margin:12px 0' }, items.map(([l, href]) => waBtn(l, href, 'btn pri'))),
      h('button', { class: 'btn', onclick: () => m.remove() }, 'إغلاق')));
  document.body.append(m);
}

const workerLink = () => new URL('worker.html', location.href).href;
const workerAppsOpen = () => rpc('worker_apps_open').catch(() => false);
function setNav(items) {
  $('#nav').replaceChildren(...items.map(([label, href, fn]) => h('a', { href: href || '#', onclick: fn ? (e => { e.preventDefault(); fn(); }) : null }, label)));
}
// زر «طلب العمل» في شريط الأعلى بجانب الإدارة: يظهر فقط عندما يفعّله المدير
async function sideWorker() {
  const nav = $('#nav');
  if (nav && !nav.querySelector('.wk') && await workerAppsOpen()) nav.append(h('a', { class: 'wk', href: 'worker.html' }, '👷 طلب العمل'));
}

// اسم الموقع وصورة الواجهة (يعدّلهما المدير من الإعدادات)
const bannerUrl = p => `${CFG.SUPABASE_URL}/storage/v1/object/public/site-assets/${p}`;
async function applySite() {
  let s = null;
  try { s = await rpc('site_info'); } catch {}
  if (!s) return;
  document.querySelectorAll('.sn').forEach(e => { e.textContent = s.name; });
  const b = $('#banner'); if (b && s.banner) b.src = bannerUrl(s.banner);
  document.title = document.title.replace('عقارات سوف', s.name);
}
applySite();

// نافذة سبب الإلغاء (اختيارية): تُرجع النص (قد يكون فارغاً) أو null عند التراجع
function askReason(title, hint = 'اكتب السبب الذي سيظهر للشخص (اختياري)') {
  return new Promise(resolve => {
    const t = h('textarea', { rows: 3, maxlength: 300, placeholder: hint, style: 'width:100%' });
    const m = h('div', { class: 'modal' }, h('div', { class: 'box', style: 'max-width:420px' },
      h('h3', {}, title), h('label', {}, 'السبب (اختياري)'), t,
      h('div', { style: 'display:flex;gap:8px;margin-top:12px' },
        h('button', { class: 'btn red', onclick: () => { m.remove(); resolve(t.value.trim()); } }, 'تأكيد'),
        h('button', { class: 'btn', onclick: () => { m.remove(); resolve(null); } }, 'تراجع'))));
    document.body.append(m); t.focus();
  });
}
const reasonLine = r => r ? `\nالسبب: ${r}\n` : ' ';
const clientCancelMsg = (o, r) => `السلام عليكم ${o.client_name}، نعتذر، تم إلغاء طلبك «${o.listing_title}» (${period(o)}).${reasonLine(r)}(عقارات سوف)`;
const ownerHideMsg = (l, r, rejected) => `السلام عليكم ${l.owner_name}، ${rejected ? 'نعتذر، لم يُقبل' : 'تم إخفاء'} عرضك «${l.title}».${reasonLine(r)}(عقارات سوف)`;
