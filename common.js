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
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
// المبلغ معزول بالكامل (LRI..PDI) كي لا يغيّر النص العربي ترتيب أرقامه أبداً
const money = n => '\u2066' + fmt(n) + '\u00A0DA' + '\u2069';
const fdate = t => '\u2066' + new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '\u2069';
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
