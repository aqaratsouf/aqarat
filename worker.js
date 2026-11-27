const app = $('#app');
let wtab = 'new';
const tel = p => h('a', { class: 'link', href: 'tel:' + p }, p);
const kv = pairs => h('div', { class: 'kv' }, pairs.map(([k, v]) => [h('b', {}, k), h('span', {}, v)]));

requireAuth(app, { title: 'صفحة العامل', sub: 'سجّل دخولك بحسابك. إن لم تكن عاملاً بعد فأنشئ حساباً وقدّم طلب العمل.' }, async user => {
  setNav([['الرئيسية', 'index.html'], ['خروج', '#', logout]]);
  let st;
  try { st = await rpc('my_worker_state'); } catch (e) { return app.replaceChildren(h('div', { class: 'empty' }, e.message)); }
  const msg = (t, d) => app.replaceChildren(h('div', { class: 'card pad auth' }, h('h2', {}, t), h('p', {}, d)));
  if (st.state === 'pending') return msg('⏳ طلبك قيد الدراسة', 'سنُعلمك بالنتيجة عبر واتساب على الرقم الذي سجّلته.');
  if (st.state === 'rejected') return msg('نعتذر', 'لم يُقبل طلبك للعمل حالياً.');
  if (st.state === 'inactive') return msg('⛔ تم إيقاف حسابك', 'لم يعد بإمكانك الدخول إلى مهام العمل. تواصل مع الإدارة إن كان ذلك خطأ.');
  if (st.state === 'none') return applyView(user, st);
  dashboard(st);
});

async function applyView(user, st) {
  if (!(await workerAppsOpen())) return app.replaceChildren(h('div', { class: 'card pad auth' }, h('h2', {}, 'استقبال طلبات العمل متوقف حالياً'), h('p', {}, 'عُد لاحقاً.')));
  const first = h('input', { required: true, maxlength: 40 }), last = h('input', { required: true, maxlength: 40 });
  const bd = h('input', { type: 'date', required: true, max: addDays(iso(new Date()), -365 * 18) });
  const ph = h('input', { type: 'tel', required: true, inputmode: 'tel', placeholder: '05XXXXXXXX' });
  const f = h('form', { class: 'card pad' }, h('h2', {}, '👷 طلب العمل معنا'),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'الاسم'), first), h('div', {}, h('label', {}, 'اللقب'), last)),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'تاريخ الميلاد'), bd), h('div', {}, h('label', {}, 'رقم الهاتف (واتساب)'), ph)),
    h('div', { class: 'note' }, `💰 نسبتك من الأرباح: عمولة الوساطة تُضاف على سعر صاحب الشقة، ونسبة العامل الافتراضية ${st.rate_pct}% من سعر الشقة (نصف عمولة الوساطة). تحدد الإدارة النسبة النهائية عند قبول طلبك، وتظهر لك في صفحتك لكل عملية ولمجموع أرباحك، ولا تُحتسب إلا بعد استلام المبلغ.`),
    h('div', { class: 'muted' }, 'مهامك: الاتصال بالزبون وصاحب الشقة، تأكيد الطلب، ثم استلام المبلغ.'),
    h('button', { class: 'btn pri', style: 'width:100%;margin-top:12px' }, 'إرسال الطلب'));
  f.onsubmit = async e => {
    e.preventDefault();
    try { await rpc('apply_worker', { p: { first_name: first.value, last_name: last.value, birth_date: bd.value, phone: ph.value } }); location.reload(); }
    catch (x) { toast(x.message, false); }
  };
  app.replaceChildren(f);
}

const WST = o => o.status === 'cancelled' ? 'cancelled' : o.paid ? 'paid' : o.status === 'confirmed' ? 'confirmed' : 'new';
async function dashboard(st) {
  app.replaceChildren(h('div', { class: 'empty' }, 'جاري التحميل...'));
  let os;
  try { os = await rpc('worker_orders'); } catch (e) { return app.replaceChildren(h('div', { class: 'empty' }, e.message)); }
  const paid = os.filter(o => o.paid), wait = os.filter(o => o.status === 'confirmed' && !o.paid);
  const sum = a => a.reduce((s, o) => s + Number(o.my_cut), 0);
  const act = async (fn, okmsg, after) => { try { await fn(); toast(okmsg); const fresh = (await rpc('worker_orders')).find(x => x.id === after.id) || after; dashboard(st); return fresh; } catch (e) { toast(e.message, false); } };
  const root = h('div');
  root.append(h('h2', {}, 'مرحباً ' + (st.name || '')),
    h('div', { class: 'sum' },
      h('div', {}, h('span', {}, 'نسبتك من سعر الشقة'), h('span', {}, st.rate_pct + '%')),
      h('div', {}, h('span', {}, 'أرباح مستلمة (بعد تسليم المبلغ)'), h('span', {}, money(sum(paid)))),
      h('div', {}, h('span', {}, 'أرباح بانتظار تسليم المبلغ'), h('span', {}, money(sum(wait)))),
      h('div', { class: 'tot' }, h('span', {}, 'مجموع أرباحي'), h('span', {}, money(sum(paid))))));
  const names = { new: 'جديدة', confirmed: 'بانتظار المبلغ', paid: 'مستلمة', cancelled: 'ملغاة' };
  root.append(h('div', { class: 'tabs' }, Object.entries(names).map(([k, v]) =>
    h('button', { class: wtab === k ? 'on' : '', onclick: () => { wtab = k; dashboard(st); } }, `${v} (${os.filter(o => WST(o) === k).length})`))));
  const list = os.filter(o => WST(o) === wtab);
  if (!list.length) root.append(h('div', { class: 'empty' }, 'لا توجد مهام هنا.'));
  for (const o of list) {
    const card = h('div', { class: 'card pad' },
      h('div', {}, h('b', {}, `مهمة #${o.id} `), h('span', { class: 'step ' + ({ new: 'wait', confirmed: 'go', paid: 'done', cancelled: 'no' })[WST(o)] }, names[WST(o)])),
      kv([['الشقة', `${o.listing_title} — ${o.address}`], ['المدة', `${o.units} ${unitWord(o)} (${period(o)})`], ['الأشخاص', o.persons],
        ['الزبون', o.client_name], ['هاتف الزبون', tel(o.client_phone)],
        ['صاحب الشقة', o.owner_name], ['هاتف صاحب الشقة', tel(o.owner_phone)],
        ['المبلغ على الزبون', money(o.total)], ['مبلغ صاحب الشقة', money(o.owner_total)],
        ['نصيبي من هذه العملية', h('b', { class: 'profit' }, money(o.my_cut))]]));
    const row = h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' });
    if (o.status === 'new') row.append(
      h('button', { class: 'btn pri', onclick: async () => {
        if (!confirm('هل اتصلت بالزبون وصاحب الشقة وتأكدت من الحجز؟')) return;
        await act(() => rpc('worker_confirm', { p_order: o.id }), 'تم تأكيد الطلب', o);
        showMsgs('تم التأكيد — أبلغ الطرفين', [['💬 أبلغ صاحب الشقة', wa(o.owner_phone, ownerMsg(o, false))], ['💬 أبلغ الزبون', wa(o.client_phone, clientApprovedMsg(o))]]);
      } }, '✅ تأكيد الطلب'),
      h('button', { class: 'btn red', onclick: () => confirm('إلغاء هذا الطلب؟') && act(() => rpc('worker_cancel', { p_order: o.id }), 'تم الإلغاء', o) }, 'إلغاء'));
    if (o.status === 'confirmed' && !o.paid) row.append(
      h('button', { class: 'btn pri', onclick: async () => {
        if (!confirm('هل استلمت المبلغ من الزبون؟')) return;
        await act(() => rpc('worker_set_paid', { p_order: o.id }), 'تم تسجيل استلام المبلغ', o);
        showMsgs('تم استلام المبلغ — أبلغ الطرفين', [['💬 أبلغ الزبون (مع رقم صاحب الشقة)', wa(o.client_phone, clientPaidMsg(o))], ['💬 أبلغ صاحب الشقة', wa(o.owner_phone, ownerMsg(o, true))]]);
      } }, '💰 استلمت المبلغ'),
      h('button', { class: 'btn red', onclick: () => confirm('إلغاء هذا الحجز؟') && act(() => rpc('worker_cancel', { p_order: o.id }), 'تم الإلغاء', o) }, 'إلغاء'));
    if (o.paid) row.append(waBtn('💬 أعد إرسال رقم المالك للزبون', wa(o.client_phone, clientPaidMsg(o))));
    if (row.children.length) card.append(row);
    root.append(card);
  }
  app.replaceChildren(root);
}
