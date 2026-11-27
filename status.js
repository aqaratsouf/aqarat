const KL = { furnished: 'شقة مجهزة (باليوم)', unfurnished: 'شقة غير مجهزة (بالشهر)' };
const STATE = {
  pending: { icon: '⏳', text: 'قيد المراجعة', note: 'عرضك وصلنا ونراجعه حالياً. سيظهر للزبائن بعد الموافقة عليه.', cls: 'pending' },
  active: { icon: '✅', text: 'تم نشر عرضك', note: 'عرضك ظاهر الآن للزبائن. سنتصل بك على هاتفك عند وجود طلب.', cls: 'active' },
  hidden: { icon: '⏸️', text: 'العرض مخفي حالياً', note: 'عرضك غير ظاهر للزبائن حالياً. تواصل معنا إن أردت إعادة نشره.', cls: 'hidden' },
};
const app = $('#app');
const tok = new URLSearchParams(location.search).get('t');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function card(token, fallbackTitle) {
  try {
    const r = (await rpc('get_listing_status', { p_token: token }))[0];
    if (!r) return h('div', { class: 'card pad' }, h('b', {}, fallbackTitle || 'عرض'), h('div', { class: 'muted' }, 'لم نجد هذا العرض (ربما حُذف).'));
    const st = STATE[r.status] || STATE.pending;
    return h('div', { class: 'card pad' },
      h('div', { style: 'font-weight:700' }, r.title),
      h('div', { class: 'muted' }, KL[r.kind]),
      h('div', { style: 'margin:8px 0' }, h('span', { class: 'badge ' + st.cls }, st.icon + ' ' + st.text)),
      h('div', {}, st.note),
      (r.bookings || []).length ? h('div', { class: 'note', style: 'margin-top:10px' }, h('b', {}, '📅 حجوزات مؤكدة:'),
        r.bookings.map(b => h('div', {}, 'من ' + fd(b.start) + ' إلى ' + fd(b.end) + ' — ' + b.persons + ' شخص'))) : null);
  } catch (e) { return h('div', { class: 'card pad' }, e.message); }
}

(async () => {
  if (tok) {
    if (!UUID.test(tok)) return app.replaceChildren(h('div', { class: 'empty' }, 'الرابط غير صالح.'));
    return app.replaceChildren(await card(tok));
  }
  let mine = [];
  try { mine = JSON.parse(localStorage.getItem('aq_my') || '[]'); } catch {}
  mine = mine.filter(m => m && UUID.test(m.token));
  if (!mine.length) return app.replaceChildren(h('div', { class: 'empty' }, 'لا توجد عروض محفوظة على هذا الجهاز. افتح الرابط الخاص الذي ظهر لك بعد إرسال العرض.'));
  app.replaceChildren(...await Promise.all(mine.map(m => card(m.token, m.title))));
})();
