const KINDS = {
  furnished: { tab: 'شقق مجهزة (باليوم)', unit: 'يوم', units: 'عدد الأيام', per: 'لليوم الواحد' },
  unfurnished: { tab: 'شقق غير مجهزة (بالشهر)', unit: 'شهر', units: 'عدد الأشهر', per: 'للشهر الواحد' },
};
const RELATIONS = ['زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'أخرى'];
let kind = 'furnished';

function renderTabs() {
  const t = $('#tabs'); t.replaceChildren();
  for (const k of Object.keys(KINDS))
    t.append(h('button', { class: k === kind ? 'on' : '', onclick: () => { kind = k; renderTabs(); load(); } }, KINDS[k].tab));
}

async function load() {
  const g = $('#grid'); g.replaceChildren(h('div', { class: 'empty' }, 'جاري التحميل...'));
  try {
    const list = await rpc('public_listings', { p_kind: kind });
    g.replaceChildren();
    if (!list.length) g.append(h('div', { class: 'empty' }, 'لا توجد عروض حالياً في هذا القسم.'));
    for (const l of list) {
      const first = l.photos[0];
      g.append(h('div', { class: 'card', style: 'cursor:pointer', onclick: () => openListing(l) },
        first ? h('img', { class: 'ph', loading: 'lazy', alt: l.title, src: photoUrl(first.file) }) : h('div', { class: 'ph' }),
        h('div', { class: 'body' },
          h('div', { style: 'font-weight:700' }, l.title),
          h('div', { class: 'muted' }, '📍 ' + l.address),
          h('div', { class: 'price' }, money(l.client_price) + ' / ' + KINDS[l.kind].unit))));
    }
  } catch (e) { g.replaceChildren(h('div', { class: 'empty' }, e.message)); }
}

function openListing(l) {
  const K = KINDS[l.kind];
  const main = h('img', { class: 'main', alt: '' });
  const cap = h('div', { class: 'muted' });
  const thumbs = h('div', { class: 'thumbs' });
  function show(i) {
    main.src = photoUrl(l.photos[i].file); cap.textContent = l.photos[i].label;
    [...thumbs.children].forEach((t, j) => t.classList.toggle('on', j === i));
  }
  l.photos.forEach((p, i) => thumbs.append(h('img', { src: photoUrl(p.file), alt: p.label, onclick: () => show(i) })));
  if (l.photos.length) show(0);

  // ----- نموذج الحجز (بدون أي وثائق) -----
  const units = h('input', { type: 'number', min: 1, max: l.kind === 'furnished' ? 365 : 24, value: 1, required: true });
  const sum = h('div', { class: 'sum' });
  const comps = h('div');
  const name = h('input', { required: true, maxlength: 80, autocomplete: 'name' });
  const tel = h('input', { type: 'tel', required: true, inputmode: 'tel', placeholder: '05XXXXXXXX', autocomplete: 'tel' });
  const agree = h('input', { type: 'checkbox', required: true });
  const btn = h('button', { class: 'btn pri', type: 'submit', style: 'width:100%;margin-top:8px' }, 'تأكيد طلب الحجز');

  function upd() {
    const u = Math.max(0, parseInt(units.value) || 0);
    sum.replaceChildren(
      h('div', {}, h('span', {}, 'سعر ' + K.unit + ' واحد'), h('span', {}, money(l.client_price))),
      h('div', {}, h('span', {}, K.units), h('span', {}, u)),
      h('div', { class: 'tot' }, h('span', {}, 'السعر الإجمالي'), h('span', {}, money(l.client_price * u))));
  }
  units.addEventListener('input', upd);

  function addComp() {
    const c = h('div', { class: 'comp' },
      h('div', { class: 'row' },
        h('div', {}, h('label', {}, 'الاسم'), h('input', { 'data-f': 'name', required: true, maxlength: 40 })),
        h('div', {}, h('label', {}, 'اللقب'), h('input', { 'data-f': 'surname', required: true, maxlength: 40 }))),
      h('label', {}, 'صفة القرابة'),
      h('select', { 'data-f': 'relation' }, RELATIONS.map(r => h('option', { value: r }, r))),
      h('button', { type: 'button', class: 'btn red sm', style: 'margin-top:8px', onclick: () => c.remove() }, 'حذف المرافق'));
    comps.append(c);
  }

  const form = h('form', {},
    h('h3', {}, 'احجز هذه الشقة'),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'الاسم واللقب'), name),
      h('div', {}, h('label', {}, 'رقم الهاتف'), tel)),
    h('label', {}, K.units), units, sum,
    h('h4', {}, 'المرافقون'),
    h('div', { class: 'muted' }, 'أضف كل شخص سيقيم معك، مع اسمه ولقبه وصفة قرابته.'),
    comps,
    h('button', { type: 'button', class: 'btn sm', onclick: addComp }, '+ إضافة مرافق'),
    h('div', { class: 'note' }, '⚠️ عليك الحفاظ على سلامة ونظافة الشقة وتجهيزاتها. نحن غير مسؤولين عمّا يترتب بينك وبين صاحب الشقة.'),
    h('label', { style: 'font-weight:400' }, agree, ' قرأت الملاحظة وأوافق عليها'),
    btn);
  upd();

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    btn.disabled = true; btn.textContent = 'جاري الإرسال...';
    try {
      const companions = [...comps.children].map(c => {
        const g = f => c.querySelector(`[data-f=${f}]`).value;
        return { name: g('name'), surname: g('surname'), relation: g('relation') };
      });
      const res = await rpc('create_order', { p: {
        listing_id: l.id, units: parseInt(units.value), client_name: name.value, client_phone: tel.value, companions } });
      form.replaceChildren(h('div', { class: 'sum' },
        h('h3', {}, '✅ تم استلام طلبك رقم ' + res.id),
        h('p', {}, 'المبلغ الإجمالي: ' + money(res.total)),
        h('p', {}, 'سنتصل بك قريباً على الرقم ' + tel.value + ' لتأكيد الحجز.')));
    } catch (e) { toast(e.message, false); btn.disabled = false; btn.textContent = 'تأكيد طلب الحجز'; }
  });

  const modal = $('#modal');
  const close = () => { modal.replaceChildren(); document.body.style.overflow = ''; };
  document.body.style.overflow = 'hidden';
  modal.replaceChildren(h('div', { class: 'modal', onclick: e => { if (e.target.classList.contains('modal')) close(); } },
    h('div', { class: 'box' },
      h('button', { class: 'btn sm x', onclick: close }, '✕ إغلاق'),
      h('h2', {}, l.title),
      h('div', { class: 'gal' }, main, cap, thumbs),
      h('div', { class: 'price' }, money(l.client_price) + ' ' + K.per),
      h('p', {}, l.description),
      h('div', { class: 'muted' }, '📍 ' + l.address), mapEmbed(l), mapLink(l),
      h('hr'), form)));
}

renderTabs(); load();
