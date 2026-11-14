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
S.view = S.cal = ['day', 'week', 'month'].includes(store.get('cal3')) ? store.get('cal3') : 'week';
if (['day', 'week', 'month'].includes(QS.get('view'))) S.view = S.cal = QS.get('view');
else if (['tasks', 'inbox', 'alarms', 'weekly', 'link', 'activity'].includes(QS.get('view'))) S.view = QS.get('view');
if (/^\d{4}-\d{2}-\d{2}$/.test(QS.get('date') || '')) S.date = QS.get('date');

const NATIVE = !!window.AsaNative;
let syncT = 0;
function nativeSync() { if (NATIVE) { clearTimeout(syncT); syncT = setTimeout(() => { try { AsaNative.sync(); } catch { /* 舊版 App */ } }, 400); } }
window.onNativeSync = () => { if (S.view === 'alarms' || S.view === 'link') render(); };   // App 同步完會呼叫
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {method, headers: {'X-Lang': LANG, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok) {
    let m = await r.text(); try { m = JSON.parse(m).detail || m; } catch { /* 不是 JSON 就照原樣 */ }
    toast(r.status === 409 || r.status === 404 ? m : t('操作失敗：') + String(m).slice(0, 120)); throw new Error(r.status);
  }
  if (method !== 'GET') nativeSync();
  return r.json();
}
function toast(msg) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const el = Object.assign(document.createElement('div'), {className: 'toast', textContent: msg});
  document.body.append(el); setTimeout(() => el.remove(), 2600);
}
/* 自己畫的確認框（比瀏覽器內建的好看，手機上也不會擋住整個畫面） */
function ask(msg, ok = t('刪除'), danger = true) {
  return new Promise(done => {
    const d = document.createElement('div');
    d.className = 'ask';
    d.innerHTML = `<div class="askbox" role="alertdialog" aria-modal="true"><p>${esc(msg)}</p>
      <div class="askrow"><button class="btn" data-v="0">${t('取消')}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-v="1">${esc(ok)}</button></div></div>`;
    const close = v => { d.classList.add('out'); setTimeout(() => d.remove(), 180); document.removeEventListener('keydown', key); done(v); };
    const key = e => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
    d.onclick = e => { if (e.target === d) close(false); const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v === '1'); };
    document.addEventListener('keydown', key);
    document.body.append(d);
    d.querySelector('[data-v="1"]').focus();
  });
}
/* 刪除前先問；確定之後那一列先縮起來再消失 */
const ASK = [[/^\/skip\//, '取消這天的放假？鬧鐘會依行程重排。', '取消放假'], [/^\/profiles\//, '移除這位成員？他的資料檔會保留在 data 資料夾。', '移除'],
  [/^\/alarms\/rules\//, '刪除這條鬧鐘規則？'], [/^\/alarms\/plan\//, '刪除這個鬧鐘？'], [/^\/weekly\//, '刪除這個固定行程？之後每週都不會再出現。'],
  [/^\/events\//, '刪除這個行程？'], [/^\/tasks\//, '刪除這項待辦？']];
async function confirmDelete(path, row) {
  const [, msg, ok] = ASK.find(([re]) => re.test(path)) || [, '確定要刪除嗎？'];
  if (!await ask(t(msg), t(ok || '刪除'))) return false;
  if (row) { row.style.height = row.offsetHeight + 'px'; row.classList.add('gone'); await new Promise(r => setTimeout(r, 260)); }
  return true;
}
const rowOf = () => { const el = window.event && window.event.target; return el && el.closest && el.closest('.task,.ev,.ag,.wrow,.rule,.mem'); };
const act = async (path, method, body, msg) => {
  if (method === 'DELETE' && !await confirmDelete(path, rowOf())) return;
  await api(path, method, body); if (msg) toast(msg); render();
};

/* ---------- 成員：只有一個人用的時候 P.multi 是 false，下面這些都不會出現 ---------- */
let P = {me: {id: 1, name: '', alarm_mode: 'app'}, multi: false, local: true, admin: true, list: []};
const loadP = async () => { P = await api('/profiles'); };
const pact = async (path, method, body, msg) => {
  if (method === 'DELETE' && !await confirmDelete(path, rowOf())) return;
  await api(path, method, body); await loadP(); if (msg) toast(msg); render();
};
const own = x => x.owner ? '?owner=' + x.owner : '';                       // 別人共用給我的那一筆，要註明是誰的
const DUO = '<svg class="duoi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 14c2.7-.2 4.9 1.4 5.5 4.6"/></svg>';
const duo = x => P.multi && (x.owner || x.shared) ? DUO + ' ' : '';
const who = x => P.multi && (x.owner || x.shared) ? `<span class="pill duo">${DUO}${x.owner_name ? ' ' + esc(x.owner_name) : ''}</span>` : '';
const shareBox = () => P.multi ? `<label class="share" title="${t('其他成員也看得到')}"><input type="checkbox" name="shared"><span>${DUO} ${t('一起')}</span></label>` : '';
/* 頭貼：有上傳就用照片，沒有就是顏色圓圈加名字第一個字 */
const face = (p, cls = '') => p.avatar ? `<img class="face ${cls}" src="${esc(p.avatar)}" alt="">`
  : `<span class="face ${cls}" style="--c:${esc(p.color || '#7c5cff')}">${esc([...(p.name || '?')][0].toUpperCase())}</span>`;
/* 選圖 → 裁成正中間的正方形、縮成 256px → 上傳 */
function pickAvatar(pid) {
  const inp = Object.assign(document.createElement('input'), {type: 'file', accept: 'image/*'});
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const n = Math.min(img.width, img.height), c = Object.assign(document.createElement('canvas'), {width: 256, height: 256});
      c.getContext('2d').drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, 256, 256);
      URL.revokeObjectURL(img.src);
      await api(`/profiles/${pid}/avatar`, 'POST', {data: c.toDataURL('image/jpeg', .86)});
      await loadP(); toast(t('頭貼已更新')); render();
    };
    img.onerror = () => toast(t('讀不了這張圖'));
    img.src = URL.createObjectURL(file);
  };
  inp.click();
}
/* 設定頁裡的選項：只存檔、不重畫整頁（重畫會閃一下） */
async function quietSave(pid, body) { await api(`/profiles/${pid}`, 'PATCH', body); await loadP(); drawRail(); }
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
let navAt = null;
function moveInd(rail, b, animate) {
  const ind = rail.querySelector('.ind'); if (!ind || !b) return;
  const to = {x: b.offsetLeft, w: b.offsetWidth};
  if (!animate || !navAt || CALM) { ind.style.transition = 'none'; ind.style.transform = `translateX(${to.x}px)`; ind.style.width = to.w + 'px'; void ind.offsetWidth; ind.style.transition = ''; }
  else { ind.style.transform = `translateX(${to.x}px)`; ind.style.width = to.w + 'px'; }
  navAt = to;
}
document.addEventListener('click', e => {               // 一點下去底色就先滑過去，不用等新頁面
  const b = e.target.closest && e.target.closest('#rail .nav'); if (!b) return;
  $('#rail').querySelectorAll('.nav').forEach(x => x.classList.toggle('on', x === b)); moveInd($('#rail'), b, true);
}, true);
function drawRail() {
  const rail = $('#rail');
  rail.innerHTML = '<i class="ind"></i>' + NAV.filter(([k]) => k !== 'alarms' || P.me.alarm_mode !== 'off').map(([k, v]) => {
    const on = k === 'cal' ? isCal(S.view) : S.view === k;
    return `<button class="nav ${on ? 'on' : ''}" onclick="go('${k === 'cal' ? S.cal : k}')">${k === 'link' && P.me.avatar ? face(P.me, 'navface') : `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`}<span>${k === 'link' && P.multi ? esc(P.me.name) : t(v)}</span>${k === 'inbox' && S.inbox ? `<span class="dot">${S.inbox}</span>` : ''}</button>`;
  }).join('');
  if (navAt) { const ind = rail.querySelector('.ind'); ind.style.transition = 'none'; ind.style.transform = `translateX(${navAt.x}px)`; ind.style.width = navAt.w + 'px'; void ind.offsetWidth; ind.style.transition = ''; }
  if (!navAt) moveInd(rail, rail.querySelector('.nav.on'), false);          // 第一次：直接放到位
  else requestAnimationFrame(() => moveInd(rail, rail.querySelector('.nav.on'), true));
}
addEventListener('resize', () => moveInd($('#rail'), $('#rail .nav.on'), false));
function go(v, d) {
  S.view = v; if (isCal(v)) { S.cal = v; store.set('cal3', v); }
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
  const ab = $('#actbtn'); ab.hidden = !P.multi;
  if (P.multi) { const u = S.view === 'activity' ? 0 : (await api('/activity/unread')).n; ab.querySelector('.dot').hidden = !u; ab.querySelector('.dot').textContent = u; ab.classList.toggle('on', S.view === 'activity'); }
  drawRail();
  document.body.classList.toggle('bare', bare());
  if (!bare()) $('#mtitle').innerHTML = '';
  $('#view').innerHTML = html;
  decorate();
  window.scrollTo(0, y);
}

/* ---------- 共用元件 ---------- */
function taskRow(x, extra = '') {
  const due = x.due ? `<span class="pill ${x.due.slice(0, 10) <= TODAY() && !x.done ? 'red' : ''}">${t('截止 {0}', md(x.due) + ' ' + x.due.slice(11, 16))}</span>` : '';
  const title = x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title);
  return `<div class="task ${x.done ? 'done' : ''} ${S.pop === x.id ? 'pop' : ''}">
    <button class="chk ${x.done ? 'on' : ''}" onclick="checkTask(this,${x.id},'${own(x)}',${x.done ? 0 : 1})" aria-label="${t('完成')}">
      <span class="ring"></span><span class="fill"></span><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/></svg></button>
    <div class="body"><span class="tt">${title}</span>${due || extra || who(x) ? `<div class="meta">${due}${extra}${who(x)}</div>` : ''}</div>
    <button class="x" onclick="act('/tasks/${x.id}${own(x)}','DELETE')" aria-label="${t('刪除')}">✕</button></div>`;
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
    h += `<div class="ev ${b.source === 'weekly' ? 'weekly' : ''} ${b.id && b.source !== 'tt' ? 'open' : ''}" ${b.id && b.source !== 'tt' ? `onclick="openEvent(${b.id},${b.owner || 0})"` : ''} style="top:${top(b.s)}px;height:${height}px;left:calc(${b.lane * 100 / n}% + 2px);width:calc(${100 / n}% - 4px)" title="${esc(b.time)} ${esc(b.title)}">
      <b>${duo(b)}${esc(b.title)}${b.comments ? ` <span class="cc">${BUBBLE}${b.comments}</span>` : ''}</b>${compact ? '' : `<span class="num">${esc(b.time)}${b.end_time ? '–' + esc(b.end_time) : ''}</span>${b.location ? ' · ' + esc(b.location) : ''}${b.source === 'weekly' ? ' · ' + t('每週') : ''}`}
      ${b.id && !compact ? `<button class="x" onclick="event.stopPropagation();act('/${b.source === 'tt' ? 'weekly' : 'events'}/${b.id}${own(b)}','DELETE')">✕</button>` : ''}</div>`;
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
    : `<div class="ag ${e.source === 'weekly' ? 'weekly' : ''} ${e.id ? 'open' : ''} ${now !== null && (e.end_time ? mins(e.end_time) : mins(e.time) + 50) < now ? 'past' : ''}" ${e.id ? `onclick="openEvent(${e.id},${e.owner || 0})"` : ''}><i class="num">${esc(e.time)}${e.end_time ? `<s>${esc(e.end_time)}</s>` : ''}</i>
        <b>${duo(e)}${esc(e.title)}${e.location ? `<em>${esc(e.location)}</em>` : ''}</b>${e.comments ? `<span class="cc">${BUBBLE}${e.comments}</span>` : ''}${del && e.id ? `<button class="x" onclick="event.stopPropagation();act('/events/${e.id}${own(e)}','DELETE')">✕</button>` : ''}</div>`).join('')}</div>`;
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
/* 風格：vivid＝極光、發光、漸層；simple＝像 TimeTree 一樣乾淨的平面設計 */
const styleNow = () => store.get('style') === 'simple' ? 'simple' : 'vivid';
function setStyle(v) {
  store.set('style', v); document.documentElement.dataset.style = v;
  if (v === 'simple') { $('#aurora').innerHTML = ''; aurora = null; }
  pal = null; setPal(); render();
}
/* 手機切到背景一陣子，瀏覽器會收回 WebGL，回來時背景變成一片白：偵測到就重建 */
let glLost = false;
$('#aurora').addEventListener('webglcontextlost', e => { e.preventDefault(); glLost = true; }, true);
function rebuildAurora() {
  const cv = $('#aurora canvas');
  if (!glLost && cv && !(cv.getContext('webgl2')?.isContextLost?.())) return;
  glLost = false; $('#aurora').innerHTML = ''; aurora = null; pal = null; setPal();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) rebuildAurora(); });
addEventListener('pageshow', e => { if (e.persisted) { glLost = true; rebuildAurora(); } });
function setPal() {
  const p = palNow();
  if (p === pal) return;
  pal = p;
  const c = PAL[p], root = document.documentElement;
  root.dataset.pal = p;
  ['--a1', '--a2', '--a3'].forEach((k, i) => root.style.setProperty(k, c.a[i]));
  setBorderGlowPalette(c.a, c.glow, 0.9);
  if (styleNow() === 'simple') return;
  if (!aurora) aurora = createAurora($('#aurora'), {stops: c.stops, amplitude: 1.15, blend: 0.6, height: 0.5, glow: 0.75, layers: 3, speed: 0.9, brightness: 0.9, opacity: 0.85});
  else aurora.set({stops: c.stops});
}
function decorate() {
  const v = $('#view');
  v.querySelectorAll('.card').forEach((c, i) => { c.classList.add('border-glow-card'); c.style.setProperty('--i', i + 2); c.insertAdjacentHTML('beforeend', '<span class="edge-light"></span>'); });
  v.querySelectorAll('.week .col,.rules .rule,.wlist .wrow').forEach((c, i) => c.style.setProperty('--i', i));
  v.querySelectorAll('.hero>*').forEach((c, i) => c.style.setProperty('--i', i));
  v.querySelectorAll('.seg').forEach(segSync);
  v.classList.toggle('enter', !!S.enter);
  S.enter = false; S.pop = null;
  reveal(v);
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
  if (P.me.alarm_mode === 'off') return '';
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
/* ---------- 互相叫起床 ---------- */
function wakePill(w, o) {
  if (!w) return o.alarm ? `<span class="r muted num" title="${t('第一個鬧鐘')}">⏰ ${esc(o.alarm)}</span>` : '';
  const btn = `<button class="btn nudge ${w.state === 'late' ? 'sun' : ''}" onclick="nudge(${o.id},'${esc(o.name).replace(/'/g, '')}')">📣 ${t('叫他起床')}</button>`;
  if (w.state === 'awake') return `<span class="r pill teal num">☀️ ${t('{0} 起床', esc(w.at))}</span>`;
  if (w.state === 'late') return `<span class="r wk-st"><span class="pill red">😴 ${t('還沒起床')}</span>${btn}</span>`;
  if (w.state === 'ringing') return `<span class="r wk-st"><span class="pill sun num">⏰ ${t('鬧鐘在響')}</span>${btn}</span>`;
  return w.first ? `<span class="r muted num" title="${t('第一個鬧鐘')}">⏰ ${esc(w.first)}</span>` : '';
}
async function nudge(id, name) {
  const r = await api('/wake/nudge/' + id, 'POST');
  toast(r.how === 'app' ? t('已叫 {0}：手機會大聲響', name) : t('已推播叫 {0}', name));
}
async function iAmAwake() {
  const r = await api('/wake/awake', 'POST');
  toast(t('早安！{0} 起床', r.at)); render();
}
function wakeBar(s) {
  const w = s.wake;
  if (!w || !['ringing', 'late'].includes(w.state)) return '';
  return `<div class="wakebar ${w.state}"><div class="wb-t"><b>${w.state === 'late' ? t('還沒起床嗎？') : t('早安，起床了嗎？')}</b>
      <span>${w.nudged ? '📣 ' + t('{0} 在叫你', esc(w.nudged)) : t('按下去就不會再叫你') + (P.multi ? t('，也會讓對方知道') : '')}</span></div>
    <button class="btn sun" onclick="iAmAwake()">☀️ ${t('我醒了')}</button></div>`;
}
function othersCard(s) {
  const ws = Object.fromEntries((s.wake_others || []).map(w => [w.id, w]));
  return (s.others || []).map(o => `<div class="card other"><h3>${face(o, 'sm')}${esc(o.name)}
      ${wakePill(ws[o.id], o)}</h3>
    ${o.events.length ? `<div class="agenda">${o.events.map(e => `<div class="ag"><i class="num">${esc(e.time)}${e.end_time ? `<s>${esc(e.end_time)}</s>` : ''}</i>
      <b>${e.title === null ? `<span class="muted">${t('有事')}</span>` : esc(e.title)}${e.location ? `<em>${esc(e.location)}</em>` : ''}</b></div>`).join('')}</div>`
      : `<div class="empty">${t('這天沒有行程')}</div>`}</div>`).join('');
}
const VIEW = {};
VIEW.day = async () => {
  const [s, pr] = await Promise.all([api('/day?d=' + S.date), api('/pressure')]);
  const isToday = S.date === TODAY(), mob = MOB(), dt = dateText(S.date);
  const maxLoad = Math.max(3, ...pr.map(p => p.events + p.tasks + p.due.length * 2)), x = s.tasks;
  const evForm = `<form class="addrow" onsubmit="event.preventDefault();const f=formData(this);act('/events','POST',{title:f.title,start:S.date+'T'+f.time,end:f.end?S.date+'T'+f.end:null,location:f.location||'',shared:f.shared?1:0})">
      <input class="field" type="time" name="time" required><input class="field" type="time" name="end" title="${t('結束（可不填）')}">
      <input class="field" type="text" name="title" placeholder="${t('新增行程')}" required><input class="field" type="text" name="location" placeholder="${t('地點')}" style="max-width:110px">${shareBox()}<button class="btn pri">${t('加入')}</button></form>`;
  const dayOff = s.skip ? `<button class="hb" onclick="act('/skip/${S.date}','DELETE',null,'${t('已取消放假')}')">${t('取消放假')}</button>` : '';
  return `<section class="hero">${calbar('', dayOff)}
      <div class="hgrid"><div><div class="eyebrow">${WDN[wdOf(S.date)]}${isToday ? ' · ' + t('今天') : S.date === shift(TODAY(), 1) ? ' · ' + t('明天') : ''}</div>
          <h1 class="date" data-t="${dt}"><span>${dt}</span></h1>${s.skip ? `<div class="say">🚫 ${esc(s.skip.reason || t('放假'))}</div>` : ''}</div>
        ${isToday ? '<div class="clock num" id="clock"></div>' : ''}</div>${wakeBar(s)}${runway(s)}</section>
    <div class="cols"><div class="stack">
      <div class="card"><h3>${mob ? t('行程') : t('時間軸')}</h3>${mob ? agenda(s.events, {del: true, now: isToday ? nowMin() : null})
        : timeline(s.events, {...rangeOf([s]), alarms: s.alarms, now: isToday ? nowMin() : null})}
        ${mob ? `<details class="adder"><summary>＋ ${t('新增行程')}</summary>${evForm}</details>` : evForm}</div>
    </div><div class="stack">
      ${othersCard(s)}
      <div class="card"><h3 title="${t('越高代表那天越滿；紅色數字是截止的數量')}">${t('未來 14 天')}</h3>
        <div class="press">${pr.map((p, i) => { const load = p.events + p.tasks + p.due.length * 2, lv = p.due.length >= 2 ? 3 : p.due.length ? 2 : load >= 4 ? 1 : 0;
          return `<button class="d ${p.date === TODAY() ? 'today' : ''}" onclick="go('day','${p.date}')" title="${p.date}${p.due.length ? ' · ' + esc(p.due.join(', ')) : ''}">
            <div class="bar h${lv}" style="--i:${i};height:${Math.round(load / maxLoad * 100)}%">${p.due.length ? `<em>${p.due.length}</em>` : ''}</div>${WD1[p.weekday]}<span class="num">${+p.date.slice(8)}</span></button>`; }).join('')}</div></div>
    </div></div>`;
};

/* ---------- 週 ---------- */
/* 週（預設畫面）：七天各一格，行程用跟月曆一樣的彩色標籤；點一天拉出那天的面板 */
VIEW.week = async () => {
  const days = await api('/week?d=' + S.date), mob = MOB(), a = days[0].date, b = days[6].date;
  const bar = calbar(mob && a.slice(0, 7) === b.slice(0, 7) ? `${md(a)}–${+b.slice(8)}` : `${md(a)} – ${md(b)}`);
  const colorOf = e => e.owner ? (P.list.find(p => p.id === e.owner) || {}).color || hue(e.title) : hue(e.title);
  const item = e => isDeadline(e) ? `<div class="wl d"><i class="num">${esc(e.time)}</i>${esc(flagText(e))}</div>`
    : `<div class="wl" style="--c:${esc(colorOf(e))}"><i class="num">${esc(e.time)}</i><span>${duo(e)}${esc(e.title)}</span>${e.comments ? `<em>${BUBBLE}${e.comments}</em>` : ''}</div>`;
  return bar + `<div class="wk ${mob ? 'rows' : 'cols'}" id="wkgrid">${days.map(s => { const on = s.alarms.filter(a => a.enabled), w = wdOf(s.date);
    return `<button class="wd2 ${s.date === TODAY() ? 'today' : ''} ${w > 4 ? 'we' : ''}" onclick="openDaySheet('${s.date}')">
      <div class="wdh"><span>${WD1[w]}</span><b class="dn num">${+s.date.slice(8)}</b>${on.length && P.me.alarm_mode !== 'off' ? `<em class="num">⏰${on[0].time}</em>` : ''}</div>
      <div class="wdb">${s.events.length ? s.events.map(item).join('') : `<span class="none">${s.skip ? '🚫 ' + esc(s.skip.reason || t('放假')) : ''}</span>`}</div></button>`; }).join('')}</div>`;
};
VIEW.week_old = async () => {
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
/* 月曆（首頁）：格子裡直接寫行程名稱、依種類上色；點一天，下面列出那天的行程 */
/* 月曆（首頁），參考 TimeTree：格子撐滿整個畫面、行程名稱直接寫在格子裡；
   手機上點一天，從底部拉出那天的面板；右下角「＋」新增 */
const bare = () => false;
async function pickDay(d) {
  if (d.slice(0, 7) !== S.date.slice(0, 7)) return go('month', d);
  S.date = d;
  if (MOB()) { document.querySelectorAll('.cal .mc.sel').forEach(x => x.classList.remove('sel')); document.querySelector(`.cal .mc[data-d="${d}"]`)?.classList.add('sel'); return openDaySheet(d); }
  await render();
}
/* 行程標籤的顏色：一起的用對方的顏色，其他依名稱固定配一個（同一門課每次都同色，像 TimeTree 那樣五顏六色但不亂） */
const LBC = ['#f0a020', '#8e6cef', '#2fb47c', '#3a9ad9', '#e8577a', '#ff7f3f', '#c862c2', '#17a8a0', '#6f8cff', '#b98a2e'];
const hue = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return LBC[h % LBC.length]; };
const label = e => `<div class="lb ${e.kind}" style="--c:${esc(e.color || hue(e.title))}">${esc(e.title)}</div>`;
function dayPanel(s, inSheet) {
  const on = s.alarms.filter(a => a.enabled), evs = s.events.filter(e => !isDeadline(e)), d = s.date;
  const due = s.tasks.upcoming_due.filter(k => k.due.slice(0, 10) === d);
  return `<div class="dph"><div><b>${md(d)}</b> <span class="muted">${WDN[wdOf(d)]}${d === TODAY() ? ' · ' + t('今天') : ''}</span></div>
      <button class="hb" onclick="${inSheet ? 'closeSheet(true);' : ''}go('day','${d}')">${t('看這天')} ›</button></div>
    ${s.skip ? `<div class="dpnote">🚫 ${esc(s.skip.reason || t('放假'))}</div>` : ''}
    ${P.me.alarm_mode !== 'off' ? `<div class="dpnote">⏰ ${on.length ? t('{0} 起，共 {1} 個鬧鐘', on[0].time, on.length) : t('這天沒有排鬧鐘')}</div>` : ''}
    ${evs.length ? agenda(evs, {del: true, now: d === TODAY() ? nowMin() : null}) : `<div class="empty">${t('這天沒有行程')}</div>`}
    ${due.length ? `<div class="sec">${t('截止')}</div>` + due.map(k => taskRow(k)).join('') : ''}
    <details class="adder" ${inSheet === 'add' ? 'open' : ''}><summary>＋ ${t('新增行程')}</summary><form class="evadd" onsubmit="event.preventDefault();addEventOn(this,'${d}',${inSheet ? 'true' : 'false'})">
      <input class="field big" type="text" name="title" placeholder="${t('新增行程')}" required autocomplete="off">
      <div class="evrow"><label class="lf"><span>${t('開始')}</span><input class="field" type="time" name="time" required></label><label class="lf"><span>${t('結束')}</span><input class="field" type="time" name="end"></label></div>
      <div class="evrow"><input class="field" type="text" name="location" placeholder="${t('地點')}">${shareBox()}<button class="btn pri">${t('加入')}</button></div></form></details>
    ${othersCard(s).replace(/class="card other"/g, 'class="other in"')}`;
}
async function addEventOn(f, d, inSheet) {
  const v = formData(f);
  await api('/events', 'POST', {title: v.title, start: d + 'T' + v.time, end: v.end ? d + 'T' + v.end : null, location: v.location || '', shared: v.shared ? 1 : 0});
  toast(t('已加入')); if (inSheet) await openDaySheet(d); render();
}
async function openDaySheet(d, add) {
  const s = await api('/day?d=' + d);
  let box = document.querySelector('.sheetwrap');
  if (!box) {
    box = document.createElement('div'); box.className = 'ask sheetwrap';
    box.onclick = ev => { if (ev.target === box) closeSheet(); };
    document.body.append(box); document.addEventListener('keydown', sheetKey);
  }
  box.innerHTML = `<div class="askbox sheet daysheet" role="dialog" aria-modal="true"><div class="grab"></div>${dayPanel(s, add ? 'add' : true)}</div>`;
  box.querySelectorAll('.seg').forEach(segSync);
  if (add) setTimeout(() => box.querySelector('.evadd [name=title]')?.focus(), 250);
}
VIEW.month = async () => {
  const mob = MOB();
  const [m, s] = await Promise.all([api('/month?d=' + S.date), mob ? null : api('/day?d=' + S.date)]), first = new Date(m.month + '-01T12:00');
  const title = LANG === 'en' ? `${first.toLocaleDateString(LOCALE, {month: 'long'})} <small>${first.getFullYear()}</small>` : `${first.getMonth() + 1} 月 <small>${first.getFullYear()}</small>`;
  // 一格放得下幾條：依畫面高度算（手機約 5 條，桌機 5～6 條）
  const avail = mob ? innerHeight - 200 - 26 : Math.max(560, innerHeight - 260);
  const n = Math.max(2, Math.floor((avail / 6 - 26) / (mob ? 16 : 19)));
  const grid = `<div class="cal" style="--rows:6"><div class="mh">${WD1.map((c, i) => `<span class="${i > 4 ? 'we' : ''}">${c}</span>`).join('')}</div>
    <div class="mg" id="mgrid">${m.days.map(d => { const items = [...d.events.map(label), ...d.due.map(k => `<div class="lb d">${esc(k)}</div>`)];
      const more = items.length > n ? items.length - (n - 1) : 0;
      return `<button class="mc ${d.in_month ? '' : 'out'} ${d.date === TODAY() ? 'today' : ''} ${d.date === S.date && !mob ? 'sel' : ''} ${d.skip ? 'skip' : ''} ${wdOf(d.date) > 4 ? 'we' : ''}" data-d="${d.date}" onclick="pickDay('${d.date}')">
        <span class="dn num">${+d.date.slice(8)}</span>${(more ? items.slice(0, n - 1) : items).join('')}${more ? `<div class="lb more">+${more}</div>` : ''}</button>`; }).join('')}</div></div>`;
  if (mob) return calbar(title) + grid;
  return calbar(title) + `<div class="mwrap">${grid}<div class="card daypanel">${dayPanel(s, false)}</div></div>`;
};
/* 手機月曆：左右滑換月 */
let swX = null, swY = 0;
document.addEventListener('touchstart', e => { if (e.target.closest && e.target.closest('#mgrid,#wkgrid')) { swX = e.touches[0].clientX; swY = e.touches[0].clientY; } }, {passive: true});
document.addEventListener('touchend', e => {
  if (swX === null) return;
  const dx = e.changedTouches[0].clientX - swX, dy = e.changedTouches[0].clientY - swY; swX = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
}, {passive: true});
VIEW.month_old = async () => {
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
  const all = await api('/tasks?include_done=true'), td = TODAY(), wkStart = shift(td, -wdOf(td)), wkEnd = shift(wkStart, 6);
  const G = {逾期: [], 今天: [], 本週: [], 之後: []};
  for (const k of all) {
    const d = k.plan_date || (k.due || '').slice(0, 10) || td;
    let g = k.scope === 'week' ? (d < wkStart ? '逾期' : d <= wkEnd ? '本週' : '之後') : d < td ? '逾期' : d === td ? '今天' : d <= wkEnd ? '本週' : '之後';
    if (k.done) {                               // 做完的留在原本那一組的最下面；太久以前的就不顯示了
      const at = (k.done_at || '').slice(0, 10);
      if (g === '逾期') { if (at !== td) continue; g = '今天'; }
      else if (at && at < shift(td, -6)) continue;
    }
    G[g].push(k);
  }
  const tag = k => k.scope === 'week' ? `<span class="pill teal">${t('整週')}</span>` : (k.plan_date && k.plan_date !== td) ? `<span class="pill">${md(k.plan_date)}</span>` : '';
  const group = (name, list) => {
    const open = list.filter(k => !k.done), done = list.filter(k => k.done);
    if (name === '逾期' && !open.length) return '';
    if (name === '之後' && !list.length) return '';
    return `<div class="card tg ${name === '逾期' ? 'late' : ''}"><h3>${t(name)}<span class="cnt">${open.length}</span>${done.length ? `<span class="r muted">${t('完成 {0}', done.length)}</span>` : ''}</h3>
      ${open.map(k => taskRow(k, tag(k))).join('') || `<div class="empty">${name === '今天' ? t('今天沒有待辦') : t('沒有')}</div>`}
      ${done.length ? `<div class="donesep"></div>${done.map(k => taskRow(k, tag(k))).join('')}` : ''}</div>`;
  };
  return `${taskForm()}<div class="tgrid">${['逾期', '今天', '本週', '之後'].map(k => group(k, G[k])).join('')}</div>`;
};
/* ---------- 行程詳情：時間地點、留言 ---------- */
const BUBBLE = '<svg class="bub" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4z"/></svg>';
const whenText = ts => { const d = ts.slice(0, 10), hm = ts.slice(11, 16); return d === TODAY() ? hm : `${md(d)} ${hm}`; };
async function openEvent(id, owner) {
  const q = owner ? `?owner=${owner}` : '';
  const e = await api(`/events/${id}${q}`);
  let box = document.querySelector('.sheetwrap');
  if (!box) {
    box = document.createElement('div'); box.className = 'ask sheetwrap';
    box.onclick = ev => { if (ev.target === box) closeSheet(); };
    document.body.append(box);
    document.addEventListener('keydown', sheetKey);
  }
  const d = e.start.slice(0, 10);
  box.innerHTML = `<div class="askbox sheet" role="dialog" aria-modal="true">
    <div class="sh-h"><b>${duo(e)}${esc(e.title)}</b><button class="x" onclick="closeSheet()" aria-label="${t('關閉')}">✕</button></div>
    <div class="sh-m">${md(d)} ${WDN[wdOf(d)]} · <span class="num">${esc(e.start.slice(11, 16))}${e.end ? '–' + esc(e.end.slice(11, 16)) : ''}</span>${e.location ? ' · ' + esc(e.location) : ''}${P.multi && !e.mine ? ' · ' + esc(e.owner_name) : ''}</div>
    ${e.note ? `<div class="sh-n">${esc(e.note)}</div>` : ''}
    <div class="cmts">${e.comments.map(c => `<div class="cm">${face({name: c.author_name, color: c.author_color, avatar: c.avatar}, 'sm')}<div class="cb">
        <div class="ch"><b>${esc(c.author_name)}</b><span class="muted num">${whenText(c.created)}</span>${c.author === P.me.id ? `<button class="x" onclick="delComment(${id},${owner},${c.id})" aria-label="${t('刪除')}">✕</button>` : ''}</div>
        <div class="ct">${esc(c.body)}</div></div></div>`).join('') || `<div class="empty">${P.multi && e.shared ? t('還沒有留言，問問「幾點？」「在哪？」') : t('可以在這裡記一點備註')}</div>`}</div>
    <form class="cform" onsubmit="event.preventDefault();sendComment(this,${id},${owner})"><input class="field" name="body" placeholder="${t('留言…')}" autocomplete="off" required maxlength="1000"><button class="btn pri">${t('送出')}</button></form></div>`;
  const list = box.querySelector('.cmts'); list.scrollTop = list.scrollHeight;
}
const sheetKey = e => { if (e.key === 'Escape') closeSheet(); };
function closeSheet(skipRender) {
  const box = document.querySelector('.sheetwrap'); if (!box) return;
  document.removeEventListener('keydown', sheetKey);
  box.classList.add('out'); setTimeout(() => box.remove(), 180);
  if (!skipRender) render();
}
async function sendComment(f, id, owner) {
  const body = f.body.value.trim(); if (!body) return;
  f.querySelector('button').disabled = true;
  await api(`/events/${id}/comments${owner ? '?owner=' + owner : ''}`, 'POST', {body});
  openEvent(id, owner);
}
async function delComment(id, owner, cid) {
  if (!await ask(t('刪除這則留言？'))) return;
  await api(`/events/${id}/comments/${cid}${owner ? '?owner=' + owner : ''}`, 'DELETE'); openEvent(id, owner);
}

/* ---------- 動態：其他成員新增了什麼、留了什麼言 ---------- */
const ACT = {event_add: '新增了一起的行程', event_del: '刪除了一起的行程', task_add: '新增了共用待辦', task_done: '完成了共用待辦', comment: '留言'};
const actLine = a => a.action === 'awake' ? `☀️ ${t('起床了')} <span class="avt num">${esc(a.title)}</span>`
  : a.action === 'nudge' ? `📣 ${t('叫「{0}」起床', esc(a.title))}` : `${t(ACT[a.action] || a.action)}<span class="avt">「${esc(a.title)}」</span>`;
VIEW.activity = async () => {
  const r = await api('/activity');
  const row = (a, i) => `<div class="av ${a.id > r.seen && !a.mine ? 'new' : ''} ${a.ref_id && (a.action === 'comment' || a.action === 'event_add') ? 'open' : ''}"
      ${a.ref_id && (a.action === 'comment' || a.action === 'event_add') ? `onclick="openEvent(${a.ref_id},${a.owner === P.me.id ? 0 : a.owner})"` : ''}>
    ${face({name: a.actor_name, color: a.actor_color, avatar: a.avatar}, 'md')}
    <div class="avb"><div><b>${a.mine ? t('你') : esc(a.actor_name)}</b> ${actLine(a)}</div>
      ${a.body ? `<div class="avq">${esc(a.body)}</div>` : ''}<div class="muted num avtime">${whenText(a.created)}</div></div></div>`;
  return `<div class="card actlist"><h3>${t('動態')}${r.unread ? `<span class="cnt hot">${r.unread}</span>` : ''}</h3>
    ${r.items.map(row).join('') || `<div class="empty">${t('還沒有動態。新增「一起」的行程或在行程裡留言，就會出現在這裡。')}</div>`}</div>`;
};

/* 新增待辦：上面打字，下面點選什麼時候做 */
function taskForm() {
  return `<form class="card tadd" onsubmit="event.preventDefault();addTask(this)">
    <div class="tadd-top"><input class="field big" type="text" name="title" placeholder="${t('新增待辦…')}" required autocomplete="off"><button class="btn pri">${t('加入')}</button></div>
    <div class="tadd-opts">
      <div class="seg sm when">${[['today', '今天'], ['tomorrow', '明天'], ['week', '這週內'], ['pick', '選日期']].map(([v, l], i) => `<button type="button" data-w="${v}" class="${i ? '' : 'on'}" onclick="whenPick(this)">${t(l)}</button>`).join('')}</div>
      <label class="lf" data-for="pick" hidden><span>${t('哪天做')}</span><input class="field" type="date" name="pick" value="${shift(TODAY(), 2)}"></label>
      <button type="button" class="chipbtn" onclick="this.hidden=true;const d=this.nextElementSibling;d.hidden=false;d.querySelector('input').focus()">＋ ${t('截止時間')}</button>
      <label class="lf" hidden><span>${t('截止')}</span><input class="field" type="datetime-local" name="due"></label>
      ${shareBox()}
    </div></form>`;
}
function whenPick(b) { b.closest('form').querySelector('[data-for=pick]').hidden = b.dataset.w !== 'pick'; }
async function addTask(f) {
  const v = formData(f), w = f.querySelector('.when .on').dataset.w, td = TODAY();
  const body = {title: v.title, due: v.due || null, shared: v.shared ? 1 : 0, scope: w === 'week' ? 'week' : 'day',
    plan_date: w === 'tomorrow' ? shift(td, 1) : w === 'pick' ? (v.pick || td) : td};
  await api('/tasks', 'POST', body); toast(t('已加入')); render();
}
/* 打勾：勾勾彈出、字被劃掉、噴一點光點，然後才移到這一組的最下面 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function checkTask(btn, id, owner, done) {
  const row = btn.closest('.task');
  if (done && !CALM) {
    row.classList.add('checking');
    const b = document.createElement('span'); b.className = 'burst';
    b.innerHTML = Array.from({length: 8}, (_, i) => `<i style="--a:${i * 45 + 20}deg"></i>`).join('');
    btn.append(b);
    navigator.vibrate?.(12);
    await sleep(560);
  } else if (!done) { row.classList.add('unchecking'); await sleep(160); }
  await api(`/tasks/${id}${owner}`, 'PATCH', {done}); render();
}

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
      <div class="acts"><button class="btn" onclick="triage(false)">${t('略過')}</button><button class="btn sun" onclick="triage(true)">${t('核准')}</button></div></div></div>
    ${items.length > 1 ? `<div class="qhead">${t('接下來')}<span class="cnt">${items.length - 1}</span></div><div class="qlist">${items.slice(1, 9).map((i, n) => { const [kn, kc] = KIND[i.kind] || KIND.other;
      return `<div class="q" style="--i:${n}"><span class="pill ${kc}">${t(kn)}</span><div class="qb"><b>${esc(i.title)}</b>${i.course ? `<em>${esc(i.course)}</em>` : ''}</div>${i.due ? `<span class="qd num">${md(i.due)}</span>` : ''}</div>`; }).join('')}</div>` : ''}${manual}</div>`;
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
/* ---------- 通勤：依地點的交通時間（下雨多留一點）自動提早鬧鐘 ---------- */
const cset = async b => { await api('/commute', 'PATCH', b); render(); };
async function addPlace(f) {
  const d = formData(f);
  if (!d.name) return;
  if (d.minutes) await api('/commute/places', 'POST', {name: d.name, minutes: +d.minutes});
  else { toast(t('估算中…')); const r = await api('/commute/estimate', 'POST', {location: d.name}); toast(t('估計 {0} 分鐘', r.minutes)); }
  render();
}
function commuteCard(cm, s) {
  const c = cm.settings, num = (k, max) => `<input class="field num" type="number" min="0" max="${max}" value="${c[k]}" style="width:70px" onchange="cset({${k}:+this.value})">`;
  const known = cm.places.map(p => p.name);
  const miss = [...new Set(s.events.map(e => e.location).filter(l => l && !known.some(k => l.includes(k) || k.includes(l))))];
  return `<div class="card commute ${c.on ? '' : 'off'}"><h3>${t('通勤')}<span class="r"><button class="sw ${c.on ? 'on' : ''}" title="${c.on ? t('啟用中') : t('已停用')}" onclick="cset({on:${!c.on}})"><i></i></button></span></h3>
    <div class="muted cm-tip">${t('開啟後，鬧鐘會再往前扣掉從家裡到行程地點的交通時間，預報會下雨就多留幾分鐘。規則裡的「提前」就只算準備時間（梳洗、吃早餐）。')}</div>
    ${c.on ? `<dl class="kv">
      <dt>${t('家的地址')}</dt><dd><input class="field" value="${esc(c.home)}" placeholder="${t('例：桃園市中壢區中大路 300 號')}" onchange="cset({home:this.value})"></dd>
      <dt>${t('交通方式')}</dt><dd><div class="seg sm">${[['car', '機車／開車'], ['bike', '腳踏車'], ['foot', '走路']].map(([v, l]) => `<button class="${c.mode === v ? 'on' : ''}" onclick="cset({mode:'${v}'})">${t(l)}</button>`).join('')}</div></dd>
      <dt>${t('其他地點')}</dt><dd>${num('default', 240)} <span class="muted">${t('分鐘（沒對上常用地點、也估不出來時）')}</span></dd>
      <dt>${t('下雨多留')}</dt><dd>${num('rain', 120)} <span class="muted">${t('分鐘（降雨機率 50% 以上）')}</span></dd></dl>
    <h4 class="cm-h">${t('常用地點')}</h4>
    <div class="places">${cm.places.map(p => `<div class="wrow place"><b>${esc(p.name)}</b>${p.auto ? `<span class="pill">${t('自動估')}</span>` : ''}<span class="sp"></span>
        <input class="field num" type="number" min="0" max="300" value="${p.minutes}" style="width:64px" onchange="api('/commute/places','POST',{name:${esc(JSON.stringify(p.name))},minutes:+this.value}).then(render)"><span class="muted">${t('分')}</span>
        <button class="x" onclick="act('/commute/places/'+encodeURIComponent(${esc(JSON.stringify(p.name))}),'DELETE')" aria-label="${t('刪除')}">✕</button></div>`).join('') || `<div class="empty">${t('還沒有常用地點')}</div>`}</div>
    ${miss.length ? `<div class="miss"><span class="muted">${t('明天的地點還沒設：')}</span>${miss.map(l => `<button class="chip" onclick="const f=document.querySelector('.cm-add');f.name.value=${esc(JSON.stringify(l))};f.minutes.focus()">${esc(l)}</button>`).join('')}</div>` : ''}
    <form class="addrow cm-add" onsubmit="event.preventDefault();addPlace(this)"><input class="field" name="name" placeholder="${t('地點（例：理學院）')}" required>
      <input class="field num" type="number" name="minutes" min="0" max="300" placeholder="${t('分鐘')}" style="width:80px"><button class="btn pri">${t('加入')}</button></form>
    <div class="muted cm-tip">${t('分鐘留空會用 OpenStreetMap 自動估（不含即時路況和大眾運輸；搭捷運、公車請自己填）。地址和地點只會送去 OpenStreetMap 和 Open-Meteo 查詢。')}</div>` : ''}</div>`;
}
function ruleCard(r) {
  const wds = r.weekdays.split(',').filter(k => k !== '');
  const tog = i => { const s = new Set(wds); s.has(String(i)) ? s.delete(String(i)) : s.add(String(i)); return [...s].sort().join(','); };
  const P = (field, expr = 'this.value') => `onchange="act('/alarms/rules/${r.id}','PATCH',{${field}:${expr}})"`;
  const num = (label, field, v, unit, min = 1, max = 600) => `<label class="knob"><span>${t(label)}</span><input class="num" type="number" min="${min}" max="${max}" value="${v}" ${P(field, '+this.value')}><em>${t(unit)}</em></label>`;
  const time = (label, field, v, tip = '') => `<label class="knob" title="${tip}"><span>${t(label)}</span><input type="time" value="${esc(v || '')}" ${P(field, 'this.value||null')}></label>`;
  const follow = r.anchor === 'first_event', n = Math.min(r.count, 30), gap = Math.max(4, Math.min(22, r.interval_minutes * 2)), span = (r.count - 1) * r.interval_minutes;
  return `<div class="rule ${r.enabled ? '' : 'off'}"><div class="hd"><input value="${esc(r.name)}" ${P('name')} aria-label="${t('規則名稱')}"><span class="sp"></span>
      <button class="x" title="${t('刪除')}" onclick="act('/alarms/rules/${r.id}','DELETE')">✕</button>
      <button class="sw ${r.enabled ? 'on' : ''}" title="${r.enabled ? t('啟用中') : t('已停用')}" onclick="act('/alarms/rules/${r.id}','PATCH',{enabled:${r.enabled ? 0 : 1}})"><i></i></button></div>
    <div class="wds">${WD1.map((c, i) => `<button class="wd ${wds.includes(String(i)) ? 'on' : ''}" title="${WDN[i]}" onclick="act('/alarms/rules/${r.id}','PATCH',{weekdays:'${tog(i)}'})">${c}</button>`).join('')}</div>
    <div class="seg sm"><button class="${follow ? 'on' : ''}" onclick="act('/alarms/rules/${r.id}','PATCH',{anchor:'first_event'})">${t('跟著行程')}</button><button class="${follow ? '' : 'on'}" onclick="act('/alarms/rules/${r.id}','PATCH',{anchor:'fixed'})">${t('固定時間')}</button></div>
    <div class="knobs">${follow ? num('提前', 'lead_minutes', r.lead_minutes, '分', 0) : time('開始', 'fixed_time', r.fixed_time || '07:00')}${num('間隔', 'interval_minutes', r.interval_minutes, '分')}${num('數量', 'count', r.count, '個', 1, 30)}
      ${follow ? time('沒行程時', 'fixed_time', r.fixed_time, t('那天沒有行程時從幾點開始響；留空就不排鬧鐘')) : ''}</div>
    <div class="dots" title="${t('從第一個到最後一個共 {0} 分鐘', span)}">${Array.from({length: n}, (_, i) => (i ? `<s style="width:${gap}px"></s>` : '') + `<i style="--i:${i}"></i>`).join('')}<span class="num">${t('{0} 分鐘', span)}</span></div></div>`;
}
function phoneLine(ph) {
  if (ph.mode !== 'app') return '';
  const when = ph.last ? (ph.last.slice(0, 10) === TODAY() ? ph.last.slice(11, 16) : md(ph.last) + ' ' + ph.last.slice(11, 16)) : '';
  if (!ph.last) return `<div class="phone no">📱 ${t('手機 App 還沒連上過，鬧鐘不會響。')} <a href="/phone">${t('把 Asa 裝到手機')}</a></div>`;
  if (ph.synced) return `<div class="phone ok">📱 ${t('手機已同步（{0}），接下來會響 {1} 個', when, ph.count)}</div>`;
  return `<div class="phone no">📱 ${t('手機還沒拿到最新的鬧鐘（上次同步 {0}）。打開手機上的 Asa 就會同步。', when)}</div>`;
}
function alarmList(al, d) {
  const src = a => a.source === 'manual' ? t('手動') : t('依規則');
  const past = a => d === TODAY() && mins(a.time) <= nowMin();
  const rows = al.map(a => `<div class="arow ${a.enabled ? '' : 'off'} ${past(a) ? 'past' : ''}"><b class="num">${a.time}</b>
      <span class="muted">${past(a) ? t('已過') + ' · ' : ''}${esc(a.label && a.label !== '起床' ? a.label : src(a))}</span><span class="sp"></span>
      <button class="sw ${a.enabled ? 'on' : ''}" title="${a.enabled ? t('會響') : t('已關閉')}" aria-label="${a.enabled ? t('會響') : t('已關閉')}" onclick="act('/alarms/plan/${a.id}','PATCH',{enabled:${a.enabled ? 0 : 1}})"><i></i></button>
      <button class="x" title="${t('刪除')}" aria-label="${t('刪除')}" onclick="act('/alarms/plan/${a.id}','DELETE')">✕</button></div>`).join('');
  return `<div class="alist">${rows || `<div class="muted empty">${t('這天沒有排鬧鐘')}</div>`}</div>
    <form class="addrow aadd" onsubmit="event.preventDefault();act('/alarms/plan','POST',{date:'${d}',time:this.time.value},'${t('已加入')}')">
      <input class="field" type="time" name="time" required><button class="btn pri">＋ ${t('加鬧鐘')}</button>
      <button type="button" class="btn ghost" title="${t('照下面的規則重新排這天的鬧鐘（手動加的會留著）')}" onclick="act('/alarms/plan/regenerate?d=${d}','POST',null,'${t('已依規則重排')}')">${t('重排')}</button></form>`;
}
function alarmDay(v) { S.aday = v; render(); }
VIEW.alarms = async () => {
  const td = TODAY(), tm = shift(td, 1);
  if (!S.aday) S.aday = new Date().getHours() < 12 ? 'td' : 'tm';
  const d = S.aday === 'td' ? td : tm;
  const [rules, s, p, ins, cm, ph] = await Promise.all([api('/alarms/rules'), api('/day?d=' + tm), api('/alarms/plan?d=' + d), api('/alarms/insights'), api('/commute'), api('/alarms/phone')]);
  const tips = ins.suggestions.filter(k => k.patch);
  return `<section class="hero"><div class="seg sm aday">${[['td', '今天', td], ['tm', '明天', tm]].map(([v, l, x]) => `<button class="${S.aday === v ? 'on' : ''}" onclick="alarmDay('${v}')">${t(l)} <span class="num">${md(x)}</span></button>`).join('')}</div>
      ${alarmList(p.alarms, d)}${phoneLine(ph)}
      ${p.preview_reason ? `<div class="why">${esc(p.preview_reason)}</div>` : ''}</section>
    ${tips.map(k => `<div class="tip" title="${esc(k.text)}"><span>💡</span><div><b>${esc(k.rule)}</b>　${esc(k.short || k.text)}</div>
      <button class="btn sun" onclick='act("/alarms/rules/${k.rule_id}","PATCH",${JSON.stringify(k.patch)},"${t('已套用')}")'>${t('套用')}</button></div>`).join('')}
    <div class="rules">${rules.map(ruleCard).join('')}
      <button class="rule add" onclick="act('/alarms/rules','POST',{name:'${t('新規則')}',weekdays:'',anchor:'first_event',lead_minutes:90,count:6,interval_minutes:5})"><span>＋</span>${t('新增規則')}</button></div>
    ${commuteCard(cm, s)}
    ${ins.mornings.length ? `<details class="fold"><summary>${t('起床紀錄')}</summary><div class="card">${ins.mornings.slice(0, 10).map(m => `<div class="task"><div class="body num">${md(m.date)} ${WDN[m.weekday]}　${m.first}–${m.last}　→　<b>${m.awake}</b><span class="muted">　${m.rang}/${m.count}</span></div></div>`).join('')}</div></details>` : ''}`;
};

/* ---------- 固定行程 ---------- */
VIEW.weekly = async () => {
  const w = await api('/weekly'), today = wdOf(TODAY());
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => w.filter(k => k.weekday === d));
  const form = `<form class="card tadd" onsubmit="event.preventDefault();addWeekly(this)">
      <div class="tadd-top"><input class="field big" type="text" name="title" placeholder="${t('名稱（課、班、健身…）')}" required autocomplete="off"><button class="btn pri">${t('加入')}</button></div>
      <div class="tadd-opts"><div class="wdpick">${WD1.map((c, i) => `<button type="button" class="${i === today ? 'on' : ''}" onclick="this.classList.toggle('on')" data-d="${i}">${c}</button>`).join('')}</div>
        <span class="trange"><input class="field" type="time" name="start_time" required><span class="muted">–</span><input class="field" type="time" name="end_time"></span>
        <input class="field" type="text" name="location" placeholder="${t('地點')}" style="max-width:140px"></div>
      <div class="muted hint">${t('可以一次選好幾天，例如每週二、四的課。')}</div></form>`;
  const item = e => `<div class="ag weekly"><i class="num">${esc(e.start_time)}${e.end_time ? `<s>${esc(e.end_time)}</s>` : ''}</i>
      <b>${esc(e.title)}${e.location ? `<em>${esc(e.location)}</em>` : ''}</b><button class="x" onclick="act('/weekly/${e.id}','DELETE')" aria-label="${t('刪除')}">✕</button></div>`;
  if (MOB() || !w.length) return form + `<div class="wkl">${days.map((list, d) => list.length ? `<div class="card wkd ${d === today ? 'today' : ''}"><h3>${WDN[d]}<span class="cnt">${list.length}</span></h3>
      <div class="agenda">${list.map(item).join('')}</div></div>` : '').join('') || `<div class="empty">${t('還沒有固定行程')}</div>`}</div>`;
  const rg = {start: Math.floor(Math.min(...w.map(k => mins(k.start_time))) / 60) * 60,
    end: Math.ceil(Math.max(...w.map(k => mins(k.end_time || k.start_time) + (k.end_time ? 0 : 50))) / 60) * 60};
  return form + `<div class="week">${days.map((list, d) => `<div class="col ${d === today ? 'today' : ''}"><div class="hd"><b>${WDN[d]}</b></div>
      ${timeline(list.map(e => ({...e, time: e.start_time, source: 'tt'})), {...rg, pxm: 0.7})}</div>`).join('')}</div>`;
};
async function addWeekly(f) {
  const v = formData(f), ds = [...f.querySelectorAll('.wdpick .on')].map(b => +b.dataset.d);
  if (!ds.length) return toast(t('請至少選一天'));
  for (const d of ds) await api('/weekly', 'POST', {...v, weekday: d});
  toast(t('已加入')); render();
}

/* ---------- 設定 ---------- */
const sent = r => { const ok = Object.entries(r).filter(([, v]) => v !== '未設定'); toast(ok.length ? ok.map(([k, v]) => `${k}: ${v}`).join(' | ') : t('還沒有設定任何通知管道')); };
VIEW.link = async () => {
  const [st, br, ph] = await Promise.all([api('/status'), api('/brief'), api('/alarms/phone')]);
  const url = st.urls[0] || `http://${t('這台電腦的IP')}:${location.port || 80}`;
  const pref = palPref(), th = document.documentElement.dataset.theme;
  const look = `<div class="card"><h3>${t('外觀')}</h3><dl class="kv">
      <dt>${t('語言')}</dt><dd><div class="seg sm"><button class="${LANG === 'zh' ? 'on' : ''}" onclick="setLang('zh')">中文</button><button class="${LANG === 'en' ? 'on' : ''}" onclick="setLang('en')">English</button></div></dd>
      <dt>${t('風格')}</dt><dd><div class="seg sm">${[['simple', '簡約'], ['vivid', '炫彩']].map(([v, l]) => `<button class="${styleNow() === v ? 'on' : ''}" onclick="setStyle('${v}')">${t(l)}</button>`).join('')}</div></dd>
      <dt>${t('主題')}</dt><dd><div class="seg sm"><button class="${th === 'dark' ? 'on' : ''}" onclick="if('${th}'!=='dark')toggleTheme().then(render)">${t('暗色')}</button><button class="${th === 'light' ? 'on' : ''}" onclick="if('${th}'!=='light')toggleTheme().then(render)">${t('亮色')}</button></div></dd>
      <dt>${t('色系')}</dt><dd><div class="pals"><button class="palm ${pref === 'auto' ? 'on' : ''}" onclick="setPalPref('auto')" title="${t('每一頁一個顏色，日曆跟著時段和星期變')}">${t('自動搭配')}</button>
        <button class="palm ${pref === 'random' ? 'on' : ''}" onclick="setPalPref('random')" title="${t('每換一頁隨機換一個顏色')}">🎲 ${t('隨機')}</button>
        ${Object.entries(PAL).map(([k, c]) => `<button class="pal ${pref === k ? 'on' : ''}" onclick="setPalPref('${k}')" title="${t(PAL_NAME[k])}" aria-label="${t(PAL_NAME[k])}" style="background:linear-gradient(135deg,${c.a.join(',')})"></button>`).join('')}</div></dd></dl></div>`;
  const member = p => {
    const full = 'token' in p, patch = f => `quietSave(${p.id},${f})`;
    const pick = (field, opts) => `<div class="seg sm">${opts.map(([v, l]) => `<button class="${p[field] === v ? 'on' : ''}" onclick="${patch(`{${field}:'${v}'}`)}">${t(l)}</button>`).join('')}</div>`;
    return `<details class="mem" ${p.me ? 'open' : ''}><summary>${face(p, 'md')}<b>${esc(p.name)}</b>${p.me && P.multi ? `<span class="pill teal">${t('你')}</span>` : ''}</summary>
      ${!full ? `<div class="muted" style="margin-top:8px">${t('其他成員的設定要由本人或第一位成員來改。')}</div>` : `<dl class="kv">
        <dt>${t('頭貼')}</dt><dd class="avrow"><button type="button" class="avbtn" onclick="pickAvatar(${p.id})" title="${t('換頭貼')}">${face(p, 'lg')}<span>${t('換頭貼')}</span></button>
          ${p.avatar ? `<button type="button" class="btn ghost" onclick="api('/profiles/${p.id}/avatar','DELETE').then(loadP).then(render)">${t('移除')}</button>` : ''}</dd>
        <dt>${t('名字')}</dt><dd><input class="field" value="${esc(p.name)}" maxlength="20" style="max-width:180px" onchange="${patch('{name:this.value}')}"></dd>
        <dt>${t('起床方式')}</dt><dd>${pick('alarm_mode', [['app', '手機 App 鬧鐘'], ['notify', '用推播叫'], ['off', '不需要']])}</dd>
        <dt>${t('行程提醒')}</dt><dd><input class="field num" type="number" min="0" max="720" value="${p.remind_minutes}" style="width:76px" onchange="${patch('{remind_minutes:+this.value}')}"> <span class="muted">${t('分鐘前推播（0 = 不提醒）')}</span></dd>
        ${P.multi && p.alarm_mode !== 'off' ? `<dt>${t('叫不醒時')}</dt><dd><input class="field num" type="number" min="0" max="180" value="${p.buddy_minutes}" style="width:76px" onchange="${patch('{buddy_minutes:+this.value}')}"> <span class="muted">${t('分鐘後通知其他人來叫（0 = 不通知）')}</span></dd>` : ''}
        ${P.multi ? `<dt>${t('我的行程')}</dt><dd>${pick('visible', [['full', '其他人看得到'], ['busy', '只顯示有事'], ['none', '不顯示']])}</dd>
` : ''}</dl>
      <details class="fold in"><summary>${t('連線資訊（手機 App、手機瀏覽器）')}</summary><dl class="kv">
        <dt>${t('伺服器網址')}</dt><dd><code>${esc(url)}</code></dd><dt>${t('存取碼')}</dt><dd><code>${esc(p.token)}</code></dd>
        <dt>${t('手機瀏覽器')}</dt><dd><code>${esc(url)}/?token=${esc(p.token)}</code></dd>
        ${p.me ? `<dt>${t('最後同步')}</dt><dd>${p.phone_last_sync ? esc(p.phone_last_sync.replace('T', ' ')) : `<span class="no">${t('還沒連上來過')}</span>`}</dd>` : ''}</dl></details>
      <details class="fold in"><summary>${t('這個人的通知管道')}</summary>
        <form onsubmit="event.preventDefault();pact('/profiles/${p.id}','PATCH',{notify:formData(this)},'${t('已儲存')}')">
          ${p.channels.map(c => `<div class="chrow"><span class="chip ${c.configured ? 'on' : ''}">${esc(c.label)}</span>${c.env.map(k => `<input class="field" type="password" autocomplete="off" name="${k}" placeholder="${k}">`).join('')}</div>`).join('')}
          <div class="addrow"><button class="btn pri">${t('儲存')}</button><button type="button" class="btn" onclick="api('/profiles/${p.id}/test','POST').then(sent)">${t('測試')}</button></div>
          <div class="muted" style="margin-top:8px">${p.id === 1 ? t('留空的欄位不會變動；沒填的管道會用 .env 裡的設定。') : t('留空的欄位不會變動。要清掉某一欄，填一個空白再儲存。')}</div></form></details>
      <div class="addrow">${P.local && !p.me ? `<button class="btn" onclick="api('/profiles/${p.id}/switch','POST').then(()=>location.reload())">${t('在這台電腦切換成這個人')}</button>` : ''}
        ${P.admin && p.id !== 1 ? `<button class="btn" onclick="pact('/profiles/${p.id}','DELETE')">${t('移除')}</button>` : ''}</div>`}</details>`;
  };
  const members = `<div class="card"><h3>${P.multi ? t('成員') : t('提醒與共用')}${P.admin ? ` <span class="r"><button class="btn" onclick="const n=prompt('${t('新成員的名字')}');if(n)pact('/profiles','POST',{name:n},'${t('已新增，把存取碼給對方就能用')}')">＋ ${t('新增成員')}</button></span>` : ''}</h3>
      ${P.multi ? '' : `<div class="muted" style="margin-bottom:6px">${t('跟另一半或家人共用？新增一位成員：每個人有自己的鬧鐘、待辦和通知，行程和待辦可以選擇「一起」。')}</div>`}
      ${P.list.map(member).join('')}</div>`;
  const more = `<div class="card"><h3>${t('進階')}</h3>
    <details class="fold in"><summary>${t('資料來源')} <span class="muted">· ${t('每 {0} 分鐘', st.sync_minutes)}</span></summary>
      ${st.sources.map(k => `<div class="src"><div><b>${esc(k.label)}</b><div class="muted">${k.configured ? esc(k.last || t('還沒執行過')) : t('在 .env 填') + ' ' + k.env.map(e => `<code>${e}</code>`).join(' ')}</div></div>
        ${k.configured ? `<button class="btn" onclick="toast('${t('抓取中…')}');api('/sources/${k.name}/run','POST').then(r=>{toast(r.ok?t('抓到 {0} 筆，新增 {1} 筆',r.total,r.new):r.message);render()})">${t('立刻抓')}</button>` : `<span class="no">○ ${t('未設定')}</span>`}</div>`).join('')}</details>
    <details class="fold in"><summary>${t('每日推播')} <span class="muted">· ${esc(st.morning)} / ${esc(st.evening)}</span></summary>
      <dl class="kv"><dt>${t('早上簡報')}</dt><dd class="num">${esc(st.morning)}</dd><dt>${t('晚上預告')}</dt><dd class="num">${esc(st.evening)}</dd></dl>
      <pre class="brief">${esc(br.text)}</pre>
      <div class="addrow"><button class="btn" onclick="api('/notify/brief','POST').then(r=>sent(r.result))">${t('現在推播')}</button></div></details>
    <div class="muted" style="margin-top:14px">${t('設定都在 .env，改完重新啟動才會生效。')}</div></div>`;
  const phone = `<div class="card"><h3>${t('手機 App')}</h3>${NATIVE
      ? `<div class="muted">${t('你正在用 Asa App：鬧鐘會在時間到時全螢幕響鈴。')}</div>${phoneLine(ph)}
         <div class="addrow"><button class="btn pri" onclick="AsaNative.openSetup()">${t('App 設定（權限、測試鬧鐘、連線）')}</button></div>`
      : `<div class="muted">${t('Android 手機裝 Asa App，鬧鐘才會在鎖定畫面響鈴；iPhone 改用推播叫你。')}</div>${phoneLine(ph)}
         <div class="addrow"><a class="btn pri" href="/phone">${t('把 Asa 裝到手機')}</a></div>`}</div>`;
  return `<div class="cols"><div class="stack">${phone}${members}</div><div class="stack">${look}${more}</div></div>`;
};

/* ---------- 頂列：指令列、語言、亮暗 ---------- */
const TYPE = {event: '📅', task: '☑️', alarm: '⏰', weekly: '🗓', error: '⚠️'};
const setPlaceholder = () => $('#cmd').placeholder = MOB() ? t('說一句話：明天三點 開會') : t('說一句話：明天下午三點 開會 @會議室｜週五前 交報告｜鬧鐘 明天 7:30');
setPlaceholder();
$('#theme').title = t('切換亮色／暗色');
$('#theme').onclick = () => toggleTheme().then(() => { if (S.view === 'link') render(); });
mqMobile.addEventListener('change', () => { setPlaceholder(); render(); });
addEventListener('resize', () => { if (S.view === 'month') { clearTimeout(S.rz); S.rz = setTimeout(render, 250); } });

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
/* ---------- 分段按鈕：一塊底色在選項之間滑動 ---------- */
function segSync(seg) {
  const b = seg.querySelector('button.on');
  if (!b || !b.offsetWidth) return;
  seg.style.setProperty('--sx', b.offsetLeft + 'px'); seg.style.setProperty('--sw', b.offsetWidth + 'px');
  if (!seg.classList.contains('ready')) { void seg.offsetWidth; seg.classList.add('ready'); }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.seg button');
  if (!b || b.classList.contains('on')) return;
  const seg = b.parentElement;
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  segSync(seg);
  const fn = b.onclick;
  if (!fn || b.type === 'button' && b.closest('form')) return;   // 表單裡的選項不用等
  e.stopImmediatePropagation(); e.preventDefault();
  setTimeout(() => fn.call(b, e), CALM ? 0 : 230);                // 讓底色先滑過去再換畫面
}, true);
document.addEventListener('toggle', e => e.target.querySelectorAll?.('.seg').forEach(segSync), true);
addEventListener('resize', () => document.querySelectorAll('.seg').forEach(segSync));

/* ---------- 觸控裝置的動畫：沒有 hover，改成點擊漣漪和捲動進場 ---------- */
const TOUCH = matchMedia('(hover:none),(pointer:coarse)').matches;
const CALM = matchMedia('(prefers-reduced-motion:reduce)').matches;
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' || CALM) return;
  const el = e.target.closest('.btn,.hb,.nav,.mc,.task,.ag,.pal,.palm,.seg button,.tbtn,.d,.wd,.bell');
  if (!el) return;
  const r = el.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
  const w = document.createElement('span');
  w.className = 'tap';
  w.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.classList.add('tapped');
  el.append(w);
  setTimeout(() => w.remove(), 600);
}, {passive: true});
let revealer;
function reveal(root) {
  if (!TOUCH || CALM || !('IntersectionObserver' in window)) return;
  revealer?.disconnect();
  revealer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }),
    {rootMargin: '0px 0px -8% 0px'});
  // 一開始就在畫面裡的不用等；畫面下方的捲到才浮上來
  root.querySelectorAll('.card,.runway,.agenda .ag,.week .col,.wrow,.rule').forEach((el, i) => {
    if (el.getBoundingClientRect().top < innerHeight * .92) return;
    el.classList.add('rv'); el.style.setProperty('--rv', (i % 4) * 50 + 'ms'); revealer.observe(el);
  });
}

/* 裝成 App（PWA）：註冊 service worker（只在 HTTPS 或這台電腦上有效） */
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* 手機瀏覽器捲動時網址列會縮放，底部導覽列要貼著「看得到的」畫面底部，不然會沉下去或浮起來 */
if (window.visualViewport) {
  const vv = window.visualViewport;
  const pin = () => document.documentElement.style.setProperty('--vvb', Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px');
  vv.addEventListener('resize', pin); vv.addEventListener('scroll', pin); addEventListener('resize', pin); pin();
}

loadP().then(render);
if (new URLSearchParams(location.search).get('awake')) {
  history.replaceState(null, '', location.pathname);
  api('/wake/awake', 'POST').then(r => { toast(t('早安！{0} 起床', r.at)); render(); }).catch(() => {});
}
