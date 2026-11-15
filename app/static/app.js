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

const S = {view: 'day', cal: 'day', date: TODAY(), inbox: 0, enter: true, ruleOpen: new Set()};
const TOUCH_ = matchMedia('(hover:none),(pointer:coarse)').matches;
S.view = S.cal = QS.get('view') && ['day', 'week', 'month'].includes(QS.get('view')) ? QS.get('view') : 'day';   // 每次打開都從「日」開始
if (['day', 'week', 'month'].includes(QS.get('view'))) S.view = S.cal = QS.get('view');
else if (['tasks', 'inbox', 'alarms', 'weekly', 'link', 'activity'].includes(QS.get('view'))) S.view = QS.get('view');
if (/^\d{4}-\d{2}-\d{2}$/.test(QS.get('date') || '')) S.date = QS.get('date');

const NATIVE = !!window.AsaNative;
if (NATIVE && window.AsaNative.ready) document.body.classList.add('hold');   // 開啟動畫還在：首頁進場動畫先暫停
let syncT = 0;
function nativeSync() { if (NATIVE) { clearTimeout(syncT); syncT = setTimeout(() => { try { AsaNative.sync(); } catch { /* 舊版 App */ } }, 400); } }
window.onNativeSync = () => { if (S.view === 'alarms' || S.view === 'link') render(); };   // App 同步完會呼叫
const CACHE = new Map();
let fresh = null;                                   // render() 期間：背景在抓的最新資料
let GEN = 0;                                        // 每改一次東西就 +1：改之前送出的讀取，回來的是舊資料
async function api(path, method = 'GET', body) {
  if (method === 'GET' && fresh && CACHE.has(path)) {
    fresh.push(getFresh(path));
    return structuredClone(CACHE.get(path));
  }
  if (method === 'GET') return structuredClone((await getFresh(path)).v);
  GEN++; CACHE.clear(); S.full = true;              // 改了東西：舊的快取都不能用了
  try { return await apiRaw(path, method, body); } finally { GEN++; CACHE.clear(); }
}
async function getFresh(path) {
  let v;
  for (let i = 0; i < 4; i++) {                     // 讀取途中有人改了資料：這份是舊的，丟掉重抓（不然剛關的鬧鐘會跳回去）
    const g = GEN;
    v = await apiRaw(path, 'GET');
    if (g === GEN) break;
  }
  const old = CACHE.get(path);
  CACHE.set(path, v);
  return {path, changed: !old || JSON.stringify(old) !== JSON.stringify(v), v};
}
async function apiRaw(path, method = 'GET', body) {
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
const rowOf = () => { const el = window.event && window.event.target; return el && el.closest && el.closest('.task,.ev,.ag,.wrow,.rule,.mem,.arow'); };
const act = async (path, method, body, msg) => {
  if (method === 'DELETE' && !await confirmDelete(path, rowOf())) return;
  const tg = method === 'PATCH' && window.event?.target?.closest?.('.sw,.rwall .chip,.bell'), t0 = performance.now();
  if (tg) optimistic(tg);
  try { await api(path, method, body); } catch (e) { if (tg) optimistic(tg); throw e; }
  if (msg) toast(msg);
  if (tg) { S.full = false; await new Promise(r => setTimeout(r, Math.max(0, 340 - (performance.now() - t0)))); }
  render();
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
  return document.startViewTransition && !document.hidden && !TOUCH_ ? document.startViewTransition(() => render()).updateCallbackDone : render();
}
/* 日曆共用：前後移動、回今天、日／週／月切換 */
const addMonth = (s, n) => { const d = new Date(s.slice(0, 8) + '01T12:00'); d.setMonth(d.getMonth() + n); return iso(d); };
const step = n => go(S.view, S.view === 'month' ? addMonth(S.date, n) : shift(S.date, S.view === 'week' ? 7 * n : n));
const seg = () => `<div class="seg">${CAL.map(([k, v]) => `<button class="${S.view === k ? 'on' : ''}" onclick="go('${k}')">${t(v)}</button>`).join('')}</div>`;
const calbar = (title, extra = '') => `<div class="calbar"><button class="hb" onclick="step(-1)" aria-label="${t('往前')}">‹</button><button class="hb" onclick="step(1)" aria-label="${t('往後')}">›</button>
  <button class="hb" onclick="go(S.view,TODAY())">${t('今天')}</button>${title ? `<b class="ttl num">${title}</b>` : ''}<span class="sp"></span>${extra}${seg()}</div>`;

let rendering = 0;
async function render(quiet) {
  const y = window.scrollY, my = ++rendering;
  fresh = quiet ? null : [];
  const pend = fresh;
  const [html, inbox, unread] = await Promise.all([VIEW[S.view](), api('/inbox'), P.multi && S.view !== 'activity' ? api('/activity/unread') : {n: 0}]);
  fresh = null;
  if (my !== rendering) return;                     // 使用者已經切到別頁了
  S.inbox = inbox.length;
  const ab = $('#actbtn'); ab.hidden = !P.multi;
  if (P.multi) { const u = unread.n; ab.querySelector('.dot').hidden = !u; ab.querySelector('.dot').textContent = u; ab.classList.toggle('on', S.view === 'activity'); }
  if (pend && pend.length) Promise.all(pend).then(rs => {
    const busy = document.activeElement?.closest?.('#view input,#view textarea') || document.querySelector('.ask');   // 正在打字或開著視窗：不要重畫
    if (my === rendering && !busy && rs.some(r => r.changed)) render(true);
  }).catch(() => {});
  drawRail();
  document.body.classList.toggle('bare', bare());
  if (!bare()) $('#mtitle').innerHTML = '';
  // 使用者剛改了東西（S.full）就整頁重畫，表單才會清空；背景更新才用只換卡片的方式
  if (!S.enter && !S.full && S.lastView === S.view && (html === S.lastHtml || morph(html))) { S.lastHtml = html; fitHome(); return; }
  S.lastView = S.view; S.lastHtml = html; S.full = false;
  $('#view').innerHTML = html;
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  const src = [...tpl.content.querySelectorAll('.card,.hero')].map(c => c.outerHTML);
  $('#view').querySelectorAll('.card,.hero').forEach((c, i) => { c._src = src[i]; });
  S.skel = skeleton(tpl.content);
  decorate();
  fitHome();
  window.scrollTo(0, y);
  if (!S.booted) {                                  // 第一次畫好
    S.booted = true;
    if (document.body.classList.contains('hold')) { try { AsaNative.ready(); } catch { window.splashGone(); } setTimeout(window.splashGone, 3000); }
  }
}
/* 同一頁資料有變（例如手機剛同步、時間過了一分鐘）：只換掉有變的那幾張卡片，不整頁重畫（整頁重畫會閃） */
function skeleton(frag) {
  const d = document.createElement('div'); d.append(frag.cloneNode(true));
  d.querySelectorAll('.card,.hero').forEach(c => c.replaceWith(document.createComment('card')));
  return d.innerHTML;
}
function morph(html) {
  const v = $('#view'), tpl = document.createElement('template'); tpl.innerHTML = html;
  const nc = [...tpl.content.querySelectorAll('.card,.hero')], oc = [...v.querySelectorAll('.card,.hero')];
  if (nc.length !== oc.length || oc.some(c => !c._src) || skeleton(tpl.content) !== S.skel) return false;
  nc.forEach((n, i) => {
    const src = n.outerHTML;
    if (src === oc[i]._src) return;
    oc[i].replaceWith(n); n._src = src;
    if (n.classList.contains('card')) { n.classList.add('border-glow-card'); n.style.setProperty('--i', i + 2); n.insertAdjacentHTML('beforeend', '<span class="edge-light"></span>'); }
    n.querySelectorAll('.seg').forEach(segSync);
  });
  return true;
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
function setPalPref(v) {
  store.set('pal', v); S.rnd = v === 'random' ? randomPal() : null;
  setPal();                                          // 只換顏色和按鈕狀態，不重畫整頁（重畫會閃）
  document.querySelectorAll('.pals .on').forEach(b => b.classList.remove('on'));
  document.querySelector(`.pals [onclick="setPalPref('${v}')"]`)?.classList.add('on');
}
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
  if (!aurora) aurora = createAurora($('#aurora'), {stops: c.stops, amplitude: 1.15, blend: 0.6, height: 0.5, glow: 0.75, layers: 3, speed: 0.9, brightness: 0.9, opacity: 0.85,
    ...(TOUCH_ ? {still: true, maxRatio: 0.6} : {})});
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
  const addBtn = `<button class="hb" aria-label="${t('加一個鬧鐘')}" onclick="pickTime('07:00',{title:'${t('加一個鬧鐘')}'}).then(v=>v&&act('/alarms/plan','POST',{date:'${s.date}',time:v}))">＋</button>
    <button class="hb" onclick="act('/alarms/plan/regenerate?d=${s.date}','POST',null,'${t('已依規則重排')}')">${t('重排')}</button>`;
  if (!al.length) return `<div class="runway"><div class="cap"><span>${t('這天沒有排鬧鐘')}</span><span style="flex:1"></span>${addBtn}</div></div>`;
  const a = mins(al[0].time), last = mins(al[al.length - 1].time);
  const b = anchor ? mins(anchor.time) : last + Math.max(10, (last - a) / 3);
  const pos = x => ((mins(x) - a) / (b - a) * 100).toFixed(2);
  return `<div class="runway ${S.rwOpen ? 'open' : ''}"><div class="cap"><b class="num">${on.length ? on[0].time : '—'}</b>
      <button class="rwx num" onclick="S.rwOpen=!S.rwOpen;this.closest('.runway').classList.toggle('open',S.rwOpen)" aria-label="${t('展開每一個鬧鐘')}">×${on.length}${on.length > 1 ? `　→ ${on[on.length - 1].time}` : ''} <span class="chev">⌄</span></button>
      <span style="flex:1"></span>${addBtn}</div>
    <div class="clip rwclip"><div><div class="rwall">${al.map(x => `<button class="chip num ${x.enabled ? 'on' : 'off'}" title="${t('點一下開關')}" onclick="act('/alarms/plan/${x.id}','PATCH',{enabled:${x.enabled ? 0 : 1}})">${x.time}</button>`).join('')}</div></div></div>
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
  const wx = S.date === TODAY() ? weatherNow() : null;      // 天氣不等：先畫畫面，天氣在背景抓好再補上
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
      ${wxCard(wx)}
    </div><div class="stack">
      ${othersCard(s)}
      <div class="card"><h3 title="${t('越高代表那天越滿；紅色數字是截止的數量')}">${t('未來 14 天行程')}</h3>
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
  const avail = mob ? innerHeight - 210 - 22 : Math.max(560, innerHeight - 230);
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
    <div class="sh-h"><b>${duo(e)}${esc(e.title)}</b>${e.mine || e.shared ? `<button class="btn ghost sm" onclick='editEvent(${JSON.stringify({id: e.id, owner: e.owner, mine: e.mine, title: e.title, start: e.start, end: e.end, location: e.location, note: e.note, shared: e.shared}).replace(/'/g, '&#39;')})'>${t('編輯')}</button>` : ''}<button class="x" onclick="closeSheet()" aria-label="${t('關閉')}">✕</button></div>
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
function ruleCard(r) {
  const wds = r.weekdays.split(',').filter(k => k !== '');
  const tog = i => { const s = new Set(wds); s.has(String(i)) ? s.delete(String(i)) : s.add(String(i)); return [...s].sort().join(','); };
  const P = (field, expr = 'this.value') => `onchange="act('/alarms/rules/${r.id}','PATCH',{${field}:${expr}})"`;
  const num = (label, field, v, unit, min = 1, max = 600) => `<label class="knob"><span>${t(label)}</span><input class="num" type="number" min="${min}" max="${max}" value="${v}" ${P(field, '+this.value')}><em>${t(unit)}</em></label>`;
  const time = (label, field, v, tip = '') => `<label class="knob" title="${tip}"><span>${t(label)}</span><input type="time" value="${esc(v || '')}" ${P(field, 'this.value||null')}></label>`;
  const follow = r.anchor === 'first_event', n = Math.min(r.count, 30), gap = Math.max(4, Math.min(22, r.interval_minutes * 2)), span = (r.count - 1) * r.interval_minutes;
  return `<div class="rule ${r.enabled ? '' : 'off'} ${S.ruleOpen.has(r.id) ? 'open' : ''}"><div class="hd"><input value="${esc(r.name)}" ${P('name')} aria-label="${t('規則名稱')}"><span class="sp"></span>
      <button class="x" title="${t('刪除')}" onclick="act('/alarms/rules/${r.id}','DELETE')">✕</button>
      <button class="sw ${r.enabled ? 'on' : ''}" title="${r.enabled ? t('啟用中') : t('已停用')}" onclick="act('/alarms/rules/${r.id}','PATCH',{enabled:${r.enabled ? 0 : 1}})"><i></i></button></div>
    <div class="wds">${WD1.map((c, i) => `<button class="wd ${wds.includes(String(i)) ? 'on' : ''}" title="${WDN[i]}" onclick="act('/alarms/rules/${r.id}','PATCH',{weekdays:'${tog(i)}'})">${c}</button>`).join('')}</div>
    <div class="seg sm"><button class="${follow ? 'on' : ''}" onclick="act('/alarms/rules/${r.id}','PATCH',{anchor:'first_event'})">${t('跟著行程')}</button><button class="${follow ? '' : 'on'}" onclick="act('/alarms/rules/${r.id}','PATCH',{anchor:'fixed'})">${t('固定時間')}</button></div>
    <div class="knobs">${follow ? num('提前', 'lead_minutes', r.lead_minutes, '分', 0) : time('開始', 'fixed_time', r.fixed_time || '07:00')}${num('間隔', 'interval_minutes', r.interval_minutes, '分')}${num('數量', 'count', r.count, '個', 1, 30)}
      ${follow ? time('沒行程時', 'fixed_time', r.fixed_time, t('那天沒有行程時從幾點開始響；留空就不排鬧鐘')) : ''}</div>
    <button class="dots" onclick="const o=this.parentNode.classList.toggle('open');o?S.ruleOpen.add(${r.id}):S.ruleOpen.delete(${r.id})" title="${t('點一下看每一個的時間')}">${Array.from({length: n}, (_, i) => (i ? `<s style="width:${gap}px"></s>` : '') + `<i style="--i:${i}"></i>`).join('')}<span class="num">${t('{0} 分鐘', span)} ⌄</span></button>
    <div class="clip dclip"><div><div class="dtimes">${Array.from({length: r.count}, (_, i) => follow ? `<span class="chip num">${t('前 {0} 分', r.lead_minutes - i * r.interval_minutes)}</span>`
      : `<span class="chip num">${hhmm((mins(r.fixed_time || '07:00') + i * r.interval_minutes) % 1440)}</span>`).join('')}
      ${follow ? `<div class="muted">${t('以行程開始時間往前算；例如 9:00 的課，第一個是 {0}', hhmm((540 - r.lead_minutes + 1440) % 1440))}</div>` : ''}</div></div></div></div>`;
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
  const on = al.filter(a => a.enabled);
  const sum = al.length ? `<button class="asum" onclick="S.alOpen=!S.alOpen;this.parentNode.classList.toggle('open',S.alOpen)">
      <b class="num">${on.length ? on[0].time : '—'}</b><span class="muted num">${t('{0} 個', on.length)}${on.length > 1 ? '　→ ' + on[on.length - 1].time : ''}${al.length > on.length ? '　' + t('（{0} 個已關閉）', al.length - on.length) : ''}</span>
      <span class="sp"></span><span class="tg">${t('展開')} ⌄</span><span class="tg2">${t('收起')} ⌃</span></button>` : '';
  return `<div class="afold ${S.alOpen ? 'open' : ''}">${sum}<div class="clip"><div><div class="alist">${rows || `<div class="muted empty">${t('這天沒有排鬧鐘')}</div>`}</div></div></div></div>
    <form class="addrow aadd" onsubmit="event.preventDefault();act('/alarms/plan','POST',{date:'${d}',time:this.time.value},'${t('已加入')}')">
      <input class="field" type="time" name="time" required><button class="btn pri">＋ ${t('加鬧鐘')}</button>
      <button type="button" class="btn ghost" title="${t('照下面的規則重新排這天的鬧鐘（手動加的會留著）')}" onclick="act('/alarms/plan/regenerate?d=${d}','POST',null,'${t('已依規則重排')}')">${t('重排')}</button></form>`;
}
function alarmDay(v) {
  if (S.aday === v) return;
  S.aday = v;
  render().then(() => document.querySelector('.hero .afold')?.animate([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 240, easing: 'ease-out'}));
}
VIEW.alarms = async () => {
  const td = TODAY(), tm = shift(td, 1);
  if (!S.aday) S.aday = new Date().getHours() < 12 ? 'td' : 'tm';
  const d = S.aday === 'td' ? td : tm;
  const [rules, s, p, ins, ph] = await Promise.all([api('/alarms/rules'), api('/day?d=' + tm), api('/alarms/plan?d=' + d), api('/alarms/insights'), api('/alarms/phone')]);
  const tips = ins.suggestions.filter(k => k.patch);
  return `<section class="hero"><div class="seg sm aday">${[['td', '今天', td], ['tm', '明天', tm]].map(([v, l, x]) => `<button class="${S.aday === v ? 'on' : ''}" onclick="alarmDay('${v}')">${t(l)} <span class="num">${md(x)}</span></button>`).join('')}</div>
      ${alarmList(p.alarms, d)}${phoneLine(ph)}
      ${p.preview_reason ? `<div class="why">${esc(p.preview_reason)}</div>` : ''}</section>
    ${tips.map(k => `<div class="tip" title="${esc(k.text)}"><span>💡</span><div><b>${esc(k.rule)}</b>　${esc(k.short || k.text)}</div>
      <button class="btn sun" onclick='act("/alarms/rules/${k.rule_id}","PATCH",${JSON.stringify(k.patch)},"${t('已套用')}")'>${t('套用')}</button></div>`).join('')}
    <div class="rules">${rules.map(ruleCard).join('')}
      <button class="rule add" onclick="act('/alarms/rules','POST',{name:'${t('新規則')}',weekdays:'',anchor:'first_event',lead_minutes:90,count:6,interval_minutes:5})"><span>＋</span>${t('新增規則')}</button></div>
    ${ins.mornings.length ? `<details class="fold"><summary>${t('起床紀錄')}</summary><div class="card">${ins.mornings.slice(0, 10).map(m => `<div class="task"><div class="body num">${md(m.date)} ${WDN[m.weekday]}　${m.first}–${m.last}　→　<b>${m.awake}</b><span class="muted">　${m.rang}/${m.count}</span></div></div>`).join('')}</div></details>` : ''}`;
};

/* ---------- 固定行程 ---------- */
VIEW.weekly = async () => {
  const w = await api('/weekly'), today = wdOf(TODAY());
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => w.filter(k => k.weekday === d));
  const form = `<form class="card tadd" onsubmit="event.preventDefault();addWeekly(this)">
      <div class="tadd-top"><input class="field big" type="text" name="title" placeholder="${t('名稱（課、班、健身…）')}" required autocomplete="off"><button class="btn pri">${t('加入')}</button></div>
      <div class="tadd-opts"><div class="wdpick">${WD1.map((c, i) => `<button type="button" onclick="this.classList.toggle('on')" data-d="${i}">${c}</button>`).join('')}</div>
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
  const [st, br, ph, pl] = await Promise.all([api('/status'), api('/brief'), api('/alarms/phone'), api('/place')]);
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
  const members = `<div class="card"><h3>${P.multi ? t('成員') : t('提醒與共用')}${P.admin ? ` <span class="r"><button class="btn" onclick="askText('${t('新成員的名字')}').then(n=>n&&pact('/profiles','POST',{name:n},'${t('已新增，把存取碼給對方就能用')}'))">＋ ${t('新增成員')}</button></span>` : ''}</h3>
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
  return `<div class="cols"><div class="stack">${placeCard(pl)}${phone}${members}</div><div class="stack">${look}${more}</div></div>`;
};

/* ---------- 頂列：指令列、語言、亮暗 ---------- */
const TYPE = {event: '📅', task: '☑️', alarm: '⏰', weekly: '🗓', error: '⚠️'};
const setPlaceholder = () => $('#cmd').placeholder = MOB() ? t('打字或按 🎤：明天三點 開會') : t('打字或按 🎤 說：明天下午三點 開會 @會議室｜週五前 交報告｜鬧鐘 明天 7:30');
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
  // 色系按鈕不加漣漪：圓點旁邊沒有邊界，漣漪會放大蓋住其他圓點，看起來像整排在閃
  const el = e.target.closest('.btn,.hb,.nav,.mc,.task,.ag,.seg button,.tbtn,.d,.wd,.bell');
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


/* ---------- 自己畫的時間／日期選擇器、文字輸入框（取代瀏覽器內建的） ---------- */
function sheetBox(inner, cls = '') {
  const d = document.createElement('div');
  d.className = 'ask picker-wrap';
  d.innerHTML = `<div class="askbox picker ${cls}" role="dialog" aria-modal="true">${inner}</div>`;
  document.body.append(d);
  return d;
}
function closeBox(d) { d.classList.add('out'); setTimeout(() => d.remove(), 180); }
const IH = 40;                                                // 滾輪每一格的高度
function wheel(n, step, cur) {
  const items = Array.from({length: Math.ceil(n / step)}, (_, i) => i * step);
  return `<div class="wheel" data-step="${step}"><div class="pad"></div>${items.map(v => `<div class="wi num" data-i="${v}">${String(v).padStart(2, '0')}</div>`).join('')}<div class="pad"></div></div>`;
}
function wheelVal(w) { const step = +w.dataset.step; return Math.round((w._to ?? w.scrollTop) / IH) * step; }
function wheelSet(w, v, smooth) {
  const top = Math.round(v / +w.dataset.step) * IH;
  w._to = top; clearTimeout(w._tt);
  w._tt = setTimeout(() => { if (w._to === top && Math.abs(w.scrollTop - top) > 2) w.scrollTo({top}); w._to = null; }, 700);   // 平滑捲動被打斷：直接補到位   // 滑動中先記住目標，讀值時用目標
  w.scrollTo({top, behavior: smooth && Math.abs(top - w.scrollTop) <= 8 * IH ? 'smooth' : 'auto'});   // 距離很遠就直接跳過去
}
function pickTime(cur, {title = '', clear = false} = {}) {
  return new Promise(done => {
    const now = new Date(), def = cur && /^\d\d:\d\d/.test(cur) ? cur : hhmm(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5 % 1440);
    const d = sheetBox(`${title ? `<div class="pk-t">${esc(title)}</div>` : ''}
      <div class="wheels"><div class="band"></div>${wheel(24, 1)}<span class="colon">:</span>${wheel(60, 1)}</div>
      <div class="pk-q"><button type="button" class="pq" data-m="0">${t('00 分')}</button><button type="button" class="pq" data-q="30">+30 ${t('分')}</button><button type="button" class="pq" data-m="59">${t('59 分')}</button></div>
      <div class="askrow">${clear ? `<button class="btn" data-v="clear">${t('清除')}</button>` : ''}<button class="btn" data-v="0">${t('取消')}</button><button class="btn pri" data-v="1">${t('確定')}</button></div>`);
    const [wh, wm] = d.querySelectorAll('.wheel');
    // 視窗彈出的動畫期間設定捲動位置可能被吃掉：先設一次，動畫期間再補幾次（使用者動過就不再補）
    let touched = false;
    const userMove = () => { touched = true; wh._to = wm._to = null; };
    d.addEventListener('pointerdown', userMove); d.addEventListener('wheel', userMove, {passive: true});
    const init = () => { if (!touched) { wheelSet(wh, +def.slice(0, 2)); wheelSet(wm, +def.slice(3, 5)); } };
    void wh.offsetHeight; init(); [30, 120, 360].forEach(ms => setTimeout(init, ms));
    d.querySelectorAll('.wi').forEach(el => el.onclick = () => wheelSet(el.parentNode, +el.dataset.i, true));
    const val = () => hhmm(wheelVal(wh) * 60 + wheelVal(wm));
    const fin = v => { document.removeEventListener('keydown', key); closeBox(d); done(v); };
    const key = e => { if (e.key === 'Escape') fin(null); if (e.key === 'Enter') fin(val()); };
    document.addEventListener('keydown', key);
    d.onclick = e => {
      if (e.target === d) return fin(null);
      const mm = e.target.closest('[data-m]');
      if (mm) { touched = true; wheelSet(wm, +mm.dataset.m, true); return; }
      const q = e.target.closest('[data-q]');
      if (q) { const m = (mins(val()) + +q.dataset.q + 1440) % 1440; wheelSet(wh, Math.floor(m / 60), true); wheelSet(wm, m % 60, true); return; }
      const b = e.target.closest('[data-v]'); if (!b) return;
      fin(b.dataset.v === '1' ? val() : b.dataset.v === 'clear' ? '' : null);
    };
  });
}
function pickDate(cur, {clear = false} = {}) {
  return new Promise(done => {
    let m = (cur || TODAY()).slice(0, 7);
    const d = sheetBox('', 'datepk');
    const draw = () => {
      const first = new Date(m + '-01T12:00'), start = shift(m + '-01', -wdOf(m + '-01'));
      const days = Array.from({length: 42}, (_, i) => shift(start, i));
      d.querySelector('.picker').innerHTML = `<div class="pk-m"><button type="button" class="hb" data-n="-1">‹</button>
          <b>${LANG === 'en' ? first.toLocaleDateString(LOCALE, {month: 'long', year: 'numeric'}) : `${first.getFullYear()} 年 ${first.getMonth() + 1} 月`}</b>
          <button type="button" class="hb" data-n="1">›</button></div>
        <div class="pk-g">${WD1.map(c => `<span class="muted">${c}</span>`).join('')}${days.map(x => `<button type="button" class="pd num ${x.slice(0, 7) !== m ? 'out' : ''} ${x === TODAY() ? 'today' : ''} ${x === cur ? 'on' : ''}" data-d="${x}">${+x.slice(8)}</button>`).join('')}</div>
        <div class="askrow">${clear ? `<button class="btn" data-v="clear">${t('清除')}</button>` : ''}<button class="btn" data-v="today">${t('今天')}</button><button class="btn" data-v="0">${t('取消')}</button></div>`;
    };
    const fin = v => { document.removeEventListener('keydown', key); closeBox(d); done(v); };
    const key = e => { if (e.key === 'Escape') fin(null); };
    document.addEventListener('keydown', key);
    d.onclick = e => {
      if (e.target === d) return fin(null);
      const n = e.target.closest('[data-n]'); if (n) { m = addMonth(m + '-01', +n.dataset.n).slice(0, 7); return draw(); }
      const x = e.target.closest('[data-d]'); if (x) return fin(x.dataset.d);
      const b = e.target.closest('[data-v]'); if (!b) return;
      fin(b.dataset.v === 'today' ? TODAY() : b.dataset.v === 'clear' ? '' : null);
    };
    draw();
  });
}
function askText(msg, def = '', ok = t('確定')) {
  return new Promise(done => {
    const d = sheetBox(`<p>${esc(msg)}</p><input class="field big" value="${esc(def)}" maxlength="40" autocomplete="off">
      <div class="askrow" style="margin-top:14px"><button class="btn" data-v="0">${t('取消')}</button><button class="btn pri" data-v="1">${esc(ok)}</button></div>`);
    const inp = d.querySelector('input');
    const fin = v => { closeBox(d); done(v); };
    inp.onkeydown = e => { if (e.key === 'Enter') fin(inp.value.trim() || null); if (e.key === 'Escape') fin(null); };
    d.onclick = e => { if (e.target === d) return fin(null); const b = e.target.closest('[data-v]'); if (b) fin(b.dataset.v === '1' ? inp.value.trim() || null : null); };
    setTimeout(() => inp.focus(), 80);
  });
}
/* 頁面上所有 <input type=time/date> 自動換成點了跳出上面的選擇器 */
function fixInputs(root) {
  root.querySelectorAll?.('input[type=time],input[type=date]').forEach(el => {
    el.dataset.kind = el.type; if (el.required) { el.dataset.req = '1'; el.required = false; }
    el.type = 'text'; el.readOnly = true; el.inputMode = 'none'; el.classList.add('tp');
    if (!el.placeholder) el.placeholder = el.dataset.kind === 'time' ? '--:--' : t('選日期');
  });
}
async function openTp(el) {
  const label = el.closest('label')?.querySelector('span')?.textContent || el.title || '';
  const v = el.dataset.kind === 'time' ? await pickTime(el.value, {title: label, clear: !el.dataset.req && !!el.value})
    : await pickDate(el.value, {clear: !el.dataset.req && !!el.value});
  if (v === null || v === el.value) return;
  el.value = v;
  el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
}
document.addEventListener('click', e => { const el = e.target.closest?.('input.tp'); if (el) { e.preventDefault(); openTp(el); } });
document.addEventListener('submit', e => {                      // 必填的時間還沒選：先跳出選擇器，不送出
  const miss = e.target.querySelector('input.tp[data-req]:not([value]),input.tp[data-req]');
  const empty = [...e.target.querySelectorAll('input.tp[data-req]')].find(x => !x.value);
  if (miss && empty) { e.preventDefault(); e.stopImmediatePropagation(); openTp(empty); }
}, true);
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && fixInputs(n)))).observe(document.body, {childList: true, subtree: true});
fixInputs(document.body);

/* ---------- 行程編輯 ---------- */
function editEvent(e) {
  const box = document.querySelector('.sheetwrap .sheet'); if (!box) return;
  const d = e.start.slice(0, 10), q = e.owner && !e.mine ? `?owner=${e.owner}` : '';
  box.innerHTML = `<div class="sh-h"><b>${t('編輯行程')}</b><button class="x" onclick="closeSheet()" aria-label="${t('關閉')}">✕</button></div>
    <form class="evadd evedit" onsubmit="event.preventDefault();saveEvent(this,${e.id},'${q}')">
      <input class="field big" name="title" value="${esc(e.title)}" required autocomplete="off" placeholder="${t('名稱')}">
      <div class="evrow"><label class="lf"><span>${t('日期')}</span><input class="field" type="date" name="date" value="${d}" required></label></div>
      <div class="evrow"><label class="lf"><span>${t('開始')}</span><input class="field" type="time" name="time" value="${esc(e.start.slice(11, 16))}" required></label>
        <label class="lf"><span>${t('結束')}</span><input class="field" type="time" name="end" value="${esc((e.end || '').slice(11, 16))}"></label></div>
      <input class="field" name="location" value="${esc(e.location || '')}" placeholder="${t('地點')}">
      <textarea class="field" name="note" rows="3" placeholder="${t('備註')}">${esc(e.note || '')}</textarea>
      ${P.multi && e.mine ? `<label class="share"><input type="checkbox" name="shared" ${e.shared ? 'checked' : ''}> ${t('一起')}</label>` : ''}
      <div class="askrow"><button type="button" class="btn danger" onclick="delEvent(${e.id},'${q}')">${t('刪除')}</button>
        <button type="button" class="btn" onclick="openEvent(${e.id},${e.mine ? 'null' : e.owner})">${t('取消')}</button><button class="btn pri">${t('儲存')}</button></div></form>`;
  fixInputs(box);
}
async function saveEvent(f, id, q) {
  const v = Object.fromEntries(new FormData(f));
  if (!v.title.trim() || !v.time) return;
  const body = {title: v.title.trim(), start: v.date + 'T' + v.time, end: v.end ? v.date + 'T' + v.end : null, location: v.location || '', note: v.note || ''};
  if (f.shared) body.shared = f.shared.checked ? 1 : 0;
  await api(`/events/${id}${q}`, 'PATCH', body);
  toast(t('已儲存')); closeSheet();
}
async function delEvent(id, q) {
  if (!await ask(t('刪除這個行程？'))) return;
  await api(`/events/${id}${q}`, 'DELETE'); toast(t('已刪除')); closeSheet();
}


/* ---------- 個人助理：早安簡報（唸出來）、語音輸入 ---------- */
const plain = s => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2300}-\u{23FF}☐]/gu, '').replace(/｜/g, '，').replace(/～/g, '到');
function speak(text) {
  const s = plain(text);
  if (NATIVE) return AsaNative.speak ? AsaNative.speak(s) : toast(t('請更新 Asa App 才能朗讀'));
  if (!window.speechSynthesis) return toast(t('這個瀏覽器不能朗讀'));
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(s); u.lang = LANG === 'en' ? 'en-US' : 'zh-TW'; u.rate = 1.05;
  speechSynthesis.speak(u);
}
function stopSpeak() { if (NATIVE && AsaNative.stopSpeak) AsaNative.stopSpeak(); else window.speechSynthesis?.cancel(); }
async function showBrief(kind = 'morning', autoSpeak = false) {
  const r = await api('/brief?kind=' + kind);
  const d = sheetBox(`<div class="sh-h"><b>${kind === 'morning' ? t('早安') + ' ☀️' : t('明日預告')}</b><button class="x" data-v="0" aria-label="${t('關閉')}">✕</button></div>
    <pre class="brief">${esc(r.text)}</pre>
    <div class="askrow"><button class="btn" data-v="say">🔊 ${t('唸給我聽')}</button><button class="btn pri" data-v="0">${t('好')}</button></div>`, 'briefbox');
  d.onclick = e => {
    const b = e.target === d ? {dataset: {v: '0'}} : e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'say') return speak(r.text);
    stopSpeak(); closeBox(d);
  };
  if (autoSpeak) speak(r.text);
}
/* 🎤：App 裡用手機的語音辨識，瀏覽器裡用 Web Speech（Chrome 支援） */
let listening = false;
window.onVoiceState = st => { listening = st === 'listening'; $('#mic').classList.toggle('on', listening); if (listening) { $('#cmd').value = ''; $('#cmd').placeholder = t('請說…'); } else setPlaceholder(); };
window.onVoicePartial = text => { $('#cmd').value = text; };
window.onVoiceError = code => {
  window.onVoiceState('idle'); $('#cmd').value = '';
  toast({6: t('沒聽到聲音，再按一次說說看'), 7: t('沒聽清楚，再說一次'), 9: t('需要麥克風權限：請在手機設定允許 Asa 使用麥克風'), 2: t('語音辨識需要網路'), 1: t('語音辨識需要網路')}[code] || t('語音辨識失敗（{0}）', code));
};
function listen() {
  if (NATIVE && AsaNative.listen) { if (listening && AsaNative.stopListen) return AsaNative.stopListen(); return AsaNative.listen(); }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast(t('這個瀏覽器不支援語音輸入，可以用鍵盤上的麥克風'));
  const r = new SR(); r.lang = LANG === 'en' ? 'en-US' : 'zh-TW'; r.interimResults = false;
  $('#mic').classList.add('on');
  r.onresult = e => window.onVoice(e.results[0][0].transcript);
  r.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(t('沒聽清楚，再說一次')); };
  r.onend = () => $('#mic').classList.remove('on');
  r.start();
}
window.onVoice = async text => {
  window.onVoiceState('idle'); $('#cmd').value = '';
  text = (text || '').trim(); if (!text) return toast(t('沒聽清楚，再說一次'));
  const p = await api('/quick', 'POST', {text, dry: true});
  if (p.type === 'error') { $('#cmd').value = text; $('#cmd').focus(); return toast(t('聽到「{0}」，但看不懂：', text) + p.summary); }
  if (!await ask(`🎤 ${text}\n\n${TYPE[p.type] || ''} ${p.summary.replaceAll('｜', ' · ')}`, t('建立'), false)) return;
  await api('/quick', 'POST', {text}); toast(t('已建立：') + p.summary.replaceAll('｜', ' · ')); render();
};
$('#mic').onclick = listen;
if (QS.get('brief')) { history.replaceState(null, '', location.pathname); setTimeout(() => showBrief('morning', false), 600); }
/* 目前位置：有權限就自動抓（三小時最多一次），天氣跟著位置走 */
function locate(force) {
  if (!navigator.geolocation) return Promise.resolve(false);
  let last = 0; try { last = +localStorage.getItem('geo_ts') || 0; } catch { /* 無痕模式 */ }
  if (!force && Date.now() - last < 3 * 3600e3) return Promise.resolve(true);
  return new Promise(done => navigator.geolocation.getCurrentPosition(async pos => {
    try { localStorage.setItem('geo_ts', String(Date.now())); } catch { /* 無痕模式 */ }
    try { await api('/place', 'PATCH', {lat: pos.coords.latitude, lon: pos.coords.longitude}); } catch { return done(false); }
    done(true);
  }, err => { if (force) toast(err.code === 1 ? t('沒有位置權限：請在手機設定允許 Asa 使用位置') : t('抓不到目前位置，等一下再試')); done(false); },
  {enableHighAccuracy: false, timeout: 15000, maximumAge: 30 * 60e3}));
}
setTimeout(() => locate(false), 1500);
function placeCard(pl) {
  const w = pl.weather;
  const ago = pl.ts ? Math.round((Date.now() / 1000 - pl.ts) / 60) : null;
  return `<div class="card"><h3>${t('個人助理')}</h3>
    <div class="muted">${t('起床按「我醒了」之後，App 會唸今天的天氣、行程和待辦給你聽；早上的推播簡報也會附上天氣。')}</div>
    <dl class="kv"><dt>${t('位置')}</dt><dd>${pl.name ? `📍 ${esc(pl.name)}${ago != null ? ` <span class="muted">· ${ago < 60 ? t('{0} 分鐘前', ago) : t('{0} 小時前', Math.round(ago / 60))}</span>` : ''}` : `<span class="muted">${t('還沒抓到位置')}</span>`}
        <button class="btn ghost sm" onclick="locate(true).then(ok=>{if(ok){toast(t('已更新位置'));render()}})">${t('重新定位')}</button></dd>
      ${w ? `<dt>${t('今天')}</dt><dd>${w.icon} ${esc(w.text)} ${w.lo}～${w.hi}°C${w.rain != null ? ' · ☔ ' + w.rain + '%' : ''}</dd>` : ''}</dl>
    <div class="addrow"><button class="btn" onclick="showBrief('morning')">☀️ ${t('看早安簡報')}</button><button class="btn ghost" onclick="showBrief('evening')">🌙 ${t('看明日預告')}</button></div></div>`;
}


/* 首頁：今天每小時的天氣（行程下面） */
function weatherNow() {
  const c = CACHE.get('/weather/hourly');
  if (!c || Date.now() - (S.wxAt || 0) > 10 * 60e3) loadWx();
  return c ? structuredClone(c) : 'loading';
}
function loadWx() {
  if (S.wxBusy) return;
  S.wxBusy = true;
  getFresh('/weather/hourly').then(r => {
    S.wxAt = Date.now();
    if (r.changed && S.view === 'day' && S.date === TODAY()) render(true);
  }).catch(() => {}).finally(() => { S.wxBusy = false; });
}
function wxCard(wx) {
  if (wx === 'loading') return `<div class="card wx loading"><h3>${t('今天天氣')}</h3><div class="muted">${t('天氣載入中…')}</div></div>`;
  if (!wx || !wx.hours.length) return '';
  const hs = wx.hours, now = hs[0];
  return `<div class="card wx"><h3>${t('今天天氣')}${wx.place ? ` <span class="muted">· ${esc(wx.place)}</span>` : ''}</h3>
    <div class="wxnow"><span class="wxi">${now.icon}</span><b class="num">${now.temp}°</b><span>${esc(now.text)}${now.rain != null ? ` · ☔ ${now.rain}%` : ''}</span></div>
    <div class="wxh">${hs.map((h, i) => `<div class="wxc ${h.date !== TODAY() ? 'tm' : ''}"><span class="muted num">${i ? (h.time === '00:00' ? t('明天') : +h.time.slice(0, 2) + t('時')) : t('現在')}</span>
      <span class="wxi">${h.icon}</span><b class="num">${h.temp}°</b><span class="rain num">${h.rain >= 20 ? h.rain + '%' : h.rain == null && h.mm >= 0.1 ? h.mm + 'mm' : ''}</span></div>`).join('')}</div></div>`;
}


/* 手機首頁：把行程卡片撐高，讓「今天天氣」的下緣剛好停在導覽列上方一點點 */
function fitHome() {
  const st = document.querySelector('#view .cols > .stack');
  if (!st || S.view !== 'day' || !MOB()) return;
  const ev = st.querySelector('.card'), dock = $('#rail')?.closest('.dock') || document.querySelector('.dock');
  if (!ev || !dock) return;
  ev.style.minHeight = '';
  const em0 = ev.querySelector('.empty'); if (em0) em0.style.paddingTop = em0.style.paddingBottom = '';
  let y = 0; for (let el = st; el; el = el.offsetParent) y += el.offsetTop;     // 不受進場動畫位移影響
  const extra = dock.getBoundingClientRect().top - 20 - (y + st.offsetHeight);
  if (extra > 0) ev.style.minHeight = ev.offsetHeight + extra + 'px';
  else if (extra < 0) {                             // 稍微超出：先把「沒有行程」上下的留白縮掉
    const em = ev.querySelector('.empty');
    if (em) { const cs = getComputedStyle(em), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), cut = Math.min(pad, -extra);
      em.style.paddingTop = em.style.paddingBottom = Math.max(0, (pad - cut) / 2) + 'px'; }
  }
}
addEventListener('resize', () => { clearTimeout(S.fitT); S.fitT = setTimeout(fitHome, 150); });


/* ---------- 展開／收起的動畫 ---------- */
/* <details>：高度順順地打開、收起（瀏覽器內建是瞬間跳開） */
document.addEventListener('click', e => {
  const sm = e.target.closest?.('details > summary');
  if (!sm || CALM) return;
  const d = sm.parentNode;
  e.preventDefault();
  if (d._anim) return;
  const from = d.offsetHeight;
  let to;
  if (d.open) { d.open = false; to = d.offsetHeight; d.open = true; }
  else { d.open = true; to = d.offsetHeight; }
  const closing = to < from;
  d.style.overflow = 'hidden';
  d._anim = d.animate({height: [from + 'px', to + 'px']}, {duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)'});
  const body = [...d.children].filter(c => c !== sm);
  body.forEach(c => c.animate({opacity: closing ? [1, 0] : [0, 1]}, {duration: 220, easing: 'ease', fill: 'both'}));
  d._anim.onfinish = () => {
    d._anim = null; d.style.overflow = '';
    if (closing) d.open = false;
    body.forEach(c => c.getAnimations().forEach(a => a.cancel()));
  };
});
/* 開關（鬧鐘、規則）：先在畫面上切換、播完滑動動畫，再更新資料 */
async function optimistic(el) {
  if (el.classList.contains('sw')) { el.classList.toggle('on'); el.closest('.arow,.rule')?.classList.toggle('off', !el.classList.contains('on')); }
  else if (el.classList.contains('chip')) { el.classList.toggle('on'); el.classList.toggle('off'); }
  else if (el.classList.contains('bell')) el.classList.toggle('off');
}
/* App 開啟動畫：網頁第一次畫好才通知 App 收起動畫，首頁的進場動畫接著播 */
window.splashGone = () => document.body.classList.remove('hold');
