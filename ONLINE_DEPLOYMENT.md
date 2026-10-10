# د آنلاین، ګډو معلوماتو او PWA نسخې لارښود

دا پروژه **Hybrid Online + Offline** ده:

- IndexedDB د موبایل/براوزر اصلي محلي cache دی؛ د انټرنېټ له پرې کېدو سره ثبت، سمون، چاپ، export، backup او restore کار کوي.
- Supabase مرکزي database دی؛ Login وروسته remote pull، محلي بدلونونه push، او د بیا وصلېدو پر مهال اتومات sync کېږي.
- هر tenant د `province_id:district_id` پر بنسټ جلا دی. د یوه tenant غړي د بل tenant معلومات نه ویني.
- ټول authenticated غړي shared records لیدلای، اضافه کولای او سمولای شي؛ delete یوازې online admin ته اجازه لري.
- اصلي onboarding **Self-signup** دی؛ invite endpoint یوازې legacy compatibility دی او اړین نه دی.

## ۱) Supabase جوړول

1. په Supabase کې نوې project جوړه کړئ.
2. SQL Editor کې بشپړ `supabase/schema.sql` اجرا کړئ.
3. په Authentication → Providers کې Email فعال کړئ. که غواړئ email verification وي، **Confirm email** فعال پرېږدئ؛ signup trigger به profile او member record سمدستي جوړ کړي، خو کاروونکی به تر تایید وروسته Login کوي.
4. په Authentication → URL Configuration کې د خپل Netlify HTTPS URL د Site URL او Redirect URL په توګه اضافه کړئ.

### د signup جریان

- که `district_registry` خالي وي، لومړنی signup کوونکی خپل ولایت او ولسوالۍ لیکلای شي. هماغه composite tenant په registry کې ثبتېږي او لومړنی کاروونکی admin کېږي.
- وروسته signup فورم یوازې د `district_registry` له active ثبتونو څخه selector ښيي.
- د هر signup لپاره په `user_profiles` کې tenant/profile او په `app_records` کې د `members` shared record اتومات جوړېږي.
- که د یوه ولایت/ولسوالۍ څلور غړي ثبت شي، ټول څلور د همدې tenant د records، Team او Member views ګډ معلومات ویني.
- بل tenant ته د RLS له امله هېڅ record نه ښکاري.

## ۲) Browser config

`js/runtime-config.js` کې یوازې د Supabase عام URL او anon key ولیکئ:

```js
window.MADRASA_ONLINE_CONFIG = {
  enabled: true,
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_PUBLIC_ANON_KEY'
};
```

`SUPABASE_SERVICE_ROLE_KEY` هېڅکله په `runtime-config.js`، frontend bundle، PWA cache، GitHub یا ZIP کې مه لیکئ. د signup لپاره district ID په config کې نور لازم نه دی؛ registry یې ټاکي.

## ۳) Netlify deploy

1. Repository د GitHub له لارې Netlify ته وصل کړئ.
2. Build command: `npm run build`
3. Publish directory: `.`
4. Netlify environment variables کې دا اضافه کړئ:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — یوازې د legacy invite function لپاره؛ عادي self-signup ورته اړتیا نه لري.
5. Deploy وکړئ او ډاډ ترلاسه کړئ چې site د HTTPS له لارې پرانیستل کېږي.
6. Netlify د `netlify.toml` له لارې `/api/invite-member` مسیر function ته اړوي. د اصلي onboarding لپاره Settings → Online کې self-signup استعمال کړئ، نه invite.

## ۴) د کاروونکي عملي onboarding

1. App پرانیزئ او Online Settings کې URL، anon key او **Enable Online Sync** خوندي کړئ.
2. د Login modal کې **نوی حساب جوړول / Sign up** وټاکئ.
3. Full name، email، password، ولایت او ولسوالۍ ثبت کړئ.
4. لومړی user د registry لومړنی tenant جوړوي؛ نور users له selector څخه هماغه ثبت شوی tenant انتخابوي.
5. که Supabase email confirmation فعال وي، د ایمیل لینک تایید کړئ او بیا Sign in وکړئ.
6. هر غړی هر وخت خپل email/password سره Sign in کولای شي؛ invite یا د admin session ته اړتیا نشته.

## ۵) آفلاین او Sync ازموینه

- لږ تر لږه یو user Login او `Sync now`/refresh وکړي، بیا په DevTools یا موبایل کې Offline حالت فعال کړي.
- نوی member، madrasa یا observation ثبت او edit کړئ؛ بدلون باید په IndexedDB کې پاتې شي.
- انټرنېټ بېرته فعال کړئ؛ app باید remote pull/push وکړي او Online status تازه کړي.
- Service worker یوازې same-origin static shell cache کوي. `/api/` او Supabase requests cache نه کوي؛ د auth او sync network behavior نه خرابوي.
- Browser storage پاکولو مخکې backup جوړ کړئ.

## ۶) GitHub Pages

Static frontend پر GitHub Pages چلېدای شي، خو legacy Netlify invite function نه چلېږي. Self-signup، Login او Supabase sync د Supabase URL له لارې کار کوي؛ د ساده او خوندي deployment لپاره Netlify سپارښتنه کېږي، ځکه HTTPS او function config دواړه برابروي.

## ۷) امنیتي یادونې

- یوازې anon key frontend ته ورکړئ؛ anon key د RLS له policies سره کار کوي.
- service-role key یوازې Netlify server environment کې وساتئ.
- د `district_registry` public read قصدي دی، ځکه unauthenticated signup selector باید ثبت شوي نومونه وویني؛ registry کې شخصي records نه ساتل کېږي.
- د `supabase/schema.sql` RLS policies مه غیرفعال کوئ. Cross-tenant isolation د `user_profiles.tenant_id` او `app_records.district_id` له برابرۍ څخه تطبیقېږي.


## Super Admin / district subscriptions

Districts, fees and payments are now controlled by the application owner (Super Admin).
Public signup can no longer create a district. Read `SUPER_ADMIN_SETUP.md` and apply
`supabase/migrations/20261009_super_admin.sql` before deploying this version.
