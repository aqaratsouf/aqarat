const KINDS = {
  furnished: { tab: 'شقق مجهزة (باليوم)', unit: 'يوم', units: 'عدد الأيام', per: 'لليوم الواحد' },
  unfurnished: { tab: 'شقق غير مجهزة (بالشهر)', unit: 'شهر', units: 'عدد الأشهر', per: 'للشهر الواحد' },
};
const RELATIONS = ['زوجة', 'زوج', 'ابن', 'ابنة', 'أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'أخرى'];
let kind = null, me = null;
const app = $('#app');
const remember = k => { try { localStorage.setItem('aq_kind', k); } catch {} sb.auth.updateUser({ data: { pref_kind: k } }).catch(() => {}); };

function renderTabs() {
  const t = $('#tabs'); t.replaceChildren();
  for (const k of Object.keys(KINDS))
    t.append(h('button', { class: k === kind ? 'on' : '', onclick: () => { kind = k; remember(k); renderTabs(); load(); } }, KINDS[k].tab));
}

function chooseView() {
  app.replaceChildren(h('h2', {}, 'مرحباً ' + (userName(me) || '') + ' 👋'), h('div', { class: 'muted' }, 'ماذا تريد أن تكتري؟ (يُحفظ اختيارك في حسابك)'),
    h('div', { class: 'choose' },
      h('button', { class: 'pick', onclick: () => { kind = 'furnished'; remember(kind); listView(); } }, h('span', { class: 'ic' }, '🛏️'), h('b', {}, 'شقة مجهزة'), h('span', {}, 'كراء باليوم — للعلاج والسياحة')),
      h('button', { class: 'pick gold', onclick: () => { kind = 'unfurnished'; remember(kind); listView(); } }, h('span', { class: 'ic' }, '📅'), h('b', {}, 'شقة غير مجهزة'), h('span', {}, 'كراء بالشهر أو السنة'))));
}

function listView() {
  app.replaceChildren(h('div', { class: 'tabs', id: 'tabs' }), h('div', { class: 'grid', id: 'grid' }));
  renderTabs(); load();
  }

const STEP = o => o.status === 'cancelled' ? ['no', '❌ تم إلغاء الطلب']
  : o.paid ? ['done', '💰 تم تسليم المبلغ']
  : o.status === 'confirmed' ? ['go', '✅ تمت الموافقة — بانتظار تسليم المبلغ'] : ['wait', '⏳ طلبك قيد الانتظار (بانتظار التأكيد)'];
async function ordersView() {
  app.replaceChildren(h('div', { class: 'empty' }, 'جاري التحميل...'));
  try {
    const os = await rpc('my_orders');
    app.replaceChildren(h('h2', {}, 'طلباتي'), ...(os.length ? os.map(o => {
      const [cls, txt] = STEP(o);
      return h('div', { class: 'card pad' },
        h('div', {}, h('b', {}, o.listing_title + ' '), h('span', { class: 'step ' + cls }, txt)),
        h('div', { class: 'muted' }, '📍 ' + o.address),
        h('div', {}, period(o) + ' — ' + o.units + ' ' + unitWord(o)),
        h('div', {}, 'المبلغ الإجمالي: ', h('b', {}, money(o.total))),
        o.status === 'cancelled' && o.cancel_reason ? h('div', { class: 'note' }, 'سبب الإلغاء: ' + o.cancel_reason) : null,
        o.status === 'confirmed' && !o.paid ? h('div', { class: 'note' }, 'عليك الآن تسليم المبلغ الإجمالي للوسيط. بعد استلامه تظهر لك هنا بيانات صاحب الشقة للتواصل المباشر.') : null,
        o.paid ? h('div', { class: 'sum' }, h('div', {}, h('span', {}, 'صاحب الشقة'), h('span', {}, o.owner_name)),
          h('div', {}, h('span', {}, 'هاتفه'), h('a', { class: 'link', href: 'tel:' + o.owner_phone }, o.owner_phone))) : null);
    }) : [h('div', { class: 'empty' }, 'لم تقدّم أي طلب بعد.')]));
  } catch (e) { app.replaceChildren(h('div', { class: 'empty' }, e.message)); }
}

requireAuth(app, { title: 'ابحث عن شقة للكراء', sub: 'سجّل دخولك أو أنشئ حساباً لتتصفح الشقق وتتابع طلباتك.' }, user => {
  me = user;
  setNav([['الشقق', '#', () => (kind ? listView() : chooseView())], ['طلباتي', '#', ordersView], ['الرئيسية', 'index.html'], ['خروج', '#', logout]]);
  let pref = (user.user_metadata || {}).pref_kind;
  try { pref = pref || localStorage.getItem('aq_kind'); } catch {}
  if (pref && KINDS[pref]) { kind = pref; listView(); } else chooseView();
  sideWorker();
});

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
  const today = iso(new Date());
  const furn = l.kind === 'furnished';
  const d1 = h('input', { type: 'date', min: today, required: true });
  const d2 = h('input', { type: 'date', min: today, required: furn });
  const units = h('input', { type: 'number', min: 1, max: 24, value: 1, required: !furn });
  const booked = h('div', { class: 'note', style: 'display:none' });
  const warn = h('div', { class: 'note', style: 'display:none;background:#fee2e2;color:#991b1b' });
  let ranges = [];
  rpc('public_booked_ranges', { p_listing: l.id }).then(r => {
    ranges = r || [];
    if (ranges.length) {
      booked.style.display = '';
      booked.replaceChildren('📅 تواريخ محجوزة مسبقاً: ', ...ranges.map(x => h('div', {}, 'من ' + fd(x.start_date) + ' إلى ' + fd(x.end_date))));
    }
    upd();
  }).catch(() => {});
  const range = () => {
    if (!d1.value) return null;
    if (furn) return d2.value && d2.value > d1.value ? [d1.value, d2.value, Math.round((new Date(d2.value) - new Date(d1.value)) / 864e5)] : null;
    const u = parseInt(units.value) || 0;
    return u >= 1 && u <= 24 ? [d1.value, addMonths(d1.value, u), u] : null;
  };
  const sum = h('div', { class: 'sum' });
  const comps = h('div');
  const name = h('input', { required: true, maxlength: 80, autocomplete: 'name', value: userName(me) });
  const tel = h('input', { type: 'tel', required: true, inputmode: 'tel', placeholder: '05XXXXXXXX', autocomplete: 'tel' });
  const agree = h('input', { type: 'checkbox', required: true });
  const btn = h('button', { class: 'btn pri', type: 'submit', style: 'width:100%;margin-top:8px' }, 'تأكيد طلب الحجز');

  function upd() {
    const r = range(), u = r ? r[2] : 0;
    const hit = r && ranges.find(x => x.start_date < r[1] && r[0] < x.end_date);
    warn.style.display = hit ? '' : 'none';
    if (hit) warn.textContent = '⛔ هذه التواريخ محجوزة للأسف (من ' + hit.start_date.split('-').reverse().join('/') + ' إلى ' + hit.end_date.split('-').reverse().join('/') + '). يرجى تغيير التاريخ.';
    sum.replaceChildren(...(r && !furn ? [h('div', {}, h('span', {}, 'تنتهي في'), h('span', {}, fd(r[1])))] : []),
      h('div', {}, h('span', {}, 'سعر ' + K.unit + ' واحد'), h('span', {}, money(l.client_price))),
      h('div', {}, h('span', {}, K.units), h('span', {}, u)),
      h('div', { class: 'tot' }, h('span', {}, 'السعر الإجمالي'), h('span', {}, money(l.client_price * u))));
  }
  [units, d1, d2].forEach(x => x.addEventListener('input', upd));
  d1.addEventListener('input', () => { if (d1.value) d2.min = addDays(d1.value, 1); });

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
    furn
      ? h('div', { class: 'row' }, h('div', {}, h('label', {}, 'من تاريخ (يوم/شهر/سنة)'), d1), h('div', {}, h('label', {}, 'إلى تاريخ (يوم/شهر/سنة)'), d2))
      : [h('label', {}, 'تاريخ بداية الكراء'), d1, h('label', {}, K.units), units],
    booked, warn, sum,
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
        listing_id: l.id, start_date: d1.value, end_date: furn ? d2.value : undefined, units: furn ? undefined : parseInt(units.value), client_name: name.value, client_phone: tel.value, companions } });
      form.replaceChildren(h('div', { class: 'sum' },
        h('h3', {}, '✅ تم استلام طلبك رقم ' + res.id),
        h('p', {}, 'من ' + fd(res.start_date) + ' إلى ' + fd(res.end_date)),
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


