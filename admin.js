const TABS = { orders: 'الطلبات', listings: 'العروض', workers: 'العمال', settings: 'الإعدادات' };
const ST = { new: 'جديد', confirmed: 'مؤكد', paid: 'مدفوع', cancelled: 'ملغى', pending: 'بانتظار المراجعة', active: 'منشور', hidden: 'مخفي' };
const KL = { furnished: 'مجهزة (باليوم)', unfurnished: 'غير مجهزة (بالشهر)' };
const app = $('#app');
let tab = 'orders', ofilter = 'new';

const tel = p => h('a', { href: 'tel:' + p, class: 'link' }, p);
const kv = pairs => h('div', { class: 'kv' }, pairs.map(([k, v]) => [h('b', {}, k), h('span', {}, v)]));
const intl = p => p.startsWith('0') ? '213' + p.slice(1) : p.replace(/^\+/, '');
const wa = (phone, txt) => `https://wa.me/${intl(phone)}?text=${encodeURIComponent(txt)}`;
const waBtn = (label, href, cls = 'btn sm') => h('a', { class: cls, style: 'text-decoration:none', target: '_blank', rel: 'noopener', href }, label);
const period = o => `من ${fd(o.start_date)} إلى ${fd(o.end_date)}`;
const clientMsg = o => `السلام عليكم ${o.client_name}، تم استلام مبلغ كراء «${o.listing_title}» (${period(o)}). هذا رقم صاحب الشقة للتواصل معه مباشرة: ${o.owner_name} ${o.owner_phone}. العنوان: ${o.address}. نتمنى لكم إقامة طيبة. (عقارات)`;
const ownerBookMsg = o => `السلام عليكم ${o.owner_name}، تم تأكيد حجز شقتك «${o.listing_title}» ${period(o)} باسم ${o.client_name} (${1 + o.companions.length} أشخاص). مبلغك: ${money(o.owner_total)}. نرجو تنبيه الزبون على الحفاظ على نظافة الشقة وتجهيزاتها. (عقارات)`;
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
  try { app.replaceChildren(await ({ orders: ordersView, listings: listingsView, workers: workersView, settings: settingsView })[tab]()); }
  catch (e) { app.replaceChildren(h('div', { class: 'empty' }, e.message)); }
}

async function act(fn, msg) { try { await fn(); if (msg) toast(msg); render(); } catch (e) { toast(e.message, false); } }

// ---------------- الطلبات ----------------
async function ordersView() {
  const [orders, workers] = await Promise.all([
    ok(sb.from('orders').select('*, workers(name, phone)').order('id', { ascending: false })),
    ok(sb.from('workers').select('*').order('id', { ascending: false }))]);
  const active = workers.filter(w => w.active);
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
  for (const o of list) {
    const unit = o.kind === 'furnished' ? 'يوم' : 'شهر';
    const profitSpan = h('span', { class: 'profit' }, money(o.status === 'confirmed' ? o.profit : o.commission));
    const card = h('div', { class: 'card pad' },
      h('div', {}, h('b', {}, `طلب #${o.id} `), h('span', { class: 'badge ' + (o.paid ? 'active' : o.status) }, o.paid ? '💰 مدفوع' : o.status === 'confirmed' ? '✅ مؤكد — لم يُسلَّم المبلغ' : ST[o.status]), h('span', { class: 'muted' }, ' — ' + fdate(o.created_at))),
      h('hr'),
      kv([
        ['الزبون', o.client_name], ['هاتف الزبون', tel(o.client_phone)],
        ['العرض', `${o.listing_title} (${KL[o.kind]}) — ${o.address}`],
        ['المدة', `${o.units} ${unit}`], ['تاريخ الحجز', period(o)],
        ['السعر الإجمالي (يدفعه الزبون)', money(o.total)],
        ['ما أدفعه لصاحب الشقة', money(o.owner_total)],
        [`العمولة (${o.rate_pct}%)`, money(o.commission)],
        ['صاحب الشقة', o.owner_name], ['هاتف صاحب الشقة', tel(o.owner_phone)],
        ...(o.status === 'confirmed' ? [['العامل', o.workers ? `${o.workers.name} (حصته ${money(o.worker_cut)})` : 'بدون عامل']] : []),
        ['فائدتي', profitSpan],
      ]),
      o.companions.length ? h('div', { style: 'margin-top:8px' }, h('b', {}, `المرافقون (${o.companions.length}):`),
        o.companions.map(c => h('div', {}, `${c.name} ${c.surname} — ${c.relation}`))) : h('div', { class: 'muted', style: 'margin-top:8px' }, 'بدون مرافقين'));
    if (o.status === 'confirmed') {
      const wrap = h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' });
      if (!o.paid) {
        wrap.append(h('button', { class: 'btn pri', onclick: async () => {
          if (!confirm('تأكيد أن الزبون سلّمك المبلغ؟ سيُحتسب في حساباتك.')) return;
          const win = window.open('', '_blank'); // نفتح النافذة الآن كي لا يحجبها المتصفح
          try {
            await rpc('admin_set_paid', { p_order: o.id, p_paid: true });
            toast('تم تسجيل استلام المبلغ — أرسل رقم المالك للزبون');
            if (win) win.location = wa(o.client_phone, clientMsg(o));
          } catch (e) { if (win) win.close(); toast(e.message, false); }
          render();
        } }, '💰 الزبون سلّم المبلغ'),
          h('button', { class: 'btn red', onclick: () => confirm('إلغاء هذا الحجز المؤكد وتحرير تواريخه؟') && act(() => rpc('admin_cancel_order', { p_order: o.id }), 'تم الإلغاء') }, 'إلغاء الحجز'));
      } else {
        wrap.append(h('div', { class: 'muted', style: 'width:100%' }, 'استُلم المبلغ: ' + fdate(o.paid_at)),
          waBtn('💬 أعد إرسال رقم المالك للزبون', wa(o.client_phone, clientMsg(o)), 'btn pri sm'),
          h('button', { class: 'btn sm', onclick: () => confirm('التراجع عن حالة الاستلام؟ سيُخصم من حساباتك.') && act(() => rpc('admin_set_paid', { p_order: o.id, p_paid: false }), 'تم التراجع') }, 'تراجع عن الاستلام'));
      }
      wrap.append(waBtn('💬 إبلاغ صاحب الشقة', wa(o.owner_phone, ownerBookMsg(o))));
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
      card.append(h('hr'), h('label', {}, 'العامل الذي نسّق هذا الطلب'), ws,
        h('div', { style: 'display:flex;gap:8px;margin-top:10px' },
          h('button', { class: 'btn pri', onclick: () => confirm('تأكيد أن عملية الكراء تمت؟') && act(() => rpc('admin_confirm_order', { p_order: o.id, p_worker: ws.value ? +ws.value : null }), 'تم تأكيد الكراء') }, '✅ تأكيد عملية الكراء'),
          h('button', { class: 'btn red', onclick: () => confirm('إلغاء الطلب؟') && act(() => rpc('admin_cancel_order', { p_order: o.id }), 'تم الإلغاء') }, 'إلغاء الطلب')));
    }
    root.append(card);
  }
  return root;
}

// ---------------- العروض ----------------
function ownerMsg(l) {
  const link = new URL('status.html?t=' + l.track_token, location.href).href;
  const intl = l.owner_phone.startsWith('0') ? '213' + l.owner_phone.slice(1) : l.owner_phone.replace('+', '');
  const txt = `السلام عليكم، بخصوص عرضك (${l.title}). تتابع حالته من هذا الرابط الخاص: ${link}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(txt)}`;
}
async function listingsView() {
  const [ls, rate] = await Promise.all([ok(sb.from('listings').select('*').order('id', { ascending: false })), rpc('get_rate')]);
  const setStatus = (id, status, msg) => act(() => ok(sb.from('listings').update({ status }).eq('id', id)), msg);
  const del = async l => {
    if (!confirm('حذف العرض نهائياً؟')) return;
    await act(async () => {
      await ok(sb.from('listings').delete().eq('id', l.id));
      await sb.storage.from('listing-photos').remove(l.photos.map(p => p.file)); // تنظيف الصور (لا يمنع الحذف إن فشل)
    });
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
          l.status === 'active' ? h('button', { class: 'btn sm', onclick: () => setStatus(l.id, 'hidden') }, 'إخفاء') : null,
          h('a', { class: 'btn sm', style: 'text-decoration:none', target: '_blank', rel: 'noopener', href: ownerMsg(l) }, '💬 واتساب للمالك'),
          h('button', { class: 'btn red sm', onclick: () => del(l) }, 'حذف')))));
  }
  root.append(grid);
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
  const f = h('form', { class: 'card pad' }, h('h3', {}, 'إضافة عامل جديد'),
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
        h('label', { style: 'margin:0;font-weight:400' }, a, ' معتمد'),
        h('button', { class: 'btn pri sm', onclick: () => act(() => ok(sb.from('workers').update({ rate_pct: +r.value, active: a.checked }).eq('id', w.id)), 'تم الحفظ') }, 'حفظ'))));
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
  return h('div', {}, f1, f3, f2);
}

async function boot() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && await rpc('am_i_admin')) return render();
  } catch {}
  loginView();
}
boot();
