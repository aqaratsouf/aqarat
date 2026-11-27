const LABELS = ['غرفة نوم', 'صالون', 'مطبخ', 'حمام', 'مدخل / واجهة', 'أخرى'];
let RATE = 10, lat = null, lng = null;
const rowsBox = h('div');

const kindSel = h('select', {}, h('option', { value: 'furnished' }, 'شقة مجهزة — كراء باليوم'), h('option', { value: 'unfurnished' }, 'شقة غير مجهزة — كراء بالشهر'));
const title = h('input', { required: true, maxlength: 80, placeholder: 'مثال: شقة F3 مجهزة قرب وسط المدينة' });
const desc = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'عدد الغرف، الطابق، التجهيزات، التكييف...' });
const oname = h('input', { required: true, maxlength: 80, autocomplete: 'name' });
const ophone = h('input', { type: 'tel', required: true, inputmode: 'tel', placeholder: '05XXXXXXXX' });
const addr = h('input', { required: true, maxlength: 200, placeholder: 'الحي / الشارع / أقرب معلم' });
const mapurl = h('input', { type: 'url', maxlength: 500, placeholder: 'رابط Google Maps (اختياري)' });
const locBtn = h('button', { type: 'button', class: 'btn sm' }, '📍 استخدم موقعي الحالي (وأنت داخل الشقة)');
const locInfo = h('span', { class: 'muted', style: 'margin-inline-start:8px' });
const price = h('input', { type: 'number', min: 1, required: true, placeholder: 'مثال: 5000' });
const priceLabel = h('label', {});
const preview = h('div', { class: 'sum' });
const agree = h('input', { type: 'checkbox', required: true });
const btn = h('button', { class: 'btn pri', type: 'submit', style: 'width:100%;margin-top:8px' }, 'إرسال العرض');

function unitWord() { return kindSel.value === 'furnished' ? 'اليوم' : 'الشهر'; }
function upd() {
  priceLabel.textContent = `سعر الكراء المطلوب (DA) في ${unitWord()}`;
  const p = parseInt(price.value) || 0, fee = withRate(p, RATE) - p;
  preview.replaceChildren(
    h('div', { class: 'row-sum' }, h('span', {}, 'سعرك (يصلك كاملاً)'), h('b', {}, money(p))),
    h('div', { class: 'row-sum plus' }, h('span', {}, `+ مبلغ الوسيط (${RATE}%)`), h('b', {}, money(fee))),
    h('div', { class: 'row-sum total' }, h('span', {}, '= المجموع للزبون'), h('b', {}, money(p + fee))));
}
price.addEventListener('input', upd); kindSel.addEventListener('change', upd);

locBtn.onclick = () => {
  if (!navigator.geolocation) return toast('المتصفح لا يدعم تحديد الموقع', false);
  locInfo.textContent = 'جاري التحديد...';
  navigator.geolocation.getCurrentPosition(p => { lat = p.coords.latitude; lng = p.coords.longitude; locInfo.textContent = '✅ تم حفظ الموقع'; },
    () => { locInfo.textContent = ''; toast('تعذر تحديد الموقع. يمكنك لصق رابط الخريطة بدلاً من ذلك.', false); }, { enableHighAccuracy: true, timeout: 15000 });
};

function addPhoto() {
  const sel = h('select', {}, LABELS.map(l => h('option', { value: l }, l)));
  const file = h('input', { type: 'file', accept: 'image/*', required: true });
  const row = h('div', { class: 'photos-row' }, sel, file,
    h('button', { type: 'button', class: 'btn red sm', onclick: () => row.remove() }, '✕'));
  row._get = () => ({ sel, file });
  rowsBox.append(row);
}
addPhoto();

const form = $('#f');
form.append(
  h('label', {}, 'نوع الشقة'), kindSel,
  h('label', {}, 'عنوان العرض'), title,
  h('label', {}, 'وصف الشقة'), desc,
  h('div', { class: 'row' }, h('div', {}, h('label', {}, 'اسمك واللقب'), oname), h('div', {}, h('label', {}, 'رقم هاتفك'), ophone)),
  h('div', { class: 'muted' }, '🔒 رقم هاتفك لا يظهر للزبائن أبداً.'),
  h('label', {}, 'موقع الشقة'), addr, h('div', { style: 'margin:6px 0' }, locBtn, locInfo), mapurl,
  priceLabel, price, preview,
  h('h4', {}, 'صور الشقة'),
  h('div', { class: 'muted' }, 'أضف صوراً للغرف والمطبخ والحمام (صورة واحدة على الأقل، حتى 20).'),
  rowsBox,
  h('button', { type: 'button', class: 'btn sm', onclick: () => rowsBox.children.length < 20 && addPhoto() }, '+ إضافة صورة'),
  h('div', { class: 'note' }, '⚠️ نحن غير مسؤولين عمّا يقوم به الزبون داخل الشقة، ولا نتولى مراقبة سلامتها أو نظافتها. عليك تنبيه الزبون بنفسك إلى طلباتك الخاصة، مثل المحافظة على سلامة الشقة ونظافتها.'),
  h('label', { style: 'font-weight:400' }, agree, ' قرأت الملاحظة وأوافق عليها'),
  btn);

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  btn.disabled = true; btn.textContent = 'جاري رفع الصور...';
  try {
    const photos = [];
    for (const r of rowsBox.children) {
      const { sel, file } = r._get();
      photos.push({ label: sel.value, file: await uploadTo('listing-photos', file.files[0]) });
    }
    await rpc('submit_listing', { p: {
      kind: kindSel.value, title: title.value, description: desc.value, owner_name: oname.value, owner_phone: ophone.value,
      address: addr.value, lat, lng, map_url: mapurl.value, price: parseInt(price.value), photos } });
    form.replaceChildren(h('div', { class: 'sum' }, h('h3', {}, '✅ تم استلام عرضك'),
      h('p', {}, 'سنراجعه ثم ننشره، وسنتصل بك على الرقم ' + ophone.value + ' عند وجود طلب.'),
      h('a', { class: 'btn pri', href: 'index.html' }, 'العودة للموقع')));
  } catch (e) { toast(e.message, false); btn.disabled = false; btn.textContent = 'إرسال العرض'; }
});

rpc('get_rate').then(r => { RATE = Number(r); upd(); }).catch(upd);
upd();
