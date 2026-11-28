// تسجيل الدخول والتسجيل واستعادة كلمة السر (Supabase Auth) — مشترك بين صفحات الزبون وصاحب الشقة والعامل
const RECOVERY = /type=recovery/.test(location.hash);
const userName = u => (u && u.user_metadata && u.user_metadata.full_name) || '';
const authErr = m => {
  m = (m || '').toLowerCase();
  if (m.includes('invalid login')) return 'البريد أو كلمة السر غير صحيحة';
  if (m.includes('already registered') || m.includes('already been registered')) return 'هذا البريد مسجّل مسبقاً، اضغط «دخول»';
  if (m.includes('not confirmed')) return 'فعّل حسابك أولاً من الرابط الذي وصلك على بريدك';
  if (m.includes('rate limit') || m.includes('seconds') || m.includes('too many')) return 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة';
  if (m.includes('password')) return 'كلمة السر ضعيفة (6 أحرف على الأقل)';
  if (m.includes('email')) return 'البريد الإلكتروني غير صالح';
  return 'تعذّر تنفيذ العملية، حاول مرة أخرى';
};
const logout = async () => { await sb.auth.signOut(); location.href = location.pathname; };
const cleanUrl = () => location.origin + location.pathname;

async function requireAuth(root, { title, sub }, onReady) {
  const { data: { session } } = await sb.auth.getSession();
  if (RECOVERY && session) return newPasswordForm(root);
  if (session) {
    let banned = false;
    try { banned = await rpc('my_ban'); } catch {}
    if (banned) return root.replaceChildren(h('div', { class: 'card pad auth' }, h('h2', {}, '⛔ حسابك محظور'), h('p', {}, 'تم إيقاف حسابك من طرف الإدارة. تواصل معنا إن كان ذلك خطأ.'), h('button', { class: 'btn', onclick: logout }, 'خروج')));
    return onReady(session.user);
  }
  let forgot = false;
  const draw = () => {
    const em = h('input', { type: 'email', required: true, autocomplete: 'username', dir: 'ltr', placeholder: 'example@gmail.com' });
    const pw = h('input', { type: 'password', required: !forgot, minlength: 6, autocomplete: 'current-password' });
    const nm = h('input', { maxlength: 80, autocomplete: 'name', placeholder: 'يُطلب عند إنشاء حساب جديد فقط' });
    const act = async kind => {
      const email = em.value.trim();
      if (!email) return toast('اكتب بريدك الإلكتروني', false);
      try {
        if (kind === 'forgot') {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: cleanUrl() });
          if (error) throw error;
          return f.replaceChildren(h('h3', {}, '📧 تحقق من بريدك'), h('p', {}, 'إن كان البريد مسجّلاً فقد أرسلنا إليه رابط تعيين كلمة سر جديدة.'));
        }
        if (pw.value.length < 6) return toast('كلمة السر 6 أحرف على الأقل', false);
        if (kind === 'login') {
          const { error } = await sb.auth.signInWithPassword({ email, password: pw.value });
          if (error) throw error;
          return location.reload();
        }
        if (nm.value.trim().length < 3) return toast('اكتب اسمك واللقب لإنشاء الحساب', false);
        const { data, error } = await sb.auth.signUp({ email, password: pw.value, options: { data: { full_name: nm.value.trim() }, emailRedirectTo: cleanUrl() } });
        if (error) throw error;
        if (data.session) return location.reload();
        if (data.user && data.user.identities && !data.user.identities.length) throw new Error('already registered');
        f.replaceChildren(h('h3', {}, '📧 تحقق من بريدك'), h('p', {}, 'أرسلنا رابط تفعيل إلى ' + email + '. افتحه ثم ارجع وسجّل الدخول.'));
      } catch (x) { toast(authErr(x.message), false); }
    };
    const f = h('form', { class: 'card pad auth' },
      h('h2', {}, title), sub ? h('div', { class: 'muted' }, sub) : null,
      h('label', {}, 'البريد الإلكتروني'), em,
      forgot ? h('div', { class: 'muted', style: 'margin-top:8px' }, 'سنرسل إلى بريدك رابطاً لتعيين كلمة سر جديدة.')
        : [h('label', {}, 'كلمة السر'), pw, h('label', {}, 'الاسم واللقب'), nm],
      forgot
        ? [h('button', { type: 'submit', class: 'btn pri', style: 'width:100%;margin-top:12px' }, 'إرسال الرابط'),
           h('button', { type: 'button', class: 'btn', style: 'width:100%;margin-top:8px', onclick: () => { forgot = false; draw(); } }, 'رجوع')]
        : [h('button', { type: 'submit', class: 'btn pri', style: 'width:100%;margin-top:12px' }, 'دخول (لديّ حساب)'),
           h('button', { type: 'button', class: 'btn', style: 'width:100%;margin-top:8px', onclick: () => act('signup') }, 'إنشاء حساب جديد'),
           h('button', { type: 'button', class: 'btn sm', style: 'margin-top:10px', onclick: () => { forgot = true; draw(); } }, 'نسيت كلمة السر؟')]);
    f.onsubmit = e => { e.preventDefault(); act(forgot ? 'forgot' : 'login'); };
    root.replaceChildren(f);
  };
  draw();
}

function newPasswordForm(root) {
  const pw = h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' });
  const f = h('form', { class: 'card pad auth' }, h('h2', {}, 'كلمة سر جديدة'), h('label', {}, 'كلمة السر الجديدة (6 أحرف على الأقل)'), pw,
    h('button', { class: 'btn pri', style: 'width:100%;margin-top:12px' }, 'حفظ'));
  f.onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: pw.value });
    if (error) return toast(authErr(error.message), false);
    toast('تم تغيير كلمة السر'); setTimeout(() => { location.href = cleanUrl(); }, 800);
  };
  root.replaceChildren(f);
}
