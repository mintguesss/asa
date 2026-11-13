/* 介面文字。程式裡一律寫中文原文 t('今天')，語言是英文時查下面的 EN。
   要加其他語言：再加一個字典，並在 t() 裡多查一層。 */
/* 網址參數可以暫時蓋過偏好設定，方便分享連結或截圖：
   ?view=week&theme=light&lang=en&pal=lilac&date=2026-01-31 */
const QS = new URLSearchParams(location.search);
const store = {
  get(k) { if (QS.has(k)) return QS.get(k); try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { QS.delete(k); try { localStorage.setItem(k, v); } catch (e) {} },
};
let LANG = store.get('lang') || ((navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en');
document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-Hant';

const EN = {
  // 導覽
  '日曆': 'Calendar', '待辦': 'To-do', '審核': 'Inbox', '鬧鐘': 'Alarms', '固定行程': 'Weekly', '設定': 'Settings',
  '日': 'Day', '週': 'Week', '月': 'Month', '今天': 'Today', '明天': 'Tomorrow', '往前': 'Previous', '往後': 'Next',
  '切換亮色／暗色': 'Toggle light / dark', '切換語言': 'Switch language',
  // 共用
  '操作失敗：': 'Failed: ', '加入': 'Add', '刪除': 'Delete', '完成': 'Done', '截止': 'Due', '截止 {0}': 'Due {0}',
  '每週': 'weekly', '地點': 'Place', '{0} 分鐘': '{0} min', '{0} 小時': '{0} h', '{0} 小時 {1} 分': '{0} h {1} min',
  // 指令列
  '說一句話：明天下午三點 開會 @會議室｜週五前 交報告｜鬧鐘 明天 7:30': 'Type it: tomorrow 3pm meeting @room 5 | report by fri | alarm tomorrow 7:30',
  '說一句話：明天三點 開會': 'Type it: tomorrow 3pm meeting',
  'Enter 建立': 'Enter to create', '已建立：': 'Created: ',
  // 日
  '這天沒有排鬧鐘': 'No alarms this day', '加一個鬧鐘（HH:MM）': 'Add an alarm (HH:MM)', '已依規則重排': 'Re-planned from rules', '重排': 'Re-plan',
  '點一下開關': 'Click to toggle', '放假': 'Day off', '這天放假': 'Day off', '取消放假': 'Not a day off', '已取消放假': 'Day off removed',
  '放假原因': 'Reason', '這天的固定行程不算，鬧鐘會重排': 'Weekly events are skipped and alarms re-planned',
  '這天的固定行程不算，鬧鐘已重排': 'Weekly events skipped, alarms re-planned',
  '下一個是 {0} {1}，還有 {2}': 'Next: {0} {1}, in {2}', '今天的行程都結束了': 'Done for today', '今天沒有行程': 'Nothing scheduled today',
  '{0} 個行程，第一個是 {1} {2}': '{0} event(s), first at {1} {2}', '沒有行程': 'Nothing scheduled',
  '{0} 項待辦': '{0} to-do', '{0} 項逾期': '{0} overdue',
  '時間軸': 'Timeline', '行程': 'Schedule', '新增行程': 'New event', '結束（可不填）': 'End (optional)',
  '逾期': 'Overdue', '原訂 {0}': 'planned {0}', '移到這天': 'Move here', '這天沒有待辦': 'Nothing to do',
  '加一項待辦': 'Add a to-do', '這一週': 'This week', '沒有本週待辦': 'Nothing for this week', '這週要完成的事': 'Something for this week',
  '未來 14 天': 'Next 14 days', '越高代表那天越滿；紅色數字是截止的數量': 'Taller = busier; red number = deadlines',
  // 週、月
  '沒有待辦': 'No to-dos', '還有 {0} 項': '{0} more',
  // 待辦
  '本週': 'This week', '之後': 'Later', '整週': 'all week', '未完成': 'Open', '全部做完了 🎉': 'All done 🎉', '新增待辦': 'New to-do',
  '某一天': 'A day', '某一週': 'A week', '截止（可不填）': 'Due (optional)', '最近完成': 'Recently done', '還沒有完成的項目': 'Nothing done yet',
  // 審核
  '作業': 'Homework', '考試': 'Exam', '公告': 'Notice', '其他': 'Other', '手動加一筆': 'Add one manually', '分類': 'Group', '標題': 'Title', '送出': 'Send',
  '沒有待審核的項目': 'Nothing to review', '資料來源抓到新東西時會出現在這裡。': 'New items from your sources show up here.',
  '{0} 則待審核': '{0} to review', '打開原頁 ↗': 'Open source ↗', '也建立成待辦': 'Also create a to-do', '預計哪天做': 'Do it on',
  '略過': 'Skip', '核准': 'Approve', '接下來': 'Up next', '已加入': 'Added', '已略過': 'Skipped',
  // 鬧鐘
  '規則名稱': 'Rule name', '啟用中': 'Enabled', '已停用': 'Disabled', '刪除「{0}」？': 'Delete “{0}”?',
  '跟著行程': 'Follow schedule', '固定時間': 'Fixed time', '提前': 'Lead', '間隔': 'Every', '數量': 'Count', '開始': 'Start', '沒行程時': 'If free',
  '分': 'min', '個': '', '那天沒有行程時從幾點開始響；留空就不排鬧鐘': 'Start time on days with nothing scheduled; empty = no alarms',
  '從第一個到最後一個共 {0} 分鐘': '{0} min from first to last', '套用': 'Apply', '已套用': 'Applied', '新增規則': 'New rule', '新規則': 'New rule',
  '起床紀錄': 'Wake-up log',
  // 固定行程
  '每週固定行程': 'Weekly events', '名稱（課、班、健身…）': 'Name (class, shift, gym…)',
  // 設定
  '外觀': 'Appearance', '語言': 'Language', '主題': 'Theme', '暗色': 'Dark', '亮色': 'Light', '色系': 'Colours', '自動搭配': 'Auto', '隨機': 'Random',
  '每一頁一個顏色，日曆跟著時段和星期變': 'One colour per page; the calendar follows the time of day and the weekday',
  '每換一頁隨機換一個顏色': 'A random colour on every page change',
  '極光': 'Aurora', '晨曦': 'Dawn', '海洋': 'Ocean', '晚霞': 'Dusk', '淺紫': 'Lilac', '薄荷': 'Mint', '日出': 'Sunrise', '玫瑰': 'Rose', '金色': 'Gold',
  '其他成員也看得到': 'Other members can see it too', '一起': 'Shared', '第一個鬧鐘': 'First alarm', '有事': 'Busy',
  '其他成員的設定要由本人或第一位成員來改。': 'Other members\u2019 settings can only be changed by them or by the first member.',
  '名字': 'Name', '起床方式': 'Wake-up', '手機 App 鬧鐘': 'Phone app alarm', '用推播叫': 'Push notification', '不需要': 'Off',
  '行程提醒': 'Event reminder', '分鐘前推播（0 = 不提醒）': 'min before, by push (0 = off)',
  '我的行程': 'My schedule', '其他人看得到': 'Visible to others', '只顯示有事': 'Busy only', '不顯示': 'Hidden',
  '這個人的通知管道': 'Notification channels for this person', '已儲存': 'Saved', '儲存': 'Save',
  '留空的欄位不會變動；沒填的管道會用 .env 裡的設定。': 'Empty fields are left unchanged; channels you don\u2019t fill in fall back to .env.',
  '留空的欄位不會變動。要清掉某一欄，填一個空白再儲存。': 'Empty fields are left unchanged. To clear one, enter a single space and save.',
  '在這台電腦切換成這個人': 'Switch to this person on this computer',
  '移除這位成員？他的資料檔會保留在 data 資料夾。': 'Remove this member? Their data file is kept in the data folder.',
  '移除': 'Remove', '成員': 'Members', '提醒與共用': 'Reminders & sharing', '新成員的名字': 'Name of the new member',
  '已新增，把存取碼給對方就能用': 'Added. Give them their access code to get started', '新增成員': 'Add member', '你': 'You',
  '跟另一半或家人共用？新增一位成員：每個人有自己的鬧鐘、待辦和通知，行程和待辦可以選擇「一起」。':
    'Sharing with a partner or family? Add a member: everyone gets their own alarms, to-dos and notifications, and events or to-dos can be marked as shared.',
  '這天沒有行程': 'Nothing scheduled',
  '完成 {0}': '{0} done', '今天沒有待辦': 'Nothing for today', '沒有': 'Nothing', '新增待辦…': 'New to-do…',
  '這週內': 'This week', '選日期': 'Pick a date', '截止時間': 'Deadline', '請至少選一天': 'Pick at least one day',
  '可以一次選好幾天，例如每週二、四的課。': 'Pick several days at once, e.g. a class on Tuesdays and Thursdays.',
  '還沒有固定行程': 'No weekly events yet', '連線資訊（手機 App、手機瀏覽器）': 'Connection (phone app, phone browser)',
  '進階': 'Advanced', '關閉': 'Close', '留言…': 'Comment…', '送出': 'Send', '刪除這則留言？': 'Delete this comment?',
  '還沒有留言，問問「幾點？」「在哪？」': 'No comments yet. Ask \u201cWhat time?\u201d or \u201cWhere?\u201d', '可以在這裡記一點備註': 'You can jot down notes here',
  '動態': 'Activity', '新增了一起的行程': 'added a shared event', '刪除了一起的行程': 'deleted a shared event', '新增了共用待辦': 'added a shared to-do',
  '完成了共用待辦': 'completed a shared to-do', '留言': 'commented on',
  '還沒有動態。新增「一起」的行程或在行程裡留言，就會出現在這裡。': 'Nothing yet. Shared events and comments will show up here.', '風格': 'Style', '簡約': 'Simple', '炫彩': 'Vivid', '看這天': 'Open day',
  '{0} 起，共 {1} 個鬧鐘': 'From {0}, {1} alarms', '頭貼': 'Photo', '換頭貼': 'Change photo', '頭貼已更新': 'Photo updated', '讀不了這張圖': 'Could not read that image',
  '哪天做': 'Do on', '截止': 'Due', '每日推播': 'Daily briefs', '取消': 'Cancel',
  '取消這天的放假？鬧鐘會依行程重排。': 'Remove this day off? Alarms will be re-planned from your schedule.',
  '刪除這條鬧鐘規則？': 'Delete this alarm rule?', '刪除這個鬧鐘？': 'Delete this alarm?',
  '刪除這個固定行程？之後每週都不會再出現。': 'Delete this weekly event? It will no longer appear any week.',
  '刪除這個行程？': 'Delete this event?', '刪除這項待辦？': 'Delete this to-do?', '確定要刪除嗎？': 'Delete this?',
  '櫻花': 'Sakura', '蜜桃': 'Peach', '珊瑚': 'Coral', '葡萄': 'Grape', '霓虹': 'Neon', '冰川': 'Ice', '潟湖': 'Lagoon', '森林': 'Forest', '抹茶': 'Matcha', '夕陽': 'Sunset', '餘燼': 'Ember', '石墨': 'Graphite',
  '手機 App': 'Phone app', '伺服器網址': 'Server URL', '存取碼': 'Access code', '最後同步': 'Last sync', '還沒連上來過': 'Never connected',
  '手機瀏覽器': 'Phone browser', '這台電腦的IP': 'this-computer-ip', '資料來源': 'Sources', '每 {0} 分鐘': 'every {0} min', '還沒執行過': 'Never run',
  '在 .env 填': 'Set in .env:', '立刻抓': 'Run now', '抓取中…': 'Fetching…', '抓到 {0} 筆，新增 {1} 筆': '{0} found, {1} new',
  '通知': 'Notifications', '測試': 'Test', '已設定': 'Configured', '未設定': 'Not set', '早上簡報': 'Morning brief', '晚上預告': 'Evening preview',
  '今晚會推播的內容': 'Tonight\'s message', '現在推播': 'Send now', '設定都在 .env，改完重新啟動才會生效。': 'Everything lives in .env — restart after changing it.',
  '還沒有設定任何通知管道': 'No notification channel configured',
};

const t = (zh, ...a) => (LANG === 'en' && EN[zh] != null ? EN[zh] : zh).replace(/\{(\d)\}/g, (_, i) => a[i]);
const WD1 = LANG === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : [...'一二三四五六日'];          // 圓點用的一個字
const WDN = LANG === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : [...'一二三四五六日'].map(c => '週' + c);
const LOCALE = LANG === 'en' ? 'en-US' : 'zh-TW';
function setLang(l) { store.set('lang', l); location.reload(); }
