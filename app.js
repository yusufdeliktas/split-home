import { firebaseConfig } from './firebase-config.js';
import { createStore, randomId } from './store.js';
import { money, parseMoney, splitEqual, computeBalances, settle } from './logic.js';

const CATEGORIES = [
  { id: 'market', name: 'Market', icon: '🛒' },
  { id: 'kira', name: 'Kira / Aidat', icon: '🏠' },
  { id: 'fatura', name: 'Faturalar', icon: '💡' },
  { id: 'internet', name: 'İnternet / Telefon', icon: '📶' },
  { id: 'temizlik', name: 'Temizlik', icon: '🧽' },
  { id: 'yemek', name: 'Yemek / Dışarıda', icon: '🍕' },
  { id: 'esya', name: 'Ev eşyası', icon: '🛋️' },
  { id: 'diger', name: 'Diğer', icon: '📦' },
];
const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES.at(-1);
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');
const $toast = document.getElementById('toast');

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const state = {
  store: null,
  status: 'loading', // loading | welcome | pickme | main | fatal
  error: '',
  code: null,
  house: null,
  txs: [],
  me: null,
  tab: 'masraflar',
  listMonth: 'all',
  sumMonth: thisMonth(),
  unsub: null,
};

// ---------- yardımcılar ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thisMonth() { return today().slice(0, 7); }
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[+m - 1]} ${y}`;
}
function dateLabel(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${+d} ${MONTHS[+m - 1].slice(0, 3)}${y === today().slice(0, 4) ? '' : ' ' + y}`;
}
const members = () => state.house?.members || [];
const activeMembers = () => members().filter(m => !m.left);
const nameOf = id => members().find(m => m.id === id)?.name || '?';
const isUsed = id => state.txs.some(t => t.payer === id || id in t.shares);
const shareLink = () => `${location.origin}${location.pathname}#ev=${state.code}`;
const prettyCode = c => c.replace(/(.{4})(.{4})(.*)/, '$1-$2-$3');

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, 2600);
}
function fail(err) {
  console.error(err);
  toast('Hata: kaydedilemedi. İnternet bağlantını kontrol et.');
}
// Yazma işlemleri beklenmez: Firestore çevrimdışıyken kuyruğa alır, ekran hemen güncellenir.
const write = p => Promise.resolve(p).catch(fail);

// ---------- yönlendirme / veri bağlama ----------

function codeFromHash() {
  const m = location.hash.match(/ev=([A-Za-z0-9-]+)/);
  return m ? m[1].replace(/-/g, '').toUpperCase() : null;
}

function route() {
  const code = codeFromHash() || LS.get('splithome:code');
  if (code !== state.code || state.status === 'welcome') openHouse(code);
}

function openHouse(code) {
  state.unsub?.();
  state.unsub = null;
  Object.assign(state, { code, house: null, txs: [] });
  if (!code) {
    state.status = 'welcome';
    return render();
  }
  state.status = 'loading';
  render();
  state.unsub = state.store.watch(code, {
    house(h) {
      if (state.code !== code) return;
      if (!h) return forgetHouse('Bu kodla bir ev bulunamadı. Kodu kontrol et.');
      state.house = h;
      afterLoad();
    },
    txs(list) {
      if (state.code !== code) return;
      state.txs = list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
      if (state.house) afterLoad();
    },
    error(err) {
      console.error(err);
      if (state.code !== code) return;
      if (err.code === 'permission-denied' && !state.house) {
        forgetHouse('Bu eve erişilemedi. Kodu kontrol et.');
      } else {
        toast('Bağlantı hatası: ' + (err.message || err));
      }
    },
  });
}

function afterLoad() {
  LS.set('splithome:code', state.code);
  if (codeFromHash() !== state.code) history.replaceState(null, '', '#ev=' + state.code);
  const me = LS.get('splithome:me:' + state.code);
  state.me = members().some(m => m.id === me) ? me : null;
  if (state.status === 'loading' || !state.me) state.status = state.me ? 'main' : 'pickme';
  render();
}

function forgetHouse(error = '') {
  state.unsub?.();
  state.unsub = null;
  LS.del('splithome:code');
  history.replaceState(null, '', location.pathname);
  Object.assign(state, { code: null, house: null, txs: [], me: null, status: 'welcome', error });
  render();
}

// ---------- görünümler ----------

function render() {
  const views = { loading: viewLoading, welcome: viewWelcome, pickme: viewPickMe, main: viewMain, fatal: viewFatal };
  $app.innerHTML = views[state.status]();
}

function viewLoading() {
  return `<div class="center"><div class="spinner"></div><p class="muted">Yükleniyor…</p></div>`;
}

function viewFatal() {
  return `<div class="center"><h2>Bir sorun oluştu</h2><p class="muted">${esc(state.error)}</p>
    <button class="btn primary" onclick="location.reload()">Tekrar dene</button></div>`;
}

function demoBanner() {
  if (state.store?.mode !== 'local') return '';
  return `<div class="banner">Deneme modu: veriler yalnızca bu cihazda tutuluyor. Ortak kullanım için Firebase ayarı gerekli (README'ye bak).</div>`;
}

function viewWelcome() {
  return `
  <div class="welcome">
    ${demoBanner()}
    <div class="brand">
      <img src="icon.svg" alt="" width="64" height="64">
      <h1>Split Home</h1>
      <p class="muted">Ev arkadaşlarınla ortak masrafları kolayca paylaş.</p>
    </div>
    ${state.error ? `<div class="alert">${esc(state.error)}</div>` : ''}
    <section class="card">
      <h2>Yeni ev oluştur</h2>
      <form data-form="create">
        <label>Ev adı<input name="name" required maxlength="40" placeholder="Örn. Kadıköy'deki ev"></label>
        <label>Ev arkadaşları <small class="muted">(her satıra bir isim, kendin dahil)</small>
          <textarea name="members" rows="4" required placeholder="Ali&#10;Ayşe&#10;Mehmet"></textarea></label>
        <button class="btn primary block">Evi oluştur</button>
      </form>
    </section>
    <section class="card">
      <h2>Var olan eve katıl</h2>
      <form data-form="join">
        <label>Ev kodu<input name="code" required placeholder="ABCD-EFGH-JK" autocomplete="off" autocapitalize="characters"></label>
        <button class="btn block">Katıl</button>
      </form>
      <p class="muted small">Ev arkadaşın sana davet linkini gönderdiyse linke tıklaman yeterli.</p>
    </section>
  </div>`;
}

function viewPickMe() {
  return `
  <div class="welcome">
    <div class="brand"><h1>${esc(state.house.name)}</h1><p class="muted">Sen kimsin? Bu cihazda hatırlanacak.</p></div>
    <div class="pick-list">
      ${activeMembers().map(m => `<button class="btn block big" data-action="set-me" data-id="${m.id}">${esc(m.name)}</button>`).join('')}
    </div>
    <p class="center-text"><button class="link" data-action="leave">Başka bir eve geç</button></p>
  </div>`;
}

function viewMain() {
  const tabs = [
    ['masraflar', 'Masraflar'],
    ['bakiye', 'Hesaplaşma'],
    ['ozet', 'Özet'],
    ['ev', 'Ev'],
  ];
  const body = { masraflar: tabExpenses, bakiye: tabBalances, ozet: tabSummary, ev: tabHouse }[state.tab]();
  return `
  <header class="top">
    <div class="top-inner">
      <div class="top-title">
        <h1>${esc(state.house.name)}</h1>
        <button class="link small" data-action="change-me">👤 ${esc(nameOf(state.me))} · değiştir</button>
      </div>
      <button class="btn ghost" data-action="share">Davet et</button>
    </div>
    <nav class="tabs">
      ${tabs.map(([id, label]) => `<button class="tab${state.tab === id ? ' active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}
    </nav>
  </header>
  <main class="content">
    ${demoBanner()}
    ${body}
  </main>
  <button class="fab" data-action="new-expense" aria-label="Masraf ekle">＋ Masraf ekle</button>`;
}

function myBalanceCard() {
  const bal = computeBalances(members(), state.txs)[state.me] || 0;
  const [cls, text] = bal > 0 ? ['pos', 'alacaklısın'] : bal < 0 ? ['neg', 'borçlusun'] : ['', 'hesabın kapalı'];
  return `
  <div class="card balance-card" data-action="tab" data-tab="bakiye">
    <div class="muted small">Senin durumun</div>
    <div class="big-amount ${cls}">${bal ? money(Math.abs(bal)) : '✓'}</div>
    <div>${text}</div>
  </div>`;
}

function monthsWithData() {
  return [...new Set([thisMonth(), ...state.txs.map(t => t.date.slice(0, 7))])].sort().reverse();
}

function tabExpenses() {
  const list = state.listMonth === 'all' ? state.txs : state.txs.filter(t => t.date.startsWith(state.listMonth));
  const opts = monthsWithData().map(m => `<option value="${m}"${state.listMonth === m ? ' selected' : ''}>${monthLabel(m)}</option>`).join('');
  return `
  ${myBalanceCard()}
  <div class="toolbar">
    <select data-change="list-month" aria-label="Ay filtresi">
      <option value="all"${state.listMonth === 'all' ? ' selected' : ''}>Tüm zamanlar</option>${opts}
    </select>
    <button class="btn" data-action="new-payment">⇄ Ödeme kaydet</button>
  </div>
  ${list.length ? `<ul class="tx-list">${list.map(txItem).join('')}</ul>`
    : `<div class="empty">Henüz kayıt yok.<br>Sağ alttaki <b>＋ Masraf ekle</b> ile başla.</div>`}`;
}

function txItem(t) {
  const mine = (t.payer === state.me ? t.amount : 0) - (t.shares[state.me] || 0);
  const mineHtml = mine ? `<div class="small ${mine > 0 ? 'pos' : 'neg'}">${mine > 0 ? 'alacak' : 'borç'} ${money(Math.abs(mine))}</div>`
    : `<div class="small muted">${t.type === 'payment' ? '' : 'payın yok'}</div>`;
  if (t.type === 'payment') {
    const to = Object.keys(t.shares)[0];
    const role = t.payer === state.me ? 'ödedin' : to === state.me ? 'sana ödendi' : '';
    return `
    <li class="tx payment" data-action="tx-detail" data-id="${t.id}">
      <div class="tx-icon">⇄</div>
      <div class="tx-main">
        <div class="tx-title">${esc(nameOf(t.payer))} → ${esc(nameOf(to))}</div>
        <div class="tx-sub">Ödeme · ${dateLabel(t.date)}${t.desc ? ' · ' + esc(t.desc) : ''}</div>
      </div>
      <div class="tx-amt"><div>${money(t.amount)}</div><div class="small muted">${role}</div></div>
    </li>`;
  }
  const c = catOf(t.category);
  return `
  <li class="tx" data-action="tx-detail" data-id="${t.id}">
    <div class="tx-icon">${c.icon}</div>
    <div class="tx-main">
      <div class="tx-title">${esc(t.desc)}</div>
      <div class="tx-sub">${esc(nameOf(t.payer))} ödedi · ${dateLabel(t.date)} · ${Object.keys(t.shares).length} kişi</div>
    </div>
    <div class="tx-amt"><div>${money(t.amount)}</div>${mineHtml}</div>
  </li>`;
}

function tabBalances() {
  const bal = computeBalances(members(), state.txs);
  const max = Math.max(1, ...Object.values(bal).map(Math.abs));
  const plan = settle(bal);
  const rows = members()
    .filter(m => !m.left || bal[m.id])
    .map(m => {
      const v = bal[m.id] || 0;
      const w = Math.round((Math.abs(v) / max) * 100);
      return `
      <div class="bal-row">
        <div class="bal-name">${esc(m.name)}${m.id === state.me ? ' <span class="muted small">(sen)</span>' : ''}</div>
        <div class="bal-bar"><div class="${v >= 0 ? 'pos-bg' : 'neg-bg'}" style="width:${w}%"></div></div>
        <div class="bal-val ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}</div>
      </div>`;
    }).join('');
  const planHtml = plan.length
    ? `<ul class="plan">${plan.map(p => `
        <li>
          <div><b>${esc(nameOf(p.from))}</b> → <b>${esc(nameOf(p.to))}</b><div class="big-amount-sm">${money(p.amount)}</div></div>
          <button class="btn primary" data-action="settle" data-from="${p.from}" data-to="${p.to}" data-amount="${p.amount}">Ödendi ✓</button>
        </li>`).join('')}</ul>`
    : `<div class="empty">🎉 Herkes ödeşmiş, kimsenin kimseye borcu yok.</div>`;
  return `
  <section class="card">
    <h2>Bakiyeler</h2>
    <p class="muted small">+ alacaklı, − borçlu</p>
    ${rows}
  </section>
  <section class="card">
    <h2>Kim kime ne ödemeli?</h2>
    <p class="muted small">Borçları en az sayıda ödemeyle kapatan öneri. Para gönderildiğinde “Ödendi”ye bas.</p>
    ${planHtml}
  </section>`;
}

function tabSummary() {
  const month = state.sumMonth;
  const exp = state.txs.filter(t => t.type !== 'payment' && t.date.startsWith(month));
  const total = exp.reduce((s, t) => s + t.amount, 0);
  const byCat = {};
  for (const t of exp) byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(c => c[1]));
  const people = members().map(m => ({
    m,
    paid: exp.filter(t => t.payer === m.id).reduce((s, t) => s + t.amount, 0),
    share: exp.reduce((s, t) => s + (t.shares[m.id] || 0), 0),
  })).filter(p => !p.m.left || p.paid || p.share);
  const opts = monthsWithData().map(m => `<option value="${m}"${month === m ? ' selected' : ''}>${monthLabel(m)}</option>`).join('');
  return `
  <div class="toolbar"><select data-change="sum-month" aria-label="Ay">${opts}</select></div>
  <section class="card">
    <div class="muted small">${monthLabel(month)} toplam ev masrafı</div>
    <div class="big-amount">${money(total)}</div>
    <div class="muted small">${exp.length} masraf · kişi başı ortalama ${money(Math.round(total / Math.max(1, activeMembers().length)))}</div>
  </section>
  <section class="card">
    <h2>Kategoriler</h2>
    ${cats.length ? cats.map(([id, v]) => `
      <div class="cat-row">
        <div class="cat-name">${catOf(id).icon} ${catOf(id).name}</div>
        <div class="bal-bar"><div class="accent-bg" style="width:${Math.round((v / maxCat) * 100)}%"></div></div>
        <div class="bal-val">${money(v)}</div>
      </div>`).join('') : '<div class="empty">Bu ay masraf yok.</div>'}
  </section>
  <section class="card">
    <h2>Kişiler</h2>
    <table class="tbl">
      <thead><tr><th>Kişi</th><th>Ödediği</th><th>Payı</th></tr></thead>
      <tbody>${people.map(p => `<tr><td>${esc(p.m.name)}</td><td>${money(p.paid)}</td><td>${money(p.share)}</td></tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function tabHouse() {
  return `
  <section class="card">
    <h2>Davet</h2>
    <p class="muted small">Ev arkadaşlarına bu linki gönder. Linki ya da kodu bilen herkes bu eve erişebilir, sadece güvendiğin kişilerle paylaş.</p>
    <div class="code-box">${prettyCode(state.code)}</div>
    <div class="row-btns">
      <button class="btn primary" data-action="share">Linki paylaş</button>
      <button class="btn" data-action="copy-code">Kodu kopyala</button>
    </div>
  </section>
  <section class="card">
    <h2>Ev arkadaşları</h2>
    <ul class="member-list">
      ${members().map(m => `
        <li class="${m.left ? 'left' : ''}">
          <span>${esc(m.name)}${m.left ? ' <span class="muted small">(ayrıldı)</span>' : ''}</span>
          <span class="row-btns">
            <button class="btn sm" data-action="rename-member" data-id="${m.id}">Düzenle</button>
            <button class="btn sm ${m.left ? '' : 'danger-text'}" data-action="remove-member" data-id="${m.id}">${m.left ? 'Geri al' : 'Çıkar'}</button>
          </span>
        </li>`).join('')}
    </ul>
    <form data-form="add-member" class="inline-form">
      <input name="name" required maxlength="30" placeholder="Yeni kişi adı">
      <button class="btn">Ekle</button>
    </form>
  </section>
  <section class="card">
    <h2>Ayarlar</h2>
    <div class="stack">
      <button class="btn" data-action="rename-house">Ev adını değiştir</button>
      <button class="btn" data-action="export">Excel'e aktar (CSV)</button>
      <button class="btn danger-text" data-action="leave">Bu cihazda evden çık</button>
    </div>
    <p class="muted small">“Evden çık” sadece bu cihazdaki bağlantıyı kaldırır; veriler silinmez, kodla tekrar girebilirsin.</p>
  </section>`;
}

// ---------- modallar ----------

function openModal(html, onMount) {
  $modal.innerHTML = `<div class="backdrop" data-backdrop><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add('modal-open');
  const el = $modal.querySelector('.modal');
  onMount?.(el);
  el.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])')?.focus();
}
function closeModal() {
  $modal.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function memberOptions(selected, list = activeMembers()) {
  return list.map(m => `<option value="${m.id}"${m.id === selected ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
}

function expenseModal(tx) {
  const isEqual = !tx || equalSplit(tx);
  const people = members().filter(m => !m.left || (tx && (m.id in tx.shares || m.id === tx.payer)));
  const checked = id => (tx ? id in tx.shares : true);
  const payerList = members().filter(m => !m.left || m.id === tx?.payer);
  openModal(`
  <form data-form="expense" data-id="${tx?.id || ''}">
    <h2>${tx ? 'Masrafı düzenle' : 'Yeni masraf'}</h2>
    <label>Açıklama<input name="desc" required maxlength="60" placeholder="Örn. Migros alışverişi" value="${esc(tx?.desc)}"></label>
    <div class="row">
      <label>Tutar (₺)<input name="amount" inputmode="decimal" required placeholder="0,00" value="${tx ? (tx.amount / 100).toFixed(2).replace('.', ',') : ''}"></label>
      <label>Tarih<input type="date" name="date" required value="${tx?.date || today()}"></label>
    </div>
    <div class="row">
      <label>Kategori<select name="category">${CATEGORIES.map(c => `<option value="${c.id}"${(tx?.category || 'market') === c.id ? ' selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></label>
      <label>Kim ödedi?<select name="payer">${memberOptions(tx?.payer || state.me, payerList)}</select></label>
    </div>
    <fieldset>
      <legend>Kimler arasında bölünecek?</legend>
      <div class="seg">
        <label><input type="radio" name="split" value="equal"${isEqual ? ' checked' : ''}><span>Eşit böl</span></label>
        <label><input type="radio" name="split" value="custom"${isEqual ? '' : ' checked'}><span>Farklı tutarlar</span></label>
      </div>
      <div class="parts">
        ${people.map(m => `
          <div class="part">
            <label class="chk"><input type="checkbox" name="p" value="${m.id}"${checked(m.id) ? ' checked' : ''}> ${esc(m.name)}</label>
            <input class="part-amt" name="amt-${m.id}" inputmode="decimal" placeholder="0,00" value="${tx && !isEqual && tx.shares[m.id] ? (tx.shares[m.id] / 100).toFixed(2).replace('.', ',') : ''}">
            <span class="part-share muted small"></span>
          </div>`).join('')}
      </div>
      <p class="split-info small"></p>
    </fieldset>
    <p class="form-error" hidden></p>
    <div class="modal-actions">
      ${tx ? `<button type="button" class="btn danger-text" data-action="delete-tx" data-id="${tx.id}">Sil</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-action="close-modal">Vazgeç</button>
      <button class="btn primary">Kaydet</button>
    </div>
  </form>`, el => {
    const form = el.querySelector('form');
    const update = () => updateSplitPreview(form);
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  });
}

function equalSplit(tx) {
  const ids = Object.keys(tx.shares);
  const eq = splitEqual(tx.amount, ids);
  return ids.every(id => eq[id] === tx.shares[id]);
}

function readSplit(form) {
  const amount = parseMoney(form.amount.value);
  const ids = [...form.querySelectorAll('input[name=p]:checked')].map(i => i.value);
  const custom = form.split.value === 'custom';
  let shares = null, error = '';
  if (!ids.length) error = 'En az bir kişi seçmelisin.';
  else if (!(amount > 0)) error = '';
  else if (!custom) shares = splitEqual(amount, ids);
  else {
    shares = {};
    let sum = 0;
    for (const id of ids) {
      const raw = form[`amt-${id}`].value.trim();
      const v = raw ? parseMoney(raw) : 0;
      if (Number.isNaN(v)) { error = 'Kişi tutarlarından biri geçersiz.'; shares = null; break; }
      if (v > 0) shares[id] = v;
      sum += v;
    }
    if (shares && sum !== amount) {
      const diff = amount - sum;
      error = diff > 0 ? `Dağıtılacak ${money(diff)} kaldı.` : `Kişi tutarları toplamdan ${money(-diff)} fazla.`;
      shares = null;
    }
    if (shares && !Object.keys(shares).length) { error = 'Kişi tutarlarını gir.'; shares = null; }
  }
  return { amount, ids, custom, shares, error };
}

function updateSplitPreview(form) {
  const { amount, ids, custom, shares, error } = readSplit(form);
  form.querySelectorAll('.part').forEach(p => {
    const id = p.querySelector('input[name=p]').value;
    const on = ids.includes(id);
    p.classList.toggle('off', !on);
    const amt = p.querySelector('.part-amt');
    amt.hidden = !custom || !on;
    p.querySelector('.part-share').textContent = !custom && on && shares ? money(shares[id]) : '';
  });
  const info = form.querySelector('.split-info');
  info.className = 'split-info small ' + (error ? 'neg' : 'muted');
  info.textContent = error || (amount > 0 && shares ? (custom ? 'Tutarlar toplamla eşleşiyor ✓' : `Kişi başı yaklaşık ${money(Math.round(amount / ids.length))}`) : '');
}

function paymentModal(pre = {}) {
  const others = activeMembers();
  const from = pre.from || state.me;
  const to = pre.to || others.find(m => m.id !== from)?.id;
  openModal(`
  <form data-form="payment">
    <h2>Ödeme kaydet</h2>
    <p class="muted small">Bir ev arkadaşına borcunu ödediğinde (nakit, IBAN vb.) buraya kaydet.</p>
    <div class="row">
      <label>Kim ödedi?<select name="from">${memberOptions(from)}</select></label>
      <label>Kime?<select name="to">${memberOptions(to)}</select></label>
    </div>
    <div class="row">
      <label>Tutar (₺)<input name="amount" inputmode="decimal" required placeholder="0,00" value="${pre.amount ? (pre.amount / 100).toFixed(2).replace('.', ',') : ''}"></label>
      <label>Tarih<input type="date" name="date" required value="${today()}"></label>
    </div>
    <label>Not <small class="muted">(isteğe bağlı)</small><input name="desc" maxlength="60" placeholder="Örn. IBAN ile gönderildi"></label>
    <p class="form-error" hidden></p>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button type="button" class="btn" data-action="close-modal">Vazgeç</button>
      <button class="btn primary">Kaydet</button>
    </div>
  </form>`);
}

function txDetailModal(t) {
  const isPay = t.type === 'payment';
  const c = catOf(t.category);
  openModal(`
  <h2>${isPay ? '⇄ Ödeme' : `${c.icon} ${esc(t.desc)}`}</h2>
  <div class="big-amount">${money(t.amount)}</div>
  <p class="muted">${dateLabel(t.date)} · ${isPay ? `${esc(nameOf(t.payer))} → ${esc(nameOf(Object.keys(t.shares)[0]))}` : `${esc(nameOf(t.payer))} ödedi · ${c.name}`}</p>
  ${isPay ? (t.desc ? `<p>${esc(t.desc)}</p>` : '') : `
  <table class="tbl">
    <thead><tr><th>Kişi</th><th>Payı</th></tr></thead>
    <tbody>${Object.entries(t.shares).map(([id, v]) => `<tr><td>${esc(nameOf(id))}</td><td>${money(v)}</td></tr>`).join('')}</tbody>
  </table>`}
  ${t.createdBy ? `<p class="muted small">Kaydeden: ${esc(nameOf(t.createdBy))}</p>` : ''}
  <div class="modal-actions">
    <button type="button" class="btn danger-text" data-action="delete-tx" data-id="${t.id}">Sil</button>
    <span class="spacer"></span>
    ${isPay ? '' : `<button type="button" class="btn" data-action="edit-tx" data-id="${t.id}">Düzenle</button>`}
    <button type="button" class="btn primary" data-action="close-modal">Tamam</button>
  </div>`);
}

function textModal(title, label, value, onSave) {
  openModal(`
  <form data-form="text">
    <h2>${esc(title)}</h2>
    <label>${esc(label)}<input name="value" required maxlength="40" value="${esc(value)}"></label>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button type="button" class="btn" data-action="close-modal">Vazgeç</button>
      <button class="btn primary">Kaydet</button>
    </div>
  </form>`);
  textModal.onSave = onSave;
}

function confirmModal(message, okLabel, onOk, danger = false) {
  openModal(`
  <p class="confirm-msg">${message}</p>
  <div class="modal-actions">
    <span class="spacer"></span>
    <button type="button" class="btn" data-action="close-modal">Vazgeç</button>
    <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-action="confirm-ok">${esc(okLabel)}</button>
  </div>`);
  confirmModal.onOk = onOk;
}

function showFormError(form, msg) {
  const el = form.querySelector('.form-error');
  el.textContent = msg;
  el.hidden = false;
}

// ---------- işlemler ----------

const actions = {
  'tab'(el) { state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  'set-me'(el) {
    LS.set('splithome:me:' + state.code, el.dataset.id);
    state.me = el.dataset.id;
    state.status = 'main';
    render();
  },
  'change-me'() { state.status = 'pickme'; render(); },
  'leave'() {
    confirmModal('Bu cihazda evden çıkılsın mı? Veriler silinmez; kodla tekrar girebilirsin.', 'Çık', () => forgetHouse(), true);
  },
  async 'share'() {
    const url = shareLink();
    const text = `${state.house.name} masraf defterine katıl:`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Split Home', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    copy(url, 'Davet linki kopyalandı');
  },
  'copy-code'() { copy(prettyCode(state.code), 'Ev kodu kopyalandı'); },
  'new-expense'() {
    if (!activeMembers().length) return toast('Önce ev arkadaşı ekle');
    expenseModal();
  },
  'new-payment'() {
    if (activeMembers().length < 2) return toast('En az iki kişi olmalı');
    paymentModal();
  },
  'settle'(el) {
    const { from, to } = el.dataset;
    const amount = +el.dataset.amount;
    confirmModal(`<b>${esc(nameOf(from))}</b>, <b>${esc(nameOf(to))}</b> kişisine <b>${money(amount)}</b> ödedi olarak kaydedilsin mi?`, 'Kaydet', () => {
      write(state.store.addTx(state.code, makePayment(from, to, amount, today(), '')));
      toast('Ödeme kaydedildi');
    });
  },
  'tx-detail'(el) {
    const t = state.txs.find(x => x.id === el.dataset.id);
    if (t) txDetailModal(t);
  },
  'edit-tx'(el) {
    const t = state.txs.find(x => x.id === el.dataset.id);
    if (t) expenseModal(t);
  },
  'delete-tx'(el) {
    const t = state.txs.find(x => x.id === el.dataset.id);
    if (!t) return;
    confirmModal(`“${esc(t.desc || 'Ödeme')}” (${money(t.amount)}) silinsin mi?`, 'Sil', () => {
      write(state.store.deleteTx(state.code, t.id));
      toast('Silindi');
    }, true);
  },
  'rename-member'(el) {
    const m = members().find(x => x.id === el.dataset.id);
    textModal('Kişiyi düzenle', 'İsim', m.name, name => {
      saveMembers(members().map(x => (x.id === m.id ? { ...x, name } : x)));
    });
  },
  'remove-member'(el) {
    const m = members().find(x => x.id === el.dataset.id);
    if (m.left) return saveMembers(members().map(x => (x.id === m.id ? { id: x.id, name: x.name } : x)));
    if (activeMembers().length <= 1) return toast('Evde en az bir kişi kalmalı');
    if (isUsed(m.id)) {
      confirmModal(`${esc(m.name)} geçmiş kayıtlarda yer alıyor. “Ayrıldı” olarak işaretlenecek: yeni masraflarda görünmez ama geçmişi ve bakiyesi korunur.`, 'Ayrıldı olarak işaretle', () => {
        saveMembers(members().map(x => (x.id === m.id ? { ...x, left: true } : x)));
      });
    } else {
      confirmModal(`${esc(m.name)} evden çıkarılsın mı?`, 'Çıkar', () => {
        saveMembers(members().filter(x => x.id !== m.id));
      }, true);
    }
  },
  'rename-house'() {
    textModal('Ev adını değiştir', 'Ev adı', state.house.name, name => {
      write(state.store.updateHouse(state.code, { name }));
    });
  },
  'export'() { exportCsv(); },
  'close-modal'() { closeModal(); },
  'confirm-ok'() {
    const fn = confirmModal.onOk;
    closeModal();
    fn?.();
  },
};

const forms = {
  async 'create'(form) {
    const name = form.name.value.trim();
    const names = [...new Set(form.members.value.split(/\n|,/).map(s => s.trim()).filter(Boolean))];
    if (!name) return toast('Ev adı gir');
    if (names.length < 2) return toast('En az iki kişi yazmalısın');
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Oluşturuluyor…';
    try {
      const code = await state.store.createHouse({ name, members: names.map(n => ({ id: randomId(6), name: n.slice(0, 30) })) });
      state.error = '';
      location.hash = 'ev=' + code;
      toast('Ev oluşturuldu! “Davet et” ile arkadaşlarına link gönder.');
    } catch (e) {
      fail(e);
      btn.disabled = false;
      btn.textContent = 'Evi oluştur';
    }
  },
  'join'(form) {
    const code = form.code.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code.length < 6) return toast('Kod geçersiz');
    state.error = '';
    location.hash = 'ev=' + code;
  },
  'expense'(form) {
    const { amount, ids, shares, error } = readSplit(form);
    const desc = form.desc.value.trim();
    if (!desc) return showFormError(form, 'Açıklama gir.');
    if (!(amount > 0)) return showFormError(form, 'Geçerli bir tutar gir (örn. 250 veya 250,50).');
    if (!ids.length || !shares) return showFormError(form, error || 'Bölüşümü kontrol et.');
    const id = form.dataset.id;
    const old = id && state.txs.find(t => t.id === id);
    const tx = {
      type: 'expense',
      desc,
      amount,
      category: form.category.value,
      payer: form.payer.value,
      shares,
      date: form.date.value || today(),
      createdAt: old?.createdAt || Date.now(),
      createdBy: old?.createdBy || state.me,
    };
    write(id ? state.store.updateTx(state.code, id, tx) : state.store.addTx(state.code, tx));
    closeModal();
    toast(id ? 'Güncellendi' : 'Masraf eklendi');
  },
  'payment'(form) {
    const amount = parseMoney(form.amount.value);
    const from = form.from.value, to = form.to.value;
    if (from === to) return showFormError(form, 'Ödeyen ve alan aynı kişi olamaz.');
    if (!(amount > 0)) return showFormError(form, 'Geçerli bir tutar gir.');
    write(state.store.addTx(state.code, makePayment(from, to, amount, form.date.value || today(), form.desc.value.trim())));
    closeModal();
    toast('Ödeme kaydedildi');
  },
  'add-member'(form) {
    const name = form.name.value.trim().slice(0, 30);
    if (!name) return;
    if (members().some(m => m.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) return toast('Bu isim zaten var');
    saveMembers([...members(), { id: randomId(6), name }]);
    toast(`${name} eklendi`);
  },
  'text'(form) {
    const v = form.value.value.trim();
    if (!v) return;
    const fn = textModal.onSave;
    closeModal();
    fn?.(v);
  },
};

function makePayment(from, to, amount, date, desc) {
  return { type: 'payment', desc, amount, category: 'odeme', payer: from, shares: { [to]: amount }, date, createdAt: Date.now(), createdBy: state.me };
}

function saveMembers(list) {
  state.house = { ...state.house, members: list };
  render();
  write(state.store.updateHouse(state.code, { members: list }));
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    textModal('Kopyala', 'Aşağıdaki metni kopyala', text, () => {});
  }
}

function exportCsv() {
  const ms = members();
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const num = k => (k / 100).toFixed(2).replace('.', ',');
  const header = ['Tarih', 'Tür', 'Açıklama', 'Kategori', 'Tutar', 'Ödeyen', ...ms.map(m => `${m.name} payı`)];
  const rows = [...state.txs].reverse().map(t => [
    t.date,
    t.type === 'payment' ? 'Ödeme' : 'Masraf',
    t.type === 'payment' ? `${nameOf(t.payer)} → ${nameOf(Object.keys(t.shares)[0])}${t.desc ? ' (' + t.desc + ')' : ''}` : t.desc,
    t.type === 'payment' ? '' : catOf(t.category).name,
    num(t.amount),
    nameOf(t.payer),
    ...ms.map(m => (t.shares[m.id] ? num(t.shares[m.id]) : '')),
  ]);
  const csv = '﻿' + [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${state.house.name.replace(/[^\p{L}\p{N}]+/gu, '_')}_masraflar.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- olay dinleyicileri ----------

document.addEventListener('click', e => {
  if (e.target.matches('[data-backdrop]')) return closeModal();
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    e.preventDefault();
    actions[el.dataset.action](el);
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});

document.addEventListener('change', e => {
  const k = e.target.dataset?.change;
  if (k === 'list-month') { state.listMonth = e.target.value; render(); }
  if (k === 'sum-month') { state.sumMonth = e.target.value; render(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $modal.innerHTML) closeModal();
});

// ---------- başlat ----------

async function init() {
  render();
  try {
    state.store = await createStore(firebaseConfig);
  } catch (err) {
    console.error(err);
    state.status = 'fatal';
    state.error = 'Veritabanına bağlanılamadı. ' + (err.code === 'auth/operation-not-allowed'
      ? 'Firebase konsolunda Anonymous (Anonim) girişi etkinleştir.'
      : (err.message || err));
    return render();
  }
  window.addEventListener('hashchange', route);
  openHouse(codeFromHash() || LS.get('splithome:code'));
}

init();
