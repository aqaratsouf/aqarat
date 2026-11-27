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
  if (session) return onReady(session.user);
  let mode = 'login';
  const draw = () => {
    const em = h('input', { type: 'email', required: true, autocomplete: 'username', dir: 'ltr' });
    const pw = h('input', { type: 'password', required: true, minlength: 6, autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
    const nm = h('input', { required: true, maxlength: 80, autocomplete: 'name' });
    const f = h('form', { class: 'card pad auth' },
      h('h2', {}, title), sub ? h('div', { class: 'muted' }, sub) : null,
      h('div', { class: 'tabs' }, [['login', 'دخول'], ['signup', 'حساب جديد'], ['forgot', 'نسيت كلمة السر']].map(([k, v]) =>
        h('button', { type: 'button', class: mode === k ? 'on' : '', onclick: () => { mode = k; draw(); } }, v))),
      mode === 'signup' ? [h('label', {}, 'الاسم واللقب'), nm] : null,
      h('label', {}, 'البريد الإلكتروني'), em,
      mode !== 'forgot' ? [h('label', {}, 'كلمة السر'), pw] : null,
      mode === 'forgot' ? h('div', { class: 'muted' }, 'سنرسل إلى بريدك رابطاً لتعيين كلمة سر جديدة.') : null,
      h('button', { class: 'btn pri', style: 'width:100%;margin-top:12px' }, { login: 'دخول', signup: 'إنشاء الحساب', forgot: 'إرسال الرابط' }[mode]));
    f.onsubmit = async e => {
      e.preventDefault();
      const email = em.value.trim();
      try {
        if (mode === 'login') {
          const { error } = await sb.auth.signInWithPassword({ email, password: pw.value });
          if (error) throw error;
          return location.reload();
        }
        if (mode === 'signup') {
          const { data, error } = await sb.auth.signUp({ email, password: pw.value, options: { data: { full_name: nm.value.trim() }, emailRedirectTo: cleanUrl() } });
          if (error) throw error;
          if (data.session) return location.reload();
          if (data.user && data.user.identities && !data.user.identities.length) throw new Error('already registered');
          return f.replaceChildren(h('h3', {}, '📧 تحقق من بريدك'), h('p', {}, 'أرسلنا رابط تفعيل إلى ' + email + '. افتحه ثم ارجع وسجّل الدخول.'));
        }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: cleanUrl() });
        if (error) throw error;
        f.replaceChildren(h('h3', {}, '📧 تحقق من بريدك'), h('p', {}, 'إن كان البريد مسجّلاً فقد أرسلنا إليه رابط تعيين كلمة سر جديدة.'));
      } catch (x) { toast(authErr(x.message), false); }
    };
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
