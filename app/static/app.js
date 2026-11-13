/* Asa 前端：純 JS，無框架。文字翻譯在 i18n.js。 */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shift = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dur = m => m < 60 ? t('{0} 分鐘', m) : m % 60 ? t('{0} 小時 {1} 分', Math.floor(m / 60), m % 60) : t('{0} 小時', m / 60);
const TODAY = () => iso(new Date());
const wdOf = s => (new Date(s + 'T12:00').getDay() + 6) % 7;                 // 0=週一
const md = s => s.slice(5, 10).replace('-', '/');
const dateText = s => { const d = new Date(s + 'T12:00'); return LANG === 'en' ? d.toLocaleDateString(LOCALE, {month: 'short', day: 'numeric'}) : `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
const mqMobile = matchMedia('(max-width:820px)'), MOB = () => mqMobile.matches;
const isDeadline = e => e.title.startsWith('⏰');
const flagText = e => e.title.replace('⏰ 截止：', t('截止') + ' ');

const S = {view: 'day', cal: 'day', date: TODAY(), inbox: 0};
if (['day', 'week', 'month'].includes(store.get('cal'))) S.view = S.cal = store.get('cal');

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {method, headers: {'X-Lang': LANG, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok) { toast(t('操作失敗：') + (await r.text()).slice(0, 120)); throw new Error(r.status); }
  return r.json();
}
function toast(msg) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const el = Object.assign(document.createElement('div'), {className: 'toast', textContent: msg});
  document.body.append(el); setTimeout(() => el.remove(), 2600);
}
const act = async (path, method, body, msg) => { await api(path, method, body); if (msg) toast(msg); render(); };
const formData = f => Object.fromEntries([...new FormData(f)].filter(([, v]) => v !== ''));

/* ---------- 導覽 ---------- */
const ICON = {
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8.5" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="15.5" cy="15" r="1"/>',
  tasks: '<path d="M4 7l2 2 3.5-4M4 16l2 2 3.5-4M13 7h7M13 16h7"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5l1.5 3h5L16 13h5"/>',
  alarms: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4M4 5l2-2M20 5l-2-2"/>',
  weekly: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9v6M12 9v3M16 12v5"/>',
  link: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
};
const NAV = [['cal', '日曆'], ['tasks', '待辦'], ['inbox', '審核'], ['alarms', '鬧鐘'], ['weekly', '固定行程'], ['link', '設定']];
const CAL = [['day', '日'], ['week', '週'], ['month', '月']];
const isCal = v => CAL.some(([k]) => k === v);
function drawRail() {
  $('#rail').innerHTML = NAV.map(([k, v]) => {
    const on = k === 'cal' ? isCal(S.view) : S.view === k;
    return `<button class="nav ${on ? 'on' : ''}" onclick="go('${k === 'cal' ? S.cal : k}')"><svg viewBox="0 0 24 24">${ICON[k]}</svg><span>${t(v)}</span>${k === 'inbox' && S.inbox ? `<span class="dot">${S.inbox}</span>` : ''}</button>`;
  }).join('');
}
function go(v, d) {
  S.view = v; if (isCal(v)) { S.cal = v; store.set('cal', v); }
  if (d) S.date = d; S.enter = true; window.scrollTo(0, 0);
  if (palPref() === 'random') S.rnd = randomPal();          // 隨機模式：每換一頁換一個顏色
  return document.startViewTransition && !document.hidden ? document.startViewTransition(() => render()).updateCallbackDone : render();
}
/* 日曆共用：前後移動、回今天、日／週／月切換 */
const addMonth = (s, n) => { const d = new Date(s.slice(0, 8) + '01T12:00'); d.setMonth(d.getMonth() + n); return iso(d); };
const step = n => go(S.view, S.view === 'month' ? addMonth(S.date, n) : shift(S.date, S.view === 'week' ? 7 * n : n));
const seg = () => `<div class="seg">${CAL.map(([k, v]) => `<button class="${S.view === k ? 'on' : ''}" onclick="go('${k}')">${t(v)}</button>`).join('')}</div>`;
const calbar = (title, extra = '') => `<div class="calbar"><button class="hb" onclick="step(-1)" aria-label="${t('往前')}">‹</button><button class="hb" onclick="step(1)" aria-label="${t('往後')}">›</button>
  <button class="hb" onclick="go(S.view,TODAY())">${t('今天')}</button>${title ? `<b class="ttl num">${title}</b>` : ''}<span class="sp"></span>${extra}${seg()}</div>`;

async function render() {
  const y = window.scrollY;
  const html = await VIEW[S.view]();
  S.inbox = (await api('/inbox')).length;
  drawRail();
  $('#view').innerHTML = html;
  decorate();
  window.scrollTo(0, y);
}

/* ---------- 共用元件 ---------- */
function taskRow(x, extra = '') {
  const due = x.due ? `<span class="pill ${x.due.slice(0, 10) <= TODAY() && !x.done ? 'red' : ''}">${t('截止 {0}', md(x.due) + ' ' + x.due.slice(11, 16))}</span>` : '';
  const title = x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title);
  return `<div class="task ${x.done ? 'done' : ''} ${S.pop === x.id ? 'pop' : ''}">
    <button class="chk ${x.done ? 'on' : ''}" onclick="S.pop=${x.done ? 'null' : x.id};act('/tasks/${x.id}','PATCH',{done:${x.done ? 0 : 1}})" aria-label="${t('完成')}">
      <span class="ring"></span><span class="fill"></span><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/></svg></button>
    <div class="body"><span class="tt">${title}</span>${due || extra ? `<div class="meta">${due}${extra}</div>` : ''}</div>
    <button class="x" onclick="act('/tasks/${x.id}','DELETE')" aria-label="${t('刪除')}">✕</button></div>`;
}

/* 時間軸（桌機）：events = [{time,end_time,title,location,source,id}] */
function timeline(events, {start, end, pxm = 0.8, alarms = [], now = null, compact = false} = {}) {
  const top = m => Math.round((m - start) * pxm);
  let h = '';
  for (let m = start; m <= end; m += 60) h += `<div class="hr" style="top:${top(m)}px"><span class="num">${hhmm(m % 1440)}</span></div>`;
  const on = alarms.filter(a => a.enabled);
  if (on.length) {
    const a = mins(on[0].time), b = mins(on[on.length - 1].time);
    h += `<div class="band" style="top:${top(a)}px;height:${Math.max(20, top(b) - top(a) + 8)}px">${compact ? '' : `${t('鬧鐘')} ×${on.length}　${on[0].time}–${on[on.length - 1].time}`}</div>`;
  }
  const blocks = events.filter(e => !isDeadline(e)).map(e => ({...e, s: mins(e.time), e: e.end_time ? mins(e.end_time) : mins(e.time) + 50}));
  const lanes = [];
  for (const b of blocks) { let i = lanes.findIndex(x => x <= b.s); if (i < 0) i = lanes.length; lanes[i] = b.e; b.lane = i; }
  const n = Math.max(1, lanes.length);
  for (const b of blocks) {
    const height = Math.max(compact ? 20 : 30, (b.e - b.s) * pxm - 3);
    h += `<div class="ev ${b.source === 'weekly' ? 'weekly' : ''}" style="top:${top(b.s)}px;height:${height}px;left:calc(${b.lane * 100 / n}% + 2px);width:calc(${100 / n}% - 4px)" title="${esc(b.time)} ${esc(b.title)}">
      <b>${esc(b.title)}</b>${compact ? '' : `<span class="num">${esc(b.time)}${b.end_time ? '–' + esc(b.end_time) : ''}</span>${b.location ? ' · ' + esc(b.location) : ''}${b.source === 'weekly' ? ' · ' + t('每週') : ''}`}
      ${b.id && !compact ? `<button class="x" onclick="act('/events/${b.id}','DELETE')">✕</button>` : ''}</div>`;
  }
  for (const e of events.filter(isDeadline))
    h += `<div class="flag" style="top:${top(Math.min(mins(e.time), end))}px"><span>${esc(flagText(e))}</span></div>`;
  if (now !== null && now >= start && now <= end) h += `<div class="now" style="top:${top(now)}px"></div>`;
  return `<div class="tl" style="height:${top(end) + 8}px">${h}</div>`;
}
function rangeOf(days) {
  let a = 9 * 60, b = 18 * 60;
  for (const s of days) {
    for (const e of s.events) { a = Math.min(a, mins(e.time)); b = Math.max(b, e.end_time ? mins(e.end_time) : mins(e.time) + 50); }
    for (const x of (s.alarms || [])) a = Math.min(a, mins(x.time));
  }
  return {start: Math.floor(a / 60) * 60, end: Math.min(1440, Math.ceil(b / 60) * 60)};
}
/* 行程清單（手機用，比時間軸短很多） */
function agenda(events, {del = false, now = null} = {}) {
  if (!events.length) return `<div class="empty">${t('沒有行程')}</div>`;
  return `<div class="agenda">${events.map(e => isDeadline(e)
    ? `<div class="ag due"><i class="num">${esc(e.time)}</i><b>${esc(flagText(e))}</b></div>`
    : `<div class="ag ${e.source === 'weekly' ? 'weekly' : ''} ${now !== null && (e.end_time ? mins(e.end_time) : mins(e.time) + 50) < now ? 'past' : ''}"><i class="num">${esc(e.time)}${e.end_time ? `<s>${esc(e.end_time)}</s>` : ''}</i>
        <b>${esc(e.title)}${e.location ? `<em>${esc(e.location)}</em>` : ''}</b>${del && e.id ? `<button class="x" onclick="act('/events/${e.id}','DELETE')">✕</button>` : ''}</div>`).join('')}</div>`;
}

/* ---------- 色系：日曆跟著時段，其他每頁一個顏色 ---------- */
const PAL = {
  night: {stops: ['#3a29ff', '#7c5cff', '#38e1ff'], a: ['#7c5cff', '#38e1ff', '#7cff9b'], glow: '190 100 75'},
  dawn: {stops: ['#7c3aed', '#ff5fa2', '#ffb347'], a: ['#ff5fa2', '#ffb347', '#ffe08a'], glow: '30 100 75'},
  day: {stops: ['#2563eb', '#22d3ee', '#7cff9b'], a: ['#4f7dff', '#22d3ee', '#7cff9b'], glow: '170 100 75'},
  dusk: {stops: ['#6d28d9', '#f43f5e', '#fb923c'], a: ['#a855f7', '#fb7185', '#fdba74'], glow: '340 100 78'},
  lilac: {stops: ['#8b5cf6', '#d8b4fe', '#f0abfc'], a: ['#b9a3ff', '#dcc4ff', '#f5c2ff'], glow: '270 100 82'},
  mint: {stops: ['#059669', '#5eead4', '#bef264'], a: ['#34d399', '#5eead4', '#d9f99d'], glow: '150 100 75'},
  sunrise: {stops: ['#f97316', '#fb7185', '#fde047'], a: ['#ff8a4c', '#ff9eb5', '#ffe08a'], glow: '25 100 75'},
  rose: {stops: ['#db2777', '#f9a8d4', '#fda4af'], a: ['#f472b6', '#fbb6ce', '#fecdd3'], glow: '330 100 80'},
  gold: {stops: ['#b45309', '#fbbf24', '#fde68a'], a: ['#f5b041', '#fcd34d', '#fef3c7'], glow: '45 100 75'},
  sakura: {stops: ['#f472b6', '#fbcfe8', '#c4b5fd'], a: ['#f9a8d4', '#fbcfe8', '#ddd6fe'], glow: '320 100 85'},
  peach: {stops: ['#fb923c', '#fdba74', '#fda4af'], a: ['#ffb088', '#ffd0a8', '#ffc2cc'], glow: '20 100 80'},
  coral: {stops: ['#ef4444', '#fb7185', '#fdba74'], a: ['#ff6b6b', '#ff9a8b', '#ffc38a'], glow: '8 100 75'},
  grape: {stops: ['#6d28d9', '#a855f7', '#ec4899'], a: ['#9b6bff', '#c77dff', '#ff7ac8'], glow: '285 100 75'},
  neon: {stops: ['#f0abfc', '#22d3ee', '#a3e635'], a: ['#ff5cf4', '#2ee6ff', '#b6ff3c'], glow: '300 100 70'},
  ice: {stops: ['#38bdf8', '#bae6fd', '#e0e7ff'], a: ['#7dd3fc', '#bfe9ff', '#dbe4ff'], glow: '200 100 85'},
  lagoon: {stops: ['#0d9488', '#22d3ee', '#818cf8'], a: ['#2dd4bf', '#38bdf8', '#93a5ff'], glow: '185 100 72'},
  forest: {stops: ['#166534', '#4ade80', '#fde047'], a: ['#4ade80', '#86efac', '#eaf27c'], glow: '120 80 70'},
  matcha: {stops: ['#65a30d', '#bef264', '#fef9c3'], a: ['#a3d977', '#cdeba0', '#f3f0b5'], glow: '85 80 78'},
  sunset: {stops: ['#7c3aed', '#f43f5e', '#f59e0b'], a: ['#b06bff', '#ff5d7a', '#ffb23e'], glow: '350 100 72'},
  ember: {stops: ['#b91c1c', '#f97316', '#facc15'], a: ['#ff5a3c', '#ff9838', '#ffd84a'], glow: '18 100 68'},
  graphite: {stops: ['#475569', '#94a3b8', '#e2e8f0'], a: ['#8a97ad', '#b8c2d4', '#e6ebf3'], glow: '215 30 82'},
};
const PAL_NAME = {night: '極光', dawn: '晨曦', day: '海洋', dusk: '晚霞', lilac: '淺紫', mint: '薄荷', sunrise: '日出', rose: '玫瑰', gold: '金色',
  sakura: '櫻花', peach: '蜜桃', coral: '珊瑚', grape: '葡萄', neon: '霓虹', ice: '冰川', lagoon: '潟湖', forest: '森林', matcha: '抹茶', sunset: '夕陽', ember: '餘燼', graphite: '石墨'};
const PAGE = {tasks: 'lilac', inbox: 'mint', alarms: 'sunrise', weekly: 'rose', link: 'gold'};
const DAYPAL = ['day', 'lilac', 'mint', 'sunrise', 'rose', 'dusk', 'gold'];      // 日檢視：週一到週日各一個顏色（今天則跟著時段）
const palPref = () => { const v = store.get('pal'); return v === 'random' || PAL[v] ? v : 'auto'; };
const randomPal = () => { const ks = Object.keys(PAL).filter(k => k !== S.rnd); return ks[Math.floor(Math.random() * ks.length)]; };
function setPalPref(v) { store.set('pal', v); S.rnd = v === 'random' ? randomPal() : null; render(); }
function palNow() {
  const pref = palPref();
  if (pref === 'random') return S.rnd || (S.rnd = randomPal());
  if (pref !== 'auto') return pref;
  if (PAGE[S.view]) return PAGE[S.view];
  if (S.view === 'day' && S.date !== TODAY()) return DAYPAL[wdOf(S.date)];
  const h = nowMin() / 60;
  return h < 5 ? 'night' : h < 8 ? 'dawn' : h < 16.5 ? 'day' : h < 19 ? 'dusk' : 'night';
}
let aurora, pal;
function setPal() {
  const p = palNow();
  if (p === pal) return;
  pal = p;
  const c = PAL[p], root = document.documentElement;
  root.dataset.pal = p;
  ['--a1', '--a2', '--a3'].forEach((k, i) => root.style.setProperty(k, c.a[i]));
  setBorderGlowPalette(c.a, c.glow, 0.9);
  if (!aurora) aurora = createAurora($('#aurora'), {stops: c.stops, amplitude: 1.15, blend: 0.6, height: 0.5, glow: 0.75, layers: 3, speed: 0.9, brightness: 0.9, opacity: 0.85});
  else aurora.set({stops: c.stops});
}
function decorate() {
  const v = $('#view');
  v.querySelectorAll('.card').forEach((c, i) => { c.classList.add('border-glow-card'); c.style.setProperty('--i', i + 2); c.insertAdjacentHTML('beforeend', '<span class="edge-light"></span>'); });
  v.querySelectorAll('.week .col,.rules .rule,.wlist .wrow').forEach((c, i) => c.style.setProperty('--i', i));
  v.querySelectorAll('.hero>*').forEach((c, i) => c.style.setProperty('--i', i));
  v.classList.toggle('enter', !!S.enter);
  S.enter = false; S.pop = null;
  setPal(); tick();
}
function tick() {
  const c = $('#clock'); if (!c) return;
  const d = new Date();
  c.innerHTML = `${String(d.getHours()).padStart(2, '0')}<i>:</i>${String(d.getMinutes()).padStart(2, '0')}`;
}
setInterval(tick, 1000);

/* ---------- 亮／暗切換：圓形擴散轉場 ---------- */
function setTheme(th) { document.documentElement.dataset.theme = th; store.set('theme', th); }
function toggleTheme() {
  const root = document.documentElement, next = root.dataset.theme === 'light' ? 'dark' : 'light';
  if (!document.startViewTransition || document.hidden || matchMedia('(prefers-reduced-motion:reduce)').matches) return Promise.resolve(setTheme(next));
  const r = $('#theme').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add('theme-vt');
  const vt = document.startViewTransition(() => setTheme(next));
  vt.ready.then(() => root.animate({clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`]},
    {duration: 700, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)'})).catch(() => {});
  return vt.finished.finally(() => root.classList.remove('theme-vt'));
}

/* ---------- 日 ---------- */
function runway(s) {
  const al = s.alarms, on = al.filter(a => a.enabled);
  const anchor = s.events.find(e => e.wake && !isDeadline(e) && (!al.length || mins(e.time) > mins(al[0].time)));
  const addBtn = `<button class="hb" onclick="const v=prompt('${t('加一個鬧鐘（HH:MM）')}','07:00');if(v)act('/alarms/plan','POST',{date:'${s.date}',time:v.padStart(5,'0')})">＋</button>
    <button class="hb" onclick="act('/alarms/plan/regenerate?d=${s.date}','POST',null,'${t('已依規則重排')}')">${t('重排')}</button>`;
  if (!al.length) return `<div class="runway"><div class="cap"><span>${t('這天沒有排鬧鐘')}</span><span style="flex:1"></span>${addBtn}</div></div>`;
  const a = mins(al[0].time), last = mins(al[al.length - 1].time);
  const b = anchor ? mins(anchor.time) : last + Math.max(10, (last - a) / 3);
  const pos = x => ((mins(x) - a) / (b - a) * 100).toFixed(2);
  return `<div class="runway"><div class="cap"><b class="num">${on.length ? on[0].time : '—'}</b>
      <span class="num">×${on.length}${on.length > 1 ? `　→ ${on[on.length - 1].time}` : ''}</span>
      <span style="flex:1"></span>${addBtn}</div>
    <div class="track">${al.map((x, i) => `<button class="bell ${x.enabled ? '' : 'off'} ${x.source === 'manual' ? 'manual' : ''} ${i === 0 || i === al.length - 1 ? 'edge' : ''}" style="left:${pos(x.time)}%;--i:${i}"
        title="${x.time}（${t('點一下開關')}）" onclick="act('/alarms/plan/${x.id}','PATCH',{enabled:${x.enabled ? 0 : 1}})"><i class="num">${x.time}</i></button>`).join('')}
      ${anchor ? `<div class="goal"><span class="num">${esc(anchor.time)} ${esc(anchor.title)}</span></div>` : ''}</div></div>`;
}
function saying(s) {
  const x = s.tasks, open = x.day.filter(k => !k.done).length, parts = [];
  const evs = s.events.filter(e => !isDeadline(e));
  if (s.skip) parts.push(`🚫 ${s.skip.reason || t('放假')}`);
  if (s.date === TODAY()) {
    const next = evs.find(e => mins(e.time) > nowMin());
    parts.push(next ? t('下一個是 {0} {1}，還有 {2}', next.time, next.title, dur(mins(next.time) - nowMin())) : evs.length ? t('今天的行程都結束了') : t('今天沒有行程'));
  } else parts.push(evs.length ? t('{0} 個行程，第一個是 {1} {2}', evs.length, evs[0].time, evs[0].title) : t('沒有行程'));
  if (open) parts.push(t('{0} 項待辦', open));
  if (x.overdue.length) parts.push(t('{0} 項逾期', x.overdue.length));
  return parts.map(esc).join('　·　');
}
const VIEW = {};
VIEW.day = async () => {
  const [s, pr] = await Promise.all([api('/day?d=' + S.date), api('/pressure')]);
  const x = s.tasks, isToday = S.date === TODAY(), mob = MOB(), dt = dateText(S.date);
  const maxLoad = Math.max(3, ...pr.map(p => p.events + p.tasks + p.due.length * 2));
  const evForm = `<form class="addrow" onsubmit="event.preventDefault();const f=formData(this);act('/events','POST',{title:f.title,start:S.date+'T'+f.time,end:f.end?S.date+'T'+f.end:null,location:f.location||''})">
      <input class="field" type="time" name="time" required><input class="field" type="time" name="end" title="${t('結束（可不填）')}">
      <input class="field" type="text" name="title" placeholder="${t('新增行程')}" required><input class="field" type="text" name="location" placeholder="${t('地點')}" style="max-width:110px"><button class="btn pri">${t('加入')}</button></form>`;
  const dayOff = s.skip ? `<button class="hb" onclick="act('/skip/${S.date}','DELETE',null,'${t('已取消放假')}')">${t('取消放假')}</button>`
    : `<button class="hb" title="${t('這天的固定行程不算，鬧鐘會重排')}" onclick="const r=prompt('${t('放假原因')}','${t('放假')}');if(r!==null)act('/skip','POST',{date:S.date,reason:r},'${t('這天的固定行程不算，鬧鐘已重排')}')">${t('這天放假')}</button>`;
  return `<section class="hero">${calbar('', dayOff)}
      <div class="hgrid"><div><div class="eyebrow">${WDN[wdOf(S.date)]}${isToday ? ' · ' + t('今天') : S.date === shift(TODAY(), 1) ? ' · ' + t('明天') : ''}</div>
          <h1 class="date" data-t="${dt}"><span>${dt}</span></h1><br><div class="say">${saying(s)}</div></div>
        ${isToday ? '<div class="clock num" id="clock"></div>' : ''}</div>${runway(s)}</section>
    <div class="cols"><div class="stack">
      <div class="card"><h3>${mob ? t('行程') : t('時間軸')}</h3>${mob ? agenda(s.events, {del: true, now: isToday ? nowMin() : null})
        : timeline(s.events, {...rangeOf([s]), alarms: s.alarms, now: isToday ? nowMin() : null})}
        ${mob ? `<details class="adder"><summary>＋ ${t('新增行程')}</summary>${evForm}</details>` : evForm}</div>
    </div><div class="stack">
      <div class="card"><h3>${t('待辦')}</h3>
        ${x.overdue.length ? `<div class="sec">${t('逾期')}</div>` + x.overdue.map(k => taskRow(k, `<span class="pill red">${t('原訂 {0}', md(k.plan_date))}</span><a class="pill" href="#" onclick="act('/tasks/${k.id}','PATCH',{plan_date:S.date});return false">${t('移到這天')}</a>`)).join('') : ''}
        <div class="sec">${isToday ? t('今天') : md(S.date)}</div>${x.day.length ? x.day.map(k => taskRow(k)).join('') : `<div class="empty">${t('這天沒有待辦')}</div>`}
        <form class="addrow" onsubmit="event.preventDefault();act('/tasks','POST',{...formData(this),scope:'day',plan_date:S.date})"><input class="field" type="text" name="title" placeholder="${t('加一項待辦')}" required><button class="btn">${t('加入')}</button></form>
        <div class="sec">${t('這一週')}</div>${x.week.length ? x.week.map(k => taskRow(k)).join('') : mob ? '' : `<div class="empty">${t('沒有本週待辦')}</div>`}
        <form class="addrow" onsubmit="event.preventDefault();act('/tasks','POST',{...formData(this),scope:'week',plan_date:S.date})"><input class="field" type="text" name="title" placeholder="${t('這週要完成的事')}" required><button class="btn">${t('加入')}</button></form></div>
      <div class="card"><h3 title="${t('越高代表那天越滿；紅色數字是截止的數量')}">${t('未來 14 天')}</h3>
        <div class="press">${pr.map((p, i) => { const load = p.events + p.tasks + p.due.length * 2, lv = p.due.length >= 2 ? 3 : p.due.length ? 2 : load >= 4 ? 1 : 0;
          return `<button class="d ${p.date === TODAY() ? 'today' : ''}" onclick="go('day','${p.date}')" title="${p.date}${p.due.length ? ' · ' + esc(p.due.join(', ')) : ''}">
            <div class="bar h${lv}" style="--i:${i};height:${Math.round(load / maxLoad * 100)}%">${p.due.length ? `<em>${p.due.length}</em>` : ''}</div>${WD1[p.weekday]}<span class="num">${+p.date.slice(8)}</span></button>`; }).join('')}</div></div>
    </div></div>`;
};

/* ---------- 週 ---------- */
VIEW.week = async () => {
  const days = await api('/week?d=' + S.date), bar = calbar(`${md(days[0].date)} – ${md(days[6].date)}`);
  if (MOB()) return bar + `<div class="wlist">${days.map(s => { const open = s.tasks.day.filter(k => !k.done), on = s.alarms.filter(a => a.enabled);
    return `<button class="wrow ${s.date === TODAY() ? 'today' : ''}" onclick="go('day','${s.date}')"><div class="wd"><b class="num">${+s.date.slice(8)}</b><span>${WDN[wdOf(s.date)]}</span></div>
      <div class="wb">${s.events.length ? s.events.map(e => `<div class="${isDeadline(e) ? 'due' : ''}"><i class="num">${esc(e.time)}</i> ${esc(isDeadline(e) ? flagText(e) : e.title)}</div>`).join('') : `<div class="none">${s.skip ? '🚫 ' + esc(s.skip.reason || t('放假')) : '—'}</div>`}
        ${open.length ? `<div class="todo">☐ ${t('{0} 項待辦', open.length)}</div>` : ''}</div>
      ${on.length ? `<span class="al num">⏰ ${on[0].time}</span>` : ''}</button>`; }).join('')}</div>`;
  const rg = rangeOf(days);
  return bar + `<div class="week">${days.map(s => { const open = s.tasks.day.filter(k => !k.done), on = s.alarms.filter(a => a.enabled);
      return `<div class="col ${s.date === TODAY() ? 'today' : ''}"><button class="hd" onclick="go('day','${s.date}')"><b class="num">${+s.date.slice(8)}</b><span>${WDN[wdOf(s.date)]}${s.skip ? ' 🚫' : ''}</span>
          <span style="margin-left:auto" class="num">${on.length ? '⏰' + on[0].time : ''}</span></button>
        ${timeline(s.events, {...rg, pxm: 0.5, alarms: s.alarms, compact: true, now: s.date === TODAY() ? nowMin() : null})}
        <div class="mini">${open.length ? open.slice(0, 4).map(k => `<div>☐ ${esc(k.title)}</div>`).join('') + (open.length > 4 ? `<div class="muted">${t('還有 {0} 項', open.length - 4)}</div>` : '') : `<span class="muted">${t('沒有待辦')}</span>`}</div></div>`; }).join('')}</div>`;
};

/* ---------- 月 ---------- */
VIEW.month = async () => {
  const m = await api('/month?d=' + S.date), first = new Date(m.month + '-01T12:00');
  const title = LANG === 'en' ? first.toLocaleDateString(LOCALE, {month: 'long', year: 'numeric'}) : `${first.getFullYear()} 年 ${first.getMonth() + 1} 月`;
  return calbar(title) + `<div class="month"><div class="mh">${WD1.map(c => `<span>${c}</span>`).join('')}</div>
    <div class="mg">${m.days.map((d, i) => `<button class="mc ${d.in_month ? '' : 'out'} ${d.date === TODAY() ? 'today' : ''} ${d.skip ? 'skip' : ''}" style="--i:${i}" onclick="go('day','${d.date}')" title="${d.date}${d.due.length ? ' · ' + esc(d.due.join(', ')) : ''}">
      <div class="mt"><b class="num">${+d.date.slice(8)}</b>${d.alarm ? `<span class="al num">⏰ ${d.alarm}</span>` : ''}</div>
      ${d.events.slice(0, 3).map(e => `<div class="me"><i class="num">${esc(e.time)}</i> ${esc(e.title)}</div>`).join('')}
      ${d.events.length > 3 ? `<div class="me more">+${d.events.length - 3}</div>` : ''}
      ${d.due.slice(0, 2).map(k => `<div class="me due">${esc(k)}</div>`).join('')}
      <div class="md">${'<i></i>'.repeat(Math.min(d.events.length, 4))}${'<i class="t"></i>'.repeat(Math.min(d.tasks, 4))}${'<i class="d"></i>'.repeat(Math.min(d.due.length, 3))}</div></button>`).join('')}</div></div>`;
};

/* ---------- 待辦 ---------- */
VIEW.tasks = async () => {
  const all = await api('/tasks?include_done=true'), td = TODAY(), wkEnd = shift(td, 6 - wdOf(td));
  const open = all.filter(k => !k.done), done = all.filter(k => k.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, MOB() ? 6 : 15);
  const g = {逾期: [], 今天: [], 本週: [], 之後: []};
  for (const k of open) {
    const d = k.plan_date || (k.due || '').slice(0, 10) || td;
    (k.scope === 'week' ? (d < shift(td, -6) ? g.逾期 : d <= wkEnd ? g.本週 : g.之後) : d < td ? g.逾期 : d === td ? g.今天 : d <= wkEnd ? g.本週 : g.之後)
      .push(taskRow(k, k.scope === 'week' ? `<span class="pill teal">${t('整週')}</span>` : d !== td ? `<span class="pill">${md(d)}</span>` : ''));
  }
  return `<div class="cols"><div class="card"><h3>${t('未完成')} · ${open.length}</h3>
      ${Object.entries(g).filter(([, v]) => v.length).map(([k, v]) => `<div class="sec">${t(k)}</div>${v.join('')}`).join('') || `<div class="empty">${t('全部做完了 🎉')}</div>`}
      <form class="addrow" onsubmit="event.preventDefault();act('/tasks','POST',formData(this))"><input class="field" type="text" name="title" placeholder="${t('新增待辦')}" required>
        <select class="field" name="scope"><option value="day">${t('某一天')}</option><option value="week">${t('某一週')}</option></select><input class="field" type="date" name="plan_date" value="${td}">
        <input class="field" type="datetime-local" name="due" title="${t('截止（可不填）')}"><button class="btn pri">${t('加入')}</button></form></div>
    <div class="card"><h3>${t('最近完成')}</h3>${done.map(k => taskRow(k)).join('') || `<div class="empty">${t('還沒有完成的項目')}</div>`}</div></div>`;
};

/* ---------- 審核 ---------- */
const KIND = {homework: ['作業', 'sun'], exam: ['考試', 'red'], announcement: ['公告', 'teal'], event: ['行程', 'teal'], other: ['其他', '']};
VIEW.inbox = async () => {
  const items = await api('/inbox'), top = items[0];
  S.top = top ? top.id : null;
  const manual = `<details class="fold"><summary>${t('手動加一筆')}</summary>
    <form class="addrow" onsubmit="event.preventDefault();act('/inbox','POST',{...formData(this),source:'manual'})"><select class="field" name="kind">${['homework', 'exam', 'announcement', 'event'].map(k => `<option value="${k}">${t(KIND[k][0])}</option>`).join('')}</select>
      <input class="field" type="text" name="course" placeholder="${t('分類')}" style="max-width:110px"><input class="field" type="text" name="title" placeholder="${t('標題')}" required><input class="field" type="datetime-local" name="due"><button class="btn">${t('送出')}</button></form></details>`;
  if (!top) return `<div class="triage"><div class="card" style="text-align:center;padding:48px 20px"><div style="font-size:38px">📭</div><h2 style="margin:10px 0 4px">${t('沒有待審核的項目')}</h2>
    <div class="muted">${t('資料來源抓到新東西時會出現在這裡。')}</div></div>${manual}</div>`;
  const [kn, kc] = KIND[top.kind] || KIND.other, ev = top.kind === 'event';
  return `<div class="triage"><div class="muted" style="margin-bottom:10px">${t('{0} 則待審核', items.length)}</div>
    <div class="tcard" id="tcard"><div class="in"><span class="pill ${kc}">${t(kn)}</span> ${top.course ? `<span class="pill">${esc(top.course)}</span>` : ''} <span class="muted">${esc(top.source)} · ${esc(top.created.slice(5, 16))}</span>
      <h2>${esc(top.title)}</h2>${top.due ? `<div><span class="pill ${ev ? 'teal' : 'red'}">${ev ? '' : t('截止') + ' '}${esc(top.due.replace('T', ' '))}${top.end ? '–' + esc(top.end.slice(11, 16)) : ''}</span>${top.location ? ` <span class="pill">${esc(top.location)}</span>` : ''}</div>` : ''}
      ${top.body ? `<p class="muted">${esc(top.body).slice(0, 400)}</p>` : ''}${top.link ? `<p><a href="${esc(top.link)}" target="_blank" rel="noopener">${t('打開原頁 ↗')}</a></p>` : ''}
      <div class="addrow">${ev ? '' : top.kind === 'announcement' ? `<label class="muted"><input type="checkbox" id="astask"> ${t('也建立成待辦')}</label>` : `<label class="muted">${t('預計哪天做')} <input class="field" type="date" id="plan" value="${TODAY()}"></label>`}</div>
      <div class="acts"><button class="btn" onclick="triage(false)">${t('略過')}<kbd>X</kbd></button><button class="btn sun" onclick="triage(true)">${t('核准')}<kbd>A</kbd></button></div></div></div>
    ${items.length > 1 ? `<div class="card" style="margin-top:40px"><h3>${t('接下來')}</h3>${items.slice(1, 9).map(i => `<div class="task"><div class="body">${esc(i.course ? `[${i.course}] ` : '')}${esc(i.title)}</div>${i.due ? `<span class="pill">${md(i.due)}</span>` : ''}</div>`).join('')}</div>` : ''}${manual}</div>`;
};
function triage(ok) {
  if (!S.top) return;
  const id = S.top, body = {};
  if ($('#plan')) body.plan_date = $('#plan').value;
  if ($('#astask') && $('#astask').checked) body.as_task = true;
  S.top = null; S.enter = true;
  if ($('#tcard')) $('#tcard').classList.add(ok ? 'out-r' : 'out-l');   // 卡片飛出去
  setTimeout(() => ok ? act(`/inbox/${id}/approve`, 'POST', body, t('已加入')) : act(`/inbox/${id}/reject`, 'POST', null, t('已略過')), 260);
}

/* ---------- 鬧鐘 ---------- */
function ruleCard(r) {
  const wds = r.weekdays.split(',').filter(k => k !== '');
  const tog = i => { const s = new Set(wds); s.has(String(i)) ? s.delete(String(i)) : s.add(String(i)); return [...s].sort().join(','); };
  const P = (field, expr = 'this.value') => `onchange="act('/alarms/rules/${r.id}','PATCH',{${field}:${expr}})"`;
  const num = (label, field, v, unit, min = 1, max = 600) => `<label class="knob"><span>${t(label)}</span><input class="num" type="number" min="${min}" max="${max}" value="${v}" ${P(field, '+this.value')}><em>${t(unit)}</em></label>`;
  const time = (label, field, v, tip = '') => `<label class="knob" title="${tip}"><span>${t(label)}</span><input type="time" value="${esc(v || '')}" ${P(field, 'this.value||null')}></label>`;
  const follow = r.anchor === 'first_event', n = Math.min(r.count, 30), gap = Math.max(4, Math.min(22, r.interval_minutes * 2)), span = (r.count - 1) * r.interval_minutes;
  return `<div class="rule ${r.enabled ? '' : 'off'}"><div class="hd"><input value="${esc(r.name)}" ${P('name')} aria-label="${t('規則名稱')}"><span class="sp"></span>
      <button class="x" title="${t('刪除')}" onclick="if(confirm('${t('刪除「{0}」？', esc(r.name))}'))act('/alarms/rules/${r.id}','DELETE')">✕</button>
      <button class="sw ${r.enabled ? 'on' : ''}" title="${r.enabled ? t('啟用中') : t('已停用')}" onclick="act('/alarms/rules/${r.id}','PATCH',{enabled:${r.enabled ? 0 : 1}})"><i></i></button></div>
    <div class="wds">${WD1.map((c, i) => `<button class="wd ${wds.includes(String(i)) ? 'on' : ''}" title="${WDN[i]}" onclick="act('/alarms/rules/${r.id}','PATCH',{weekdays:'${tog(i)}'})">${c}</button>`).join('')}</div>
    <div class="seg sm"><button class="${follow ? 'on' : ''}" onclick="act('/alarms/rules/${r.id}','PATCH',{anchor:'first_event'})">${t('跟著行程')}</button><button class="${follow ? '' : 'on'}" onclick="act('/alarms/rules/${r.id}','PATCH',{anchor:'fixed'})">${t('固定時間')}</button></div>
    <div class="knobs">${follow ? num('提前', 'lead_minutes', r.lead_minutes, '分', 0) : time('開始', 'fixed_time', r.fixed_time || '07:00')}${num('間隔', 'interval_minutes', r.interval_minutes, '分')}${num('數量', 'count', r.count, '個', 1, 30)}
      ${follow ? time('沒行程時', 'fixed_time', r.fixed_time, t('那天沒有行程時從幾點開始響；留空就不排鬧鐘')) : ''}</div>
    <div class="dots" title="${t('從第一個到最後一個共 {0} 分鐘', span)}">${Array.from({length: n}, (_, i) => (i ? `<s style="width:${gap}px"></s>` : '') + `<i style="--i:${i}"></i>`).join('')}<span class="num">${t('{0} 分鐘', span)}</span></div></div>`;
}
VIEW.alarms = async () => {
  const tm = shift(TODAY(), 1);
  const [rules, s, p, ins] = await Promise.all([api('/alarms/rules'), api('/day?d=' + tm), api('/alarms/plan'), api('/alarms/insights')]);
  const tips = ins.suggestions.filter(k => k.patch);
  return `<section class="hero"><div class="eyebrow" title="${esc(p.preview_reason)}">${t('明天')} · ${md(tm)} ${WDN[wdOf(tm)]}</div>${runway(s)}</section>
    ${tips.map(k => `<div class="tip" title="${esc(k.text)}"><span>💡</span><div><b>${esc(k.rule)}</b>　${esc(k.short || k.text)}</div>
      <button class="btn sun" onclick='act("/alarms/rules/${k.rule_id}","PATCH",${JSON.stringify(k.patch)},"${t('已套用')}")'>${t('套用')}</button></div>`).join('')}
    <div class="rules">${rules.map(ruleCard).join('')}
      <button class="rule add" onclick="act('/alarms/rules','POST',{name:'${t('新規則')}',weekdays:'',anchor:'first_event',lead_minutes:90,count:6,interval_minutes:5})"><span>＋</span>${t('新增規則')}</button></div>
    ${ins.mornings.length ? `<details class="fold"><summary>${t('起床紀錄')}</summary><div class="card">${ins.mornings.slice(0, 10).map(m => `<div class="task"><div class="body num">${md(m.date)} ${WDN[m.weekday]}　${m.first}–${m.last}　→　<b>${m.awake}</b><span class="muted">　${m.rang}/${m.count}</span></div></div>`).join('')}</div></details>` : ''}`;
};

/* ---------- 固定行程 ---------- */
VIEW.weekly = async () => {
  const w = await api('/weekly');
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => ({events: w.filter(k => k.weekday === d).map(k => ({...k, time: k.start_time, source: 'tt'}))}));
  const form = `<div class="card" style="margin-bottom:18px"><h3>${t('每週固定行程')}</h3>
      <form class="addrow" style="margin:0" onsubmit="event.preventDefault();const f=formData(this);f.weekday=+f.weekday;act('/weekly','POST',f,'${t('已加入')}')">
        <select class="field" name="weekday">${WDN.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select><input class="field" type="time" name="start_time" required><input class="field" type="time" name="end_time">
        <input class="field" type="text" name="title" placeholder="${t('名稱（課、班、健身…）')}" required><input class="field" type="text" name="location" placeholder="${t('地點')}" style="max-width:120px"><button class="btn pri">${t('加入')}</button></form></div>`;
  const del = e => `<a href="#" class="x" onclick="act('/weekly/${e.id}','DELETE');return false" aria-label="${t('刪除')}">✕</a>`;
  if (MOB()) return form + `<div class="wlist">${days.map((s, d) => s.events.length ? `<div class="wrow"><div class="wd"><b>${WD1[d]}</b></div>
      <div class="wb">${s.events.map(e => `<div><i class="num">${esc(e.start_time)}${e.end_time ? '–' + esc(e.end_time) : ''}</i> ${esc(e.title)}${e.location ? ` <em>${esc(e.location)}</em>` : ''} ${del(e)}</div>`).join('')}</div></div>` : '').join('')}</div>`;
  const rg = {start: 480, end: 1080};
  if (w.length) { rg.start = Math.floor(Math.min(...w.map(k => mins(k.start_time))) / 60) * 60; rg.end = Math.ceil(Math.max(...w.map(k => mins(k.end_time || k.start_time) + (k.end_time ? 0 : 50))) / 60) * 60; }
  return form + `<div class="week">${days.map((s, d) => `<div class="col"><div class="hd"><b>${WDN[d]}</b></div>${timeline(s.events.map(e => ({...e, id: null})), {...rg, pxm: 0.7})}
      <div class="mini">${s.events.map(e => `<div>${esc(e.start_time)} ${esc(e.title)} ${del(e)}</div>`).join('') || '<span class="muted">—</span>'}</div></div>`).join('')}</div>`;
};

/* ---------- 設定 ---------- */
const sent = r => { const ok = Object.entries(r).filter(([, v]) => v !== '未設定'); toast(ok.length ? ok.map(([k, v]) => `${k}: ${v}`).join(' | ') : t('還沒有設定任何通知管道')); };
VIEW.link = async () => {
  const [st, br] = await Promise.all([api('/status'), api('/brief')]);
  const url = st.urls[0] || `http://${t('這台電腦的IP')}:${location.port || 80}`;
  const pref = palPref(), th = document.documentElement.dataset.theme;
  const look = `<div class="card"><h3>${t('外觀')}</h3><dl class="kv">
      <dt>${t('語言')}</dt><dd><div class="seg sm"><button class="${LANG === 'zh' ? 'on' : ''}" onclick="setLang('zh')">中文</button><button class="${LANG === 'en' ? 'on' : ''}" onclick="setLang('en')">English</button></div></dd>
      <dt>${t('主題')}</dt><dd><div class="seg sm"><button class="${th === 'dark' ? 'on' : ''}" onclick="if('${th}'!=='dark')toggleTheme().then(render)">${t('暗色')}</button><button class="${th === 'light' ? 'on' : ''}" onclick="if('${th}'!=='light')toggleTheme().then(render)">${t('亮色')}</button></div></dd>
      <dt>${t('色系')}</dt><dd><div class="pals"><button class="palm ${pref === 'auto' ? 'on' : ''}" onclick="setPalPref('auto')" title="${t('每一頁一個顏色，日曆跟著時段和星期變')}">${t('自動搭配')}</button>
        <button class="palm ${pref === 'random' ? 'on' : ''}" onclick="setPalPref('random')" title="${t('每換一頁隨機換一個顏色')}">🎲 ${t('隨機')}</button>
        ${Object.entries(PAL).map(([k, c]) => `<button class="pal ${pref === k ? 'on' : ''}" onclick="setPalPref('${k}')" title="${t(PAL_NAME[k])}" aria-label="${t(PAL_NAME[k])}" style="background:linear-gradient(135deg,${c.a.join(',')})"></button>`).join('')}</div></dd></dl></div>`;
  return `<div class="cols"><div class="stack">${look}
    <div class="card"><h3>${t('手機 App')}</h3><dl class="kv"><dt>${t('伺服器網址')}</dt><dd>${st.urls.length ? st.urls.map(u => `<code>${esc(u)}</code>`).join(' ') : `<code>${esc(url)}</code>`}</dd><dt>${t('存取碼')}</dt><dd><code>${esc(st.phone_token)}</code></dd>
      <dt>${t('最後同步')}</dt><dd>${st.phone_last_sync ? esc(st.phone_last_sync.replace('T', ' ')) : `<span class="no">${t('還沒連上來過')}</span>`}</dd>
      <dt>${t('手機瀏覽器')}</dt><dd><code>${esc(url)}/?token=…</code></dd></dl></div>
    <div class="card"><h3>${t('資料來源')} <span class="r muted">${t('每 {0} 分鐘', st.sync_minutes)}</span></h3>
      ${st.sources.map(k => `<div class="src"><div><b>${esc(k.label)}</b><div class="muted">${k.configured ? esc(k.last || t('還沒執行過')) : t('在 .env 填') + ' ' + k.env.map(e => `<code>${e}</code>`).join(' ')}</div></div>
        ${k.configured ? `<button class="btn" onclick="toast('${t('抓取中…')}');api('/sources/${k.name}/run','POST').then(r=>{toast(r.ok?t('抓到 {0} 筆，新增 {1} 筆',r.total,r.new):r.message);render()})">${t('立刻抓')}</button>` : `<span class="no">○ ${t('未設定')}</span>`}</div>`).join('')}</div>
  </div><div class="stack">
    <div class="card"><h3>${t('通知')} <span class="r"><button class="btn" onclick="api('/notify/test','POST').then(sent)">${t('測試')}</button></span></h3>
      <div class="chips">${st.channels.map(c => `<span class="chip ${c.configured ? 'on' : ''}" title="${c.configured ? t('已設定') : t('在 .env 填') + ' ' + c.env.join(', ')}">${esc(c.label)}</span>`).join('')}</div>
      <dl class="kv" style="margin-top:14px"><dt>${t('早上簡報')}</dt><dd class="num">${esc(st.morning)}</dd><dt>${t('晚上預告')}</dt><dd class="num">${esc(st.evening)}</dd></dl>
      <details class="fold in"><summary>${t('今晚會推播的內容')}</summary><pre class="brief">${esc(br.text)}</pre>
        <button class="btn" style="margin-top:10px" onclick="api('/notify/brief','POST').then(r=>sent(r.result))">${t('現在推播')}</button></details></div>
    <div class="muted" style="padding:0 6px">${t('設定都在 .env，改完重新啟動才會生效。')}</div>
  </div></div>`;
};

/* ---------- 頂列：指令列、語言、亮暗 ---------- */
const TYPE = {event: '📅', task: '☑️', alarm: '⏰', weekly: '🗓', error: '⚠️'};
const setPlaceholder = () => $('#cmd').placeholder = MOB() ? t('說一句話：明天三點 開會') : t('說一句話：明天下午三點 開會 @會議室｜週五前 交報告｜鬧鐘 明天 7:30');
setPlaceholder();
$('#theme').title = t('切換亮色／暗色');
$('#theme').onclick = () => toggleTheme().then(() => { if (S.view === 'link') render(); });
mqMobile.addEventListener('change', () => { setPlaceholder(); render(); });

let pvTimer;
$('#cmd').addEventListener('input', e => {
  clearTimeout(pvTimer);
  const text = e.target.value.trim();
  if (!text) return ($('#pv').hidden = true);
  pvTimer = setTimeout(async () => {
    const p = await api('/quick', 'POST', {text, dry: true}), pv = $('#pv');
    if ($('#cmd').value.trim() !== text) return;            // 這段時間使用者又改了或刪掉了
    pv.className = 'pv' + (p.type === 'error' ? ' err' : '');
    pv.innerHTML = `${TYPE[p.type] || ''} <b>${esc(p.summary.split('｜')[0])}</b> ${esc(p.summary.split('｜').slice(1).join(' · '))}<span>${p.type === 'error' ? '' : t('Enter 建立')}</span>`;
    pv.hidden = false;
  }, 140);
});
$('#cmd').addEventListener('keydown', async e => {
  if (e.key === 'Escape') { clearTimeout(pvTimer); e.target.value = ''; $('#pv').hidden = true; e.target.blur(); }
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const p = await api('/quick', 'POST', {text: e.target.value});
  if (p.type === 'error') return toast(p.summary);
  clearTimeout(pvTimer); e.target.value = ''; $('#pv').hidden = true; toast(t('已建立：') + p.summary.replaceAll('｜', ' · ')); render();
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#cmd').focus(); return; }
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.view === 'inbox' && k === 'a') triage(true);
  if (S.view === 'inbox' && k === 'x') triage(false);
  if (isCal(S.view)) {           // 日曆：D/W/M 切換，←/→ 前後，T 回今天
    if ({d: 'day', w: 'week', m: 'month'}[k]) go({d: 'day', w: 'week', m: 'month'}[k]);
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    if (k === 't') go(S.view, TODAY());
  }
});
setInterval(() => { if (S.view === 'day' && !/INPUT|SELECT/.test(document.activeElement.tagName)) render(); }, 60000);
render();
