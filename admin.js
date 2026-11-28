const TABS = { orders: 'الطلبات', listings: 'العروض', users: 'المستخدمون', apps: 'طلبات العمل', workers: 'العمال', settings: 'الإعدادات' };
const ST = { new: 'جديد', confirmed: 'مؤكد', paid: 'مدفوع', cancelled: 'ملغى', pending: 'بانتظار المراجعة', active: 'منشور', hidden: 'مخفي' };
const KL = { furnished: 'مجهزة (باليوم)', unfurnished: 'غير مجهزة (بالشهر)' };
const app = $('#app');
let tab = 'orders', ofilter = 'new';

const tel = p => h('a', { href: 'tel:' + p, class: 'link' }, p);
const kv = pairs => h('div', { class: 'kv' }, pairs.map(([k, v]) => [h('b', {}, k), h('span', {}, v)]));
const cutFor = (o, ratePct) => Math.min(Math.floor(o.owner_total * ratePct / 100 + 0.5), o.commission);

function loginView() {
  $('#nav').replaceChildren();
  const em = h('input', { type: 'email', required: true, autocomplete: 'username' });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const f = h('form', { class: 'card pad', style: 'max-width:380px;margin:40px auto' },
    h('h3', {}, 'تسجيل الدخول'), h('label', {}, 'البريد الإلكتروني'), em, h('label', {}, 'كلمة المرور'), pw,
    h('button', { class: 'btn pri', style: 'width:100%;margin-top:12px' }, 'دخول'));
  f.onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: em.value.trim(), password: pw.value });
    if (error) return toast('البريد أو كلمة المرور غير صحيحة', false);
    if (!(await rpc('am_i_admin'))) { await sb.auth.signOut(); return toast('هذا الحساب ليس حساب المدير', false); }
    boot();
  };
  app.replaceChildren(f);
}

function nav() {
  $('#nav').replaceChildren(
    ...Object.entries(TABS).map(([k, v]) => h('a', { href: '#', style: k === tab ? 'background:#fff;color:#0f766e' : '', onclick: e => { e.preventDefault(); tab = k; render(); } }, v)),
    h('a', { href: '#', onclick: async e => { e.preventDefault(); await sb.auth.signOut(); loginView(); } }, 'خروج'));
}

async function render() {
  nav();
  app.replaceChildren(h('div', { class: 'empty' }, 'جاري التحميل...'));
  try { app.replaceChildren(await ({ orders: ordersView, listings: listingsView, users: usersView, apps: appsView, workers: workersView, settings: settingsView })[tab]()); }
  catch (e) { app.replaceChildren(h('div', { class: 'empty' }, e.message)); }
}

async function act(fn, msg) { try { await fn(); if (msg) toast(msg); render(); } catch (e) { toast(e.message, false); } }

// ---------------- الطلبات ----------------
async function ordersView() {
  const [orders, workers] = await Promise.all([
    ok(sb.from('orders').select('*, workers(name, phone)').order('id', { ascending: false })),
    ok(sb.from('workers').select('*').order('id', { ascending: false }))]);
  const active = workers.filter(w => w.active);
  const cancelOrder = async (o, title) => {
    const r = await askReason(title);
    if (r === null) return;
    await act(() => rpc('admin_cancel_order', { p_order: o.id, p_reason: r }), 'تم الإلغاء');
    showMsgs('أبلغ الزبون بالإلغاء', [['💬 أبلغ الزبون', wa(o.client_phone, clientCancelMsg(o, r))]]);
  };
  const bucket = o => o.status === 'confirmed' ? (o.paid ? 'paid' : 'confirmed') : o.status;
  const conf = orders.filter(o => o.status === 'confirmed' && o.paid);
  const waiting = orders.filter(o => o.status === 'confirmed' && !o.paid);
  const root = h('div');
  root.append(h('div', { class: 'sum' },
    h('div', {}, h('span', {}, 'كراءات تم استلام مبلغها'), h('span', {}, conf.length)),
    h('div', {}, h('span', {}, 'مؤكدة وبانتظار تسليم المبلغ'), h('span', {}, waiting.length + ' (' + money(waiting.reduce((a, o) => a + o.total, 0)) + ')')),
    h('div', {}, h('span', {}, 'إجمالي ما استلمته من الزبائن'), h('span', {}, money(conf.reduce((a, o) => a + o.total, 0)))),
    h('div', { class: 'tot' }, h('span', {}, 'إجمالي فائدتي الصافية'), h('span', {}, money(conf.reduce((a, o) => a + o.profit, 0))))));
  root.append(h('div', { class: 'tabs' }, Object.entries({ new: 'الجديدة', confirmed: 'بانتظار المبلغ', paid: 'المستلمة', cancelled: 'الملغاة' }).map(([k, v]) =>
    h('button', { class: ofilter === k ? 'on' : '', onclick: () => { ofilter = k; render(); } }, `${v} (${orders.filter(o => bucket(o) === k).length})`))));
  const list = orders.filter(o => bucket(o) === ofilter);
  if (!list.length) root.append(h('div', { class: 'empty' }, 'لا توجد طلبات.'));
  const tbody = h('tbody');
  for (const o of list) {
    const unit = o.kind === 'furnished' ? 'يوم' : 'شهر';
    const profitSpan = h('span', { class: 'profit' }, money(o.status === 'confirmed' ? o.profit : o.commission));
    const card = h('div', { class: 'pad', style: 'position:sticky;inset-inline-start:0;width:calc(100vw - 40px);max-width:640px;box-sizing:border-box' },
      o.companions.length ? h('div', {}, h('b', {}, `المرافقون (${o.companions.length}):`),
        o.companions.map(c => h('div', {}, `${c.name} ${c.surname} — ${c.relation}`))) : h('div', { class: 'muted' }, 'بدون مرافقين'),
      o.status === 'confirmed' ? h('div', { class: 'muted' }, 'العامل: ' + (o.workers ? `${o.workers.name} (حصته ${money(o.worker_cut)})` : 'بدون عامل')) : null);
    if (o.status === 'confirmed') {
      const wrap = h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' });
      if (!o.paid) {
        wrap.append(h('button', { class: 'btn pri', onclick: async () => {
          if (!confirm('تأكيد أن الزبون سلّمك المبلغ؟ سيُحتسب في حساباتك.')) return;
          try {
            await rpc('admin_set_paid', { p_order: o.id, p_paid: true });
            toast('تم تسجيل استلام المبلغ');
            showMsgs('تم استلام المبلغ — أبلغ الطرفين', [['💬 أبلغ الزبون (مع رقم صاحب الشقة)', wa(o.client_phone, clientPaidMsg(o))], ['💬 أبلغ صاحب الشقة', wa(o.owner_phone, ownerMsg(o, true))]]);
          } catch (e) { toast(e.message, false); }
          render();
        } }, '💰 الزبون سلّم المبلغ'),
          h('button', { class: 'btn red', onclick: () => cancelOrder(o, 'إلغاء هذا الحجز المؤكد وتحرير تواريخه') }, 'إلغاء الحجز'));
      } else {
        wrap.append(h('div', { class: 'muted', style: 'width:100%' }, 'استُلم المبلغ: ' + fdate(o.paid_at)),
          waBtn('💬 أعد إرسال رقم المالك للزبون', wa(o.client_phone, clientPaidMsg(o)), 'btn pri sm'),
          h('button', { class: 'btn sm', onclick: () => confirm('التراجع عن حالة الاستلام؟ سيُخصم من حساباتك.') && act(() => rpc('admin_set_paid', { p_order: o.id, p_paid: false }), 'تم التراجع') }, 'تراجع عن الاستلام'),
          h('button', { class: 'btn red sm', onclick: async () => {
            const r = await askReason('التراجع وإلغاء الطلب (تُلغى فوائده)'); if (r === null) return;
            await act(() => rpc('admin_revert_paid', { p_order: o.id, p_reason: r }), 'أُلغي الطلب وفوائده');
            showMsgs('أبلغ الزبون وصاحب الشقة', [['💬 أبلغ الزبون', wa(o.client_phone, clientCancelMsg(o, r))], ['💬 أبلغ صاحب الشقة', wa(o.owner_phone, `السلام عليكم ${o.owner_name}، تم إلغاء حجز «${o.listing_title}» (${period(o)}).${reasonLine(r)}(عقارات سوف)`)]]);
          } }, '↩️ تراجع وإلغاء الطلب'));
      }
      wrap.append(waBtn('💬 إبلاغ صاحب الشقة', wa(o.owner_phone, ownerMsg(o, o.paid))));
      if (o.workers) wrap.append(waBtn('💬 تفاصيل للعامل', wa(o.workers.phone, `طلب #${o.id}: ${o.listing_title} — ${o.address} — ${period(o)} — الزبون ${o.client_name} ${o.client_phone}`)));
      card.append(h('hr'), wrap);
    }
    if (o.status === 'new') {
      const ws = h('select', {}, h('option', { value: '' }, 'بدون عامل (الفائدة كاملة لي)'),
        active.map(w => h('option', { value: w.id }, `${w.name} — ${w.rate_pct}%`)));
      ws.onchange = () => {
        const w = active.find(x => String(x.id) === ws.value);
        profitSpan.textContent = money(o.commission - (w ? cutFor(o, w.rate_pct) : 0));
      };
      if (o.workers) card.append(h('div', { class: 'note' }, '📤 مُسند إلى العامل: ' + o.workers.name + ' — ينتظر تأكيده.',
        h('div', { style: 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap' }, waBtn('💬 ذكّره', wa(o.workers.phone, `تذكير: لديك مهمة طلب #${o.id} — ${o.listing_title}. صفحتك: ${workerLink()} (عقارات سوف)`)),
          h('button', { class: 'btn sm', onclick: () => act(() => rpc('admin_assign_order', { p_order: o.id, p_worker: null }), 'أُلغي الإسناد') }, 'إلغاء الإسناد'))));
      card.append(h('hr'), h('label', {}, 'العامل (لإسناد الطلب له، أو لاحتساب حصته إن أكّدت بنفسك)'), ws,
        h('div', { style: 'display:flex;gap:8px;margin-top:10px' },
          h('button', { class: 'btn pri', onclick: async () => {
            if (!confirm('تأكيد أن عملية الكراء تمت؟')) return;
            try {
              await rpc('admin_confirm_order', { p_order: o.id, p_worker: ws.value ? +ws.value : null });
              toast('تم تأكيد الكراء'); render();
              showMsgs('تم التأكيد — أبلغ الطرفين', [['💬 أبلغ صاحب الشقة', wa(o.owner_phone, ownerMsg(o, false))], ['💬 أبلغ الزبون', wa(o.client_phone, clientApprovedMsg(o))]]);
            } catch (e) { toast(e.message, false); }
          } }, '✅ تأكيد بنفسي'),
          h('button', { class: 'btn', onclick: async () => {
            if (!ws.value) return toast('اختر العامل أولاً', false);
            try {
              await rpc('admin_assign_order', { p_order: o.id, p_worker: +ws.value });
              toast('تم إسناد الطلب للعامل'); render();
              const w = active.find(x => String(x.id) === ws.value);
              showMsgs('أبلغ العامل بمهمته', [['💬 أبلغ ' + w.name, wa(w.phone, `السلام عليكم ${w.name}، لديك مهمة جديدة: طلب #${o.id} — ${o.listing_title} (${period(o)}). ادخل صفحتك لدراسته: ${workerLink()} (عقارات سوف)`)]]);
            } catch (e) { toast(e.message, false); }
          } }, '📤 إسناد للعامل'),
          h('button', { class: 'btn red', onclick: () => cancelOrder(o, 'إلغاء الطلب') }, 'إلغاء الطلب')));
    }
    card.append(h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn red sm', onclick: () => confirm('حذف هذا الطلب نهائياً؟ سيُمحى كأنه لم يحدث، ويُسحب من الحسابات والتواريخ المحجوزة، ويُعاد استخدام رقمه.') && act(() => rpc('admin_delete_order', { p_order: o.id }), 'تم حذف الطلب نهائياً') }, '🗑️ حذف نهائي')));
    const det = h('tr', { style: o.status === 'new' ? '' : 'display:none' }, h('td', { colspan: 14, style: 'background:#f6faf9' }, card));
    const stBadge = h('span', { class: 'badge ' + (o.paid ? 'active' : o.status) }, o.paid ? '💰 مدفوع' : o.status === 'confirmed' ? '✅ مؤكد — لم يُسلَّم' : ST[o.status]);
    tbody.append(h('tr', {},
      h('td', {}, '#' + o.id, h('div', { class: 'muted', style: 'font-size:11px' }, fdate(o.created_at))),
      h('td', {}, h('b', {}, o.client_name), h('div', {}, tel(o.client_phone))),
      h('td', {}, o.listing_title, h('div', { class: 'muted', style: 'font-size:12px' }, `${KL[o.kind]} — ${o.address}`)),
      h('td', {}, `${o.units} ${unit}`),
      h('td', {}, h('div', {}, 'من ' + fd(o.start_date)), h('div', {}, 'إلى ' + fd(o.end_date))),
      h('td', {}, money(o.total)),
      h('td', {}, money(o.owner_total)),
      h('td', {}, money(o.commission), h('div', { class: 'muted', style: 'font-size:11px' }, o.rate_pct + '%')),
      h('td', {}, o.workers ? o.workers.name : h('span', { class: 'muted' }, o.status === 'cancelled' ? '—' : 'بدون عامل')),
      h('td', {}, o.workers && o.status !== 'cancelled'
        ? [money(o.status === 'new' ? cutFor(o, active.find(w => w.id === o.worker_id)?.rate_pct || 0) : o.worker_cut), o.status === 'new' ? h('div', { class: 'muted', style: 'font-size:11px' }, 'متوقعة') : null]
        : h('span', { class: 'muted' }, '—')),
      h('td', {}, o.owner_name, h('div', {}, tel(o.owner_phone))),
      h('td', {}, profitSpan),
      h('td', {}, stBadge),
      h('td', {}, h('button', { class: 'btn sm', onclick: () => { det.style.display = det.style.display === 'none' ? '' : 'none'; } }, 'إجراءات ▾'))));
    tbody.append(det);
  }
  if (list.length) root.append(h('div', { style: 'overflow-x:auto' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['رقم', 'الزبون', 'العرض', 'المدة', 'تاريخ الحجز', 'الإجمالي (يدفعه الزبون)', 'لصاحب الشقة', 'العمولة', 'العامل المكلّف', 'حصة العامل', 'صاحب الشقة', 'فائدتي', 'الحالة', ''].map(x => h('th', {}, x)))), tbody)));
  return root;
}

// ---------------- العروض ----------------
function listingOwnerMsg(l) {
  const link = new URL('status.html?t=' + l.track_token, location.href).href;
  const intl = l.owner_phone.startsWith('0') ? '213' + l.owner_phone.slice(1) : l.owner_phone.replace('+', '');
  const txt = `السلام عليكم، بخصوص عرضك (${l.title}). تتابع حالته من هذا الرابط الخاص: ${link}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(txt)}`;
}
async function listingsView() {
  const [ls, rate] = await Promise.all([ok(sb.from('listings').select('*').order('id', { ascending: false })), rpc('get_rate')]);
  const setStatus = (id, status, msg) => act(() => rpc('admin_set_listing_status', { p_listing: id, p_status: status }), msg);
  const hide = async (l, rejected) => {
    const r = await askReason(rejected ? 'رفض هذا العرض' : 'إخفاء هذا العرض');
    if (r === null) return;
    await act(() => rpc('admin_set_listing_status', { p_listing: l.id, p_status: 'hidden', p_reason: r }), rejected ? 'تم رفض العرض' : 'تم إخفاء العرض');
    showMsgs('أبلغ صاحب الشقة', [['💬 أبلغ صاحب الشقة', wa(l.owner_phone, ownerHideMsg(l, r, rejected))]]);
  };
  const del = async l => {
    if (!confirm('حذف العرض نهائياً؟ لن يظهر لأحد ولن يبقى له أثر، وسيُعاد استخدام رقمه.')) return;
    const withOrders = confirm('هل تحذف معه كل الطلبات المرتبطة به (كأن شيئاً لم يحدث)؟\nموافق = احذفها أيضاً · إلغاء = أبقِ الطلبات في السجل');
    await act(async () => {
      const photos = await rpc('admin_delete_listing', { p_listing: l.id, p_with_orders: withOrders });
      await sb.storage.from('listing-photos').remove((photos || []).map(p => p.file)); // تنظيف الصور (لا يمنع الحذف إن فشل)
    }, 'تم الحذف نهائياً');
  };
  const root = h('div');
  if (!ls.length) root.append(h('div', { class: 'empty' }, 'لا توجد عروض.'));
  const grid = h('div', { class: 'grid' });
  for (const l of ls) {
    grid.append(h('div', { class: 'card' },
      l.photos[0] ? h('img', { class: 'ph', loading: 'lazy', alt: '', src: photoUrl(l.photos[0].file) }) : null,
      h('div', { class: 'body' },
        h('div', {}, h('b', {}, l.title + ' '), h('span', { class: 'badge ' + l.status }, ST[l.status])),
        h('div', { class: 'muted' }, KL[l.kind] + ' — ' + l.address),
        kv([['المالك', l.owner_name], ['هاتفه', tel(l.owner_phone)], ['سعره', money(l.price)], ['سعر الزبون', money(withRate(l.price, Number(rate)))], ['الصور', l.photos.length]]),
        h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' },
          l.status !== 'active' ? h('button', { class: 'btn pri sm', onclick: () => setStatus(l.id, 'active', 'تم النشر') }, 'نشر') : null,
          l.status === 'active' ? h('button', { class: 'btn sm', onclick: () => hide(l, false) }, 'إخفاء') : null,
          l.status === 'pending' ? h('button', { class: 'btn red sm', onclick: () => hide(l, true) }, '❌ رفض') : null,
          h('a', { class: 'btn sm', style: 'text-decoration:none', target: '_blank', rel: 'noopener', href: listingOwnerMsg(l) }, '💬 واتساب للمالك'),
          h('button', { class: 'btn red sm', onclick: () => del(l) }, '🗑️ حذف نهائي')))));
  }
  root.append(grid);
  return root;
}

// ---------------- المستخدمون (زبائن وأصحاب شقق) ----------------
const ORD_ST = o => o.status === 'cancelled' ? 'ملغى' : o.paid ? 'تم تسليم المبلغ' : o.status === 'confirmed' ? 'مؤكد' : 'قيد الانتظار';
async function usersView() {
  const us = await rpc('admin_users');
  const root = h('div'), body = h('tbody');
  const q = h('input', { placeholder: '🔎 بحث بالاسم أو الهاتف أو البريد', style: 'margin-bottom:8px' });
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    body.replaceChildren();
    const list = us.filter(u => !t || (u.full_name + ' ' + u.phone + ' ' + u.email).toLowerCase().includes(t));
    if (!list.length) body.append(h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'لا يوجد مستخدمون.')));
    for (const u of list) {
      const det = h('tr', { style: 'display:none' }, h('td', { colspan: 5 }, 'جاري التحميل...'));
      const tags = [u.is_worker ? '👷 عامل' : null, u.listings ? `🏢 صاحب شقة (${u.listings} عرض)` : null,
        u.requests ? `🔑 استأجر ${u.rentals} مرة من ${u.requests} طلب` : null].filter(Boolean);
      body.append(h('tr', { style: u.banned ? 'opacity:.6' : '' },
        h('td', {}, h('b', {}, u.full_name || '—'), u.banned ? h('div', { class: 'badge cancelled' }, 'محظور') : null),
        h('td', {}, u.phone ? h('a', { class: 'link', href: 'tel:' + u.phone }, u.phone) : '—'),
        h('td', { dir: u.email ? 'ltr' : 'rtl', style: 'font-size:12px' }, u.email || 'بدون حساب (سجل قديم)'),
        h('td', {}, tags.length ? tags.map(x => h('div', {}, x)) : '—'),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'btn sm', onclick: async () => {
            if (det.style.display !== 'none') return (det.style.display = 'none');
            det.style.display = '';
            try {
              const d = await rpc('admin_user_detail', { p_user: u.user_id, p_phone: u.phone || null });
              const money2 = (lbl, v, cls) => h('div', {}, lbl + ': ', h('b', { class: cls || '' }, money(v)));
              const split = x => h('div', { style: 'margin-top:4px;padding-inline-start:10px;border-inline-start:3px solid #b7d3cf' },
                money2(x.paid ? 'استلمه صاحب الشقة' : 'مستحق لصاحب الشقة (لم يُسلَّم بعد)', x.owner_total),
                money2('عمولتنا الإجمالية', x.commission),
                money2('حصة العامل' + (x.worker ? ' (' + x.worker + ')' : ''), x.worker_cut || 0),
                money2('فائدة المدير الصافية', x.profit == null ? x.commission : x.profit, 'profit'),
                h('div', {}, 'العامل المكلّف: ', h('b', {}, x.worker || 'بدون عامل')));
              const box = (title, st, body) => h('div', { style: 'background:#fff;border:1px solid #d8e6e4;border-radius:10px;padding:8px 10px;margin:6px 0;white-space:normal' }, h('b', {}, title), ' ', st ? h('span', { class: 'muted' }, st) : null, body);
              det.firstChild.replaceChildren(h('div', { style: 'position:sticky;inset-inline-start:0;width:calc(100vw - 52px);max-width:640px;white-space:normal' },
                h('h4', { style: 'margin:4px 0' }, '🔑 ما استأجره'),
                ...(d.orders.length ? d.orders.map(o => box(`#${o.id} ${o.title}`, `${fd(o.start)} ← ${fd(o.end)} — ${ORD_ST(o)}`,
                  h('div', {}, money2('دفع الزبون (الإجمالي)', o.total), o.status === 'cancelled' ? null : split(o)))) : [h('div', { class: 'muted' }, 'لا شيء')]),
                h('h4', { style: 'margin:10px 0 4px' }, '🏢 عروضه'),
                ...(d.listings.length ? d.listings.map(l => box(`#${l.id} ${l.title}`, `${money(l.price)} — ${ST[l.status] || l.status}`,
                  l.bookings.length ? h('div', {}, ...l.bookings.map(b => h('div', { style: 'margin-top:6px' }, `حجز #${b.id} — ${b.client} — ${fd(b.start)} ← ${fd(b.end)}`, split(b)))) : h('div', { class: 'muted' }, 'لا حجوزات مؤكدة'))) : [h('div', { class: 'muted' }, 'لا شيء')])));
            } catch (e) { det.firstChild.textContent = e.message; }
          } }, 'التفاصيل'),
          ' ',
          h('button', { class: 'btn sm ' + (u.banned ? 'pri' : 'red'), onclick: () => confirm(u.banned ? 'فك الحظر عن هذا الشخص؟' : 'حظر هذا الشخص؟ لن يستطيع الحجز أو إضافة عروض (حتى برقم هاتفه)، وتختفي عروضه من الموقع حتى فك الحظر.') && act(() => rpc('admin_set_ban', { p_user: u.user_id, p_ban: !u.banned, p_phone: u.phone || null }), u.banned ? 'تم فك الحظر' : 'تم الحظر') }, u.banned ? 'فك الحظر' : '🚫 حظر'))));
      body.append(det);
    }
  };
  q.oninput = draw; draw();
  root.append(h('div', { class: 'note' }, `عدد المسجّلين: ${us.length}. ملاحظة: حظر العامل يوقف حسابه، وعند فك الحظر فعّله من تبويب «العمال».`), q,
    h('div', { style: 'overflow-x:auto' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['الاسم واللقب', 'الهاتف', 'البريد', 'الوضعية', 'إجراءات'].map(x => h('th', {}, x)))), body)));
  return root;
}

// مفتاح استقبال طلبات العمل (يظهر في تبويب الطلبات والإعدادات)
async function appsSwitch() {
  const open = await workerAppsOpen();
  const sw = h('input', { type: 'checkbox' }); sw.checked = !!open;
  sw.onchange = () => act(() => ok(sb.from('settings').update({ worker_apps_open: sw.checked }).eq('id', 1)), sw.checked ? 'فُتح استقبال طلبات العمل' : 'أُوقف استقبال طلبات العمل');
  return h('div', { class: 'card pad' }, h('h3', {}, '👷 طلبات العمل'),
    h('label', { style: 'font-weight:400' }, sw, ' استقبال طلبات العمل مفتوح (تظهر أيقونة «طلب العمل» للزوار)'),
    h('div', { class: 'muted' }, 'عند الإيقاف تختفي الأيقونة ولا يُقبل أي طلب جديد.'));
}

// ---------------- طلبات العمل ----------------
async function appsView() {
  const [apps, rate, ws] = await Promise.all([ok(sb.from('worker_applications').select('*').order('id', { ascending: false })), rpc('get_rate'), ok(sb.from('workers').select('id,user_id,active'))]);
  const max = Number(rate), root = h('div');
  root.append(await appsSwitch());
  if (!apps.length) root.append(h('div', { class: 'empty' }, 'لا توجد طلبات عمل.'));
  for (const x of apps) {
    const r = h('input', { type: 'number', step: '0.1', min: 0, max, value: max / 2, style: 'width:90px' });
    const card = h('div', { class: 'card pad' },
      h('div', {}, h('b', {}, x.first_name + ' ' + x.last_name + ' '), h('span', { class: 'badge ' + (x.status === 'approved' ? 'active' : x.status === 'rejected' ? 'cancelled' : 'pending') }, { pending: 'قيد الدراسة', approved: 'مقبول', rejected: 'مرفوض' }[x.status])),
      kv([['تاريخ الميلاد', fd(x.birth_date)], ['الهاتف', tel(x.phone)], ['التقديم', fdate(x.created_at)]]));
    if (x.status === 'pending') card.append(h('hr'), h('label', {}, 'نسبة العامل % من سعر الشقة (من أصل ' + max + '%)'), r,
      h('div', { style: 'display:flex;gap:8px;margin-top:10px' },
        h('button', { class: 'btn pri', onclick: async () => {
          if (!confirm('قبول هذا العامل؟')) return;
          try {
            await rpc('admin_review_application', { p_app: x.id, p_approve: true, p_rate: +r.value }); toast('تم القبول'); render();
            showMsgs('أبلغ العامل بالقبول', [['💬 أرسل رابط صفحته', wa(x.phone, `السلام عليكم ${x.first_name}، تم قبول طلبك للعمل معنا في عقارات سوف ✅. نسبتك ${r.value}% من سعر الشقة في كل عملية. ادخل صفحتك بالبريد وكلمة السر التي سجّلت بها: ${workerLink()}`)]]);
          } catch (e) { toast(e.message, false); }
        } }, '✅ قبول'),
        h('button', { class: 'btn red', onclick: async () => {
          if (!confirm('رفض هذا الطلب؟')) return;
          try {
            await rpc('admin_review_application', { p_app: x.id, p_approve: false }); toast('تم الرفض'); render();
            showMsgs('أبلغ صاحب الطلب بالرفض', [['💬 أرسل الرد', wa(x.phone, `السلام عليكم ${x.first_name}، نعتذر، لم يُقبل طلبك للعمل في عقارات سوف حالياً. شكراً لاهتمامك.`)]]);
          } catch (e) { toast(e.message, false); }
        } }, '❌ رفض')));
    if (x.status === 'approved') {
      const w = ws.find(z => z.user_id === x.user_id);
      if (w) {
        const stop = async () => {
          const why = await askReason('إلغاء عمل ' + x.first_name);
          if (why === null) return;
          await act(() => ok(sb.from('workers').update({ active: false }).eq('id', w.id)), 'تم إيقاف العامل');
          showMsgs('أبلغ العامل', [['💬 أرسل الرد', wa(x.phone, `السلام عليكم ${x.first_name}، تم إيقاف عملك معنا في عقارات سوف.${reasonLine(why)}`)]]);
        };
        const back = () => act(() => ok(sb.from('workers').update({ active: true }).eq('id', w.id)), 'أُعيد تفعيل العامل');
        card.append(h('hr'), h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
          h('span', { class: 'badge ' + (w.active ? 'active' : 'hidden') }, w.active ? 'معتمد حالياً' : 'موقوف'),
          w.active ? h('button', { class: 'btn red sm', onclick: stop }, 'إلغاء عمله') : h('button', { class: 'btn pri sm', onclick: back }, 'إعادة تفعيله')));
      }
    }
    root.append(card);
  }
  return root;
}

// ---------------- العمال ----------------
async function workersView() {
  const [ws, rate, orders] = await Promise.all([
    ok(sb.from('workers').select('*').order('id', { ascending: false })), rpc('get_rate'),
    ok(sb.from('orders').select('worker_id,worker_cut').eq('status', 'confirmed').eq('paid', true))]);
  const max = Number(rate);
  const stat = id => orders.filter(o => o.worker_id === id).reduce((a, o) => ({ done: a.done + 1, earned: a.earned + o.worker_cut }), { done: 0, earned: 0 });
  const root = h('div');
  const name = h('input', { required: true, maxlength: 80 });
  const phone = h('input', { type: 'tel', required: true });
  const r0 = h('input', { type: 'number', step: '0.1', min: 0, max, value: max / 2, required: true });
  const f = h('form', { class: 'card pad' }, h('h3', {}, 'إضافة عامل يدوياً (بدون حساب دخول)'),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'الاسم'), name), h('div', {}, h('label', {}, 'الهاتف'), phone)),
    h('label', {}, `نسبة العامل من سعر الشقة % (من أصل ${max}% عمولة الوساطة)`), r0,
    h('button', { class: 'btn pri', style: 'margin-top:10px' }, 'اعتماد العامل'));
  f.onsubmit = e => {
    e.preventDefault();
    act(() => ok(sb.from('workers').insert({ name: name.value.trim(), phone: phone.value.trim(), rate_pct: +r0.value })), 'تمت إضافة العامل');
  };
  root.append(f);
  for (const w of ws) {
    const s = stat(w.id);
    const r = h('input', { type: 'number', step: '0.1', min: 0, max, value: w.rate_pct, style: 'width:90px' });
    const a = h('input', { type: 'checkbox' }); a.checked = !!w.active;
    root.append(h('div', { class: 'card pad' },
      h('div', {}, h('b', {}, w.name + ' '), h('span', { class: 'badge ' + (w.active ? 'active' : 'hidden') }, w.active ? 'معتمد' : 'موقوف')),
      kv([['الهاتف', tel(w.phone)], ['طلبات مستلمة المبلغ', s.done], ['مستحقاته الإجمالية', money(s.earned)]]),
      h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
        h('label', { style: 'margin:0' }, 'النسبة %'), r,
        h('label', { style: 'margin:0;font-weight:400' }, a, ' معتمد (بإلغاء التحديد يُمنع من الدخول فوراً)'),
        h('button', { class: 'btn pri sm', onclick: async () => {
          let why = '';
          if (w.active && !a.checked) { why = await askReason('إلغاء عمل ' + w.name); if (why === null) { a.checked = true; return; } }
          await act(() => ok(sb.from('workers').update({ rate_pct: +r.value, active: a.checked }).eq('id', w.id)), 'تم الحفظ');
          if (w.active && !a.checked) showMsgs('أبلغ العامل', [['💬 أرسل الرد', wa(w.phone, `السلام عليكم ${w.name}، تم إيقاف عملك معنا في عقارات سوف.${reasonLine(why)}`)]]);
        } }, 'حفظ'))));
  }
  if (!ws.length) root.append(h('div', { class: 'empty' }, 'لا يوجد عمال بعد.'));
  return root;
}

// ---------------- الإعدادات ----------------
async function settingsView() {
  const cur = Number(await rpc('get_rate'));
  const rate = h('input', { type: 'number', step: '0.1', min: 0, max: 50, value: cur, required: true });
  const f1 = h('form', { class: 'card pad' }, h('h3', {}, 'نسبة الوساطة'),
    h('label', {}, 'النسبة % (تُضاف على سعر صاحب الشقة)'), rate,
    h('div', { class: 'muted' }, 'التغيير يسري على العروض والطلبات الجديدة فقط؛ الطلبات السابقة تحتفظ بنسبتها.'),
    h('button', { class: 'btn pri', style: 'margin-top:10px' }, 'حفظ النسبة'));
  f1.onsubmit = e => { e.preventDefault(); act(() => ok(sb.from('settings').update({ rate_pct: +rate.value }).eq('id', 1)), 'تم حفظ النسبة'); };
  const o = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const n = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const f2 = h('form', { class: 'card pad' }, h('h3', {}, 'تغيير كلمة المرور'),
    h('label', {}, 'الحالية'), o, h('label', {}, 'الجديدة (8 أحرف على الأقل)'), n,
    h('button', { class: 'btn pri', style: 'margin-top:10px' }, 'تغيير'));
  f2.onsubmit = async e => {
    e.preventDefault();
    try {
      const { data: { user } } = await sb.auth.getUser();
      const chk = await sb.auth.signInWithPassword({ email: user.email, password: o.value });
      if (chk.error) throw new Error('كلمة المرور الحالية خاطئة');
      const { error } = await sb.auth.updateUser({ password: n.value });
      if (error) throw new Error('تعذر تغيير كلمة المرور (8 أحرف على الأقل)');
      toast('تم تغيير كلمة المرور'); o.value = ''; n.value = '';
    } catch (x) { toast(x.message, false); }
  };
  const ns = (await ok(sb.from('settings').select('notify_telegram_token,notify_telegram_chat,notify_wa_phone,notify_wa_key').eq('id', 1)))[0] || {};
  const tt = h('input', { type: 'password', value: ns.notify_telegram_token || '', autocomplete: 'off', placeholder: '123456789:AA...' });
  const tc = h('input', { value: ns.notify_telegram_chat || '', inputmode: 'numeric', placeholder: 'رقم المحادثة' });
  const wp = h('input', { value: ns.notify_wa_phone || '', type: 'tel', placeholder: '2136XXXXXXXX' });
  const wk = h('input', { type: 'password', value: ns.notify_wa_key || '', autocomplete: 'off' });
  const detect = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
    if (!/^[0-9]{5,12}:[A-Za-z0-9_-]{30,50}$/.test(tt.value.trim())) return toast('ألصق رمز البوت أولاً', false);
    try {
      const r = await (await fetch('https://api.telegram.org/bot' + tt.value.trim() + '/getUpdates')).json();
      const m = (r.result || []).map(u => u.message && u.message.chat).filter(Boolean).pop();
      if (!m) return toast('لم أجد رسالة: افتح البوت في تيليغرام واضغط Start ثم أرسل له أي كلمة، ثم أعد المحاولة', false);
      tc.value = m.id; toast('تم العثور على رقم المحادثة — اضغط حفظ');
    } catch { toast('تعذر الاتصال بتيليغرام', false); }
  } }, '🔎 اكتشاف رقم المحادثة');
  const f3 = h('form', { class: 'card pad' }, h('h3', {}, '🔔 الإشعارات'),
    h('div', { class: 'muted' }, 'تصلك رسالة عند: عرض جديد، طلب جديد، تأكيد كراء، استلام مبلغ.'),
    h('h4', {}, 'تيليغرام (يعمل الآن)'),
    h('label', {}, 'رمز البوت (من BotFather)'), tt, h('label', {}, 'رقم المحادثة'), tc, detect,
    h('h4', {}, 'واتساب عبر CallMeBot (اختياري)'),
    h('label', {}, 'رقم هاتفك بالصيغة الدولية'), wp, h('label', {}, 'مفتاح CallMeBot'), wk,
    h('div', { style: 'display:flex;gap:8px;margin-top:10px' },
      h('button', { class: 'btn pri' }, 'حفظ'),
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        try { const r = await rpc('admin_notify_test'); toast(r.error ? (r.error === 'no_channel' ? 'احفظ إعدادات قناة أولاً' : 'خطأ: ' + r.error) : 'أُرسلت رسالة تجريبية: ' + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status])))); }
        catch (e) { toast(e.message, false); }
      } }, 'إرسال رسالة تجريبية')));
  f3.onsubmit = e => { e.preventDefault(); act(() => ok(sb.from('settings').update({
    notify_telegram_token: tt.value.trim() || null, notify_telegram_chat: tc.value.trim() || null,
    notify_wa_phone: wp.value.trim() || null, notify_wa_key: wk.value.trim() || null }).eq('id', 1)), 'تم حفظ الإشعارات'); };
  const si = await rpc('site_info');
  const sname = h('input', { value: si.name, maxlength: 40, required: true });
  const sfile = h('input', { type: 'file', accept: 'image/*' });
  const prev = h('img', { class: 'banner', src: si.banner ? bannerUrl(si.banner) : 'banner.jpg', style: 'margin:8px 0;max-height:180px;object-fit:cover' });
  const f5 = h('form', { class: 'card pad' }, h('h3', {}, '🎨 هوية الموقع'),
    h('label', {}, 'اسم الموقع'), sname,
    h('label', {}, 'صورة الواجهة الرئيسية (اتركها فارغة للإبقاء على الحالية)'), prev, sfile,
    h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' },
      h('button', { class: 'btn pri' }, 'حفظ'),
      h('button', { type: 'button', class: 'btn', onclick: () => confirm('العودة إلى الصورة الأصلية؟') && act(() => ok(sb.from('settings').update({ banner_path: null }).eq('id', 1)), 'تمت العودة للصورة الأصلية') }, 'الصورة الأصلية')));
  f5.onsubmit = e => { e.preventDefault(); act(async () => {
    const upd = { site_name: sname.value.trim() };
    if (sfile.files[0]) upd.banner_path = await uploadTo('site-assets', sfile.files[0]);
    await ok(sb.from('settings').update(upd).eq('id', 1));
  }, 'تم حفظ هوية الموقع'); };
  const f4 = await appsSwitch();
  return h('div', {}, f5, f4, f1, f3, f2);
}

async function boot() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && await rpc('am_i_admin')) return render();
  } catch {}
  loginView();
}
boot();
