// Para hesapları kuruş (tam sayı) cinsinden tutulur; ondalık hatası olmaz.

const fmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

export const money = kurus => fmt.format(kurus / 100);

// "1.250,50", "1250,5", "1250.50", "₺ 300" gibi girişleri kuruşa çevirir. Geçersizse NaN.
export function parseMoney(input) {
  let s = String(input ?? '').replace(/[\s₺]/g, '').replace(/tl$/i, '');
  if (!s) return NaN;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma > -1) {
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

// Tutarı kişilere eşit böler; artan kuruşlar ilk kişilere dağıtılır.
export function splitEqual(amount, ids) {
  const base = Math.floor(amount / ids.length);
  let rest = amount - base * ids.length;
  const shares = {};
  for (const id of ids) shares[id] = base + (rest-- > 0 ? 1 : 0);
  return shares;
}

// Pozitif bakiye: alacaklı, negatif: borçlu.
export function computeBalances(members, txs) {
  const bal = Object.fromEntries(members.map(m => [m.id, 0]));
  for (const t of txs) {
    bal[t.payer] = (bal[t.payer] || 0) + t.amount;
    for (const [id, share] of Object.entries(t.shares)) bal[id] = (bal[id] || 0) - share;
  }
  return bal;
}

// Borçları en az sayıda transferle kapatacak öneriler.
export function settle(bal) {
  const cred = [], debt = [];
  for (const [id, v] of Object.entries(bal)) {
    if (v > 0) cred.push({ id, v });
    else if (v < 0) debt.push({ id, v: -v });
  }
  cred.sort((a, b) => b.v - a.v);
  debt.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].v, cred[j].v);
    out.push({ from: debt[i].id, to: cred[j].id, amount: x });
    debt[i].v -= x;
    cred[j].v -= x;
    if (!debt[i].v) i++;
    if (!cred[j].v) j++;
  }
  return out;
}
