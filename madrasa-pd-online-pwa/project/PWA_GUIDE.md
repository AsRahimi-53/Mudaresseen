# PWA او موبایل نصب لارښود

`manifest.webmanifest`، `sw.js`، `assets/icons/icon-192.png` او `assets/icons/icon-512.png` د دې پروژې PWA shell جوړوي. App په standalone حالت کې نصبېږي او د static shell له cache څخه د انټرنېټ پرته پرانیستل کېږي.

## مهم شرطونه

1. Deployment باید د **HTTPS** له لارې وي؛ د `localhost` پرته عادي HTTP د Service Worker او install prompt لپاره بسنه نه کوي.
2. `npm run build` مخکې له deploy اجرا کړئ، څو `js/app.bundle.js` تازه وي.
3. Supabase URL او anon key په `js/runtime-config.js` کې عام browser config دی؛ service-role key مه اچوئ.
4. Service worker یوازې همدغه origin GET assets cache کوي. Supabase API، Auth او `/api/` requests bypass کېږي؛ IndexedDB او موجود onlineSync د offline writes او reconnect sync لپاره کار کوي.

## Netlify checklist

- Build command: `npm run build`
- Publish directory: `.`
- Netlify باید `index.html`، `manifest.webmanifest`، `sw.js` او `assets/icons/` د site root څخه وړاندې کړي.
- `SUPABASE_SERVICE_ROLE_KEY` یوازې د Netlify environment variables کې ساتئ؛ PWA cache، manifest او frontend bundle کې نه راځي.
- د لومړي deploy وروسته Chrome DevTools → Application → Manifest او Service Workers کې manifest/worker وګورئ.

## Android Chrome

1. د HTTPS Netlify site په Chrome کې پرانیزئ.
2. لومړی online config خوندي کړئ یا که اړتیا وي app آفلاین هم وکاروئ.
3. د Chrome menu `⋮` خلاص کړئ.
4. **Install app** یا **Add to Home screen** وټاکئ او تایید یې کړئ.
5. له Home screen څخه app پرانیزئ؛ standalone window به ولري، نه عادي browser tab.
6. د انټرنېټ پرې کېدو سره app خلاص کړئ او local records ولیکئ. د شبکې بېرته راتلو وروسته app خلاص/refresh کړئ؛ sync به اتومات هڅه وکړي.

## iPhone / iPad Safari

1. site په Safari کې د HTTPS له لارې پرانیزئ؛ Chrome on iOS د Safari PWA install تجربه نه وړاندې کوي.
2. د Share تڼۍ ووهئ.
3. **Add to Home Screen** وټاکئ.
4. نوم تایید او **Add** ووهئ.
5. له Home Screen څخه standalone app پرانیزئ.
6. د iOS storage د پاکېدو یا Private Browsing له امله IndexedDB له منځه تللای شي؛ د مهمو معلوماتو لپاره منظم Backup/Export وساتئ.

## Cache تازه کول

کله چې bundle یا static فایل بدل شي، په `sw.js` کې `CACHE_NAME` له `madrasa-pd-shell-v1` څخه نوي version ته واړوئ، مثلاً `v2`، بیا redeploy وکړئ. Worker به پخوانی cache پاک کړي. کاروونکي ممکن یو ځل app وتړي او بیا یې پرانیزي.

## د offline shell حدود

- HTML/CSS/JS/icons cache کېږي.
- د Supabase database او Auth response cache نه کېږي.
- نوي shared remote records تر Login/sync مخکې له نورو وسیلو نه ښکاري؛ محلي آفلاین بدلونونه د شبکې له بېرته راتلو وروسته push کېږي.
- که app لومړی ځل هېڅکله آنلاین نه وي پرانیستل شوی، shell لا نه وي cache شوی؛ د لومړي install لپاره لږ تر لږه یو HTTPS online visit ضروري دی.
