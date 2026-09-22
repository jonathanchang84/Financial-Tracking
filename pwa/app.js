(() => {
  'use strict';

  const DB_NAME = 'financial-health-local';
  const DB_VERSION = 2;
  // Aligned with the iOS AppDataStore: separate current items + dated histories.
  const stores = ['settings', 'bills', 'commitments', 'netWorthEntries', 'netWorthHistory', 'holdings', 'portfolioHistory', 'pensions', 'pensionHistory', 'transactions', 'budgets', 'accounts', 'snapshots'];
  const currencies = { USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', CAD: 'Canadian Dollar', AUD: 'Australian Dollar', JPY: 'Japanese Yen', CHF: 'Swiss Franc', CNY: 'Chinese Yuan', INR: 'Indian Rupee' };
  const state = { view: 'dashboard', theme: localStorage.getItem('fh-theme') || 'light', data: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const id = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const money = (value, currency = 'USD') => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '$0.00';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: num % 1 === 0 ? 0 : 2 }).format(num); } catch { return '$' + num.toFixed(2); }
  };
  const number = (value) => Number(value || 0);
  const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
  const decimal = (value) => Math.round(number(value) * 100) / 100;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        stores.forEach((name) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' }); });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function all(storeName) { const db = await openDB(); return new Promise((resolve, reject) => { const req = db.transaction(storeName).objectStore(storeName).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  async function put(storeName, value) { const db = await openDB(); return new Promise((resolve, reject) => { const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value); req.onsuccess = () => resolve(value); req.onerror = () => reject(req.error); }); }
  async function remove(storeName, valueId) { const db = await openDB(); return new Promise((resolve, reject) => { const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(valueId); req.onsuccess = resolve; req.onerror = () => reject(req.error); }); }
  async function clearStore(storeName) { const db = await openDB(); return new Promise((resolve, reject) => { const req = db.transaction(storeName, 'readwrite').objectStore(storeName).clear(); req.onsuccess = resolve; req.onerror = () => reject(req.error); }); }
  async function loadData() {
    const entries = await Promise.all(stores.map(async (store) => [store, await all(store)]));
    const result = Object.fromEntries(entries);
    result.settings = Object.fromEntries(result.settings.map((item) => [item.key, item.value]));
    // Migrate legacy web data into the iOS-aligned stores (lossless, one-way).
    migrateLegacy(result);
    return result;
  }
  function legacyCurrency(item) { return item.currencyCode || item.currency || 'USD'; }
  function legacySeries(item, fallback) { return item.series || item.symbol || item.name || fallback; }
  function migrateLegacy(data) {
    const legacy = (data.snapshots || []).filter((s) => s && s.type);
    if (legacy.length) {
      legacy.forEach((s) => {
        if (s.type === 'networth') {
          if (!data.netWorthEntries.some((e) => (e.name || 'Account') === legacySeries(s, 'Account') && legacyCurrency(e) === legacyCurrency(s))) {
            data.netWorthEntries.push({ id: id(), name: legacySeries(s, 'Account'), institution: '', kind: 'Asset', value: number(s.value), currencyCode: legacyCurrency(s) });
          }
          data.netWorthHistory.push({ id: s.id || id(), series: legacySeries(s, 'Account'), date: s.date || today(), value: number(s.value), currencyCode: legacyCurrency(s) });
        } else if (s.type === 'portfolio') {
          if (!data.holdings.some((h) => legacySeries(h, 'Fund') === legacySeries(s, 'Fund') && legacyCurrency(h) === legacyCurrency(s))) {
            data.holdings.push({ id: id(), name: legacySeries(s, 'Fund'), symbol: legacySeries(s, 'Fund'), type: 'Fund', quantity: 1, price: number(s.value), currencyCode: legacyCurrency(s) });
          }
          data.portfolioHistory.push({ id: s.id || id(), series: legacySeries(s, 'Fund'), date: s.date || today(), value: number(s.value), currencyCode: legacyCurrency(s) });
        } else if (s.type === 'pension') {
          if (!data.pensions.some((p) => (p.name || 'Pension pot') === legacySeries(s, 'Pension pot') && legacyCurrency(p) === legacyCurrency(s))) {
            data.pensions.push({ id: id(), name: legacySeries(s, 'Pension pot'), provider: '', value: number(s.value), currencyCode: legacyCurrency(s) });
          }
          data.pensionHistory.push({ id: s.id || id(), series: legacySeries(s, 'Pension pot'), date: s.date || today(), value: number(s.value), currencyCode: legacyCurrency(s) });
        }
      });
    }
    (data.transactions || []).filter((t) => t.type === 'expense').forEach((t) => {
      if (!data.commitments.some((c) => c.id === t.id)) {
        data.commitments.push({ id: t.id || id(), name: t.name || t.category || 'Commitment', date: t.date || today(), amount: number(t.amount), currencyCode: legacyCurrency(t) });
      }
    });
    return data;
  }
  function currencyOf(item) { return item.currencyCode || item.currency || state.data?.settings?.balanceCurrency || 'USD'; }
  function seriesNameOf(item) { return item.series || item.symbol || item.name || 'Item'; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c])); }
  async function saveSetting(key, value) { await put('settings', { id: key, key, value }); state.data.settings[key] = value; }
  async function saveRecord(store, record) {
    await put(store, record);
    state.data[store] = await all(store);
    render();
    showToast('Saved');
  }
  async function deleteRecord(store, recordId) {
    await remove(store, recordId);
    state.data[store] = await all(store);
    if (store === 'settings') state.data.settings = Object.fromEntries(state.data.settings.map((item) => [item.key, item.value]));
    render();
  }

  function setTheme(theme) { state.theme = theme; document.documentElement.dataset.theme = theme; localStorage.setItem('fh-theme', theme); $('#theme-toggle').textContent = theme === 'dark' ? '☾' : '☼'; }
  function populateCurrencies() { $$('[data-currencies]').forEach((select) => { select.innerHTML = Object.entries(currencies).map(([code, name]) => `<option value="${code}">${code} · ${name}</option>`).join(''); }); }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
  function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
  function switchView(view) { state.view = view; $$('.view').forEach((section) => section.classList.toggle('active', section.dataset.view === view)); $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.nav === view)); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function syncModalClose(root) { $$('[data-close-modal]', root).forEach((b) => b.onclick = closeModal); }
  function openModal(title, content, onSubmit) { const root = $('#modal-root'); root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${title}"><div class="section-heading"><div><p class="eyebrow">LOCAL ENTRY</p><h3>${title}</h3></div><button class="text-button" data-close-modal>Close</button></div>${content}</section></div>`; syncModalClose(root); $('.modal-backdrop', root).onclick = (event) => { if (event.target === event.currentTarget) closeModal(); }; const form = $('form', root); if (form) form.onsubmit = async (event) => { event.preventDefault(); const result = await onSubmit(formData(form)); if (result !== false) closeModal(); }; }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  function currencyOptions(selected = 'USD') { return Object.entries(currencies).map(([code, name]) => `<option value="${code}" ${selected === code ? 'selected' : ''}>${code} · ${name}</option>`).join(''); }
  const options = (selected = 'USD') => currencyOptions(selected);
  function dateInput(value = today()) { return `<input name="date" type="date" value="${value}" required>`; }

  function drawChart(canvas, series, colors) {
    if (!canvas || !series.length) return;
    const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1; const width = Math.max(280, rect.width); const height = Number(canvas.getAttribute('height')) || 220;
    canvas.width = width * ratio; canvas.height = height * ratio; const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
    const allValues = series.flatMap((line) => line.values.map((point) => number(point.value))); const min = Math.min(0, ...allValues); const max = Math.max(1, ...allValues); const pad = { top: 18, right: 12, bottom: 26, left: 46 }; const chartW = width - pad.left - pad.right; const chartH = height - pad.top - pad.bottom;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted'); ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line'); ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i += 1) { const y = pad.top + chartH * (i / 3); ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); ctx.fillText(money(max - ((max - min) * i / 3), series[0].currency || 'USD'), 3, y + 4); }
    series.forEach((line, lineIndex) => { if (!line.values.length) return; ctx.beginPath(); line.values.forEach((point, index) => { const x = pad.left + (line.values.length === 1 ? chartW / 2 : chartW * index / (line.values.length - 1)); const y = pad.top + chartH * (1 - (number(point.value) - min) / (max - min || 1)); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.strokeStyle = colors[lineIndex]; ctx.lineWidth = 2.5; ctx.stroke(); });
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted'); ctx.fillText(series[0].values[0]?.label || '', pad.left, height - 6); const last = series[0].values.at(-1); if (last) ctx.fillText(last.label || '', width - pad.right - 70, height - 6);
  }

  function currentTotals() {
    const totals = {};
    (state.data.netWorthEntries || []).forEach((item) => {
      const cur = currencyOf(item);
      const signed = (item.kind === 'liability' || item.kind === 'Liability') ? -number(item.value) : number(item.value);
      totals[cur] = (totals[cur] || 0) + signed;
    });
    return totals;
  }
  // storeName is an iOS-aligned history store: netWorthHistory | portfolioHistory | pensionHistory
  function snapshotSeries(storeName, currency, key = null) {
    return (state.data[storeName] || [])
      .filter((item) => currencyOf(item) === currency && (!key || seriesNameOf(item) === key))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  function monthGrowth(points) { if (points.length < 2 || !number(points.at(-2).value)) return 'Not enough data for month-on-month growth'; const change = ((number(points.at(-1).value) - number(points.at(-2).value)) / number(points.at(-2).value)) * 100; return `Latest change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}% month-on-month`; }
  function projectedPoints(value, annualRate, months = 12) { return Array.from({ length: months + 1 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() + index); return { label: date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value: number(value) * Math.pow(1 + number(annualRate), index / 12) }; }); }
  function monthlyDates(start, end) { const dates = []; const cursor = new Date(`${start}T12:00:00`); const finish = new Date(`${end}T12:00:00`); while (cursor <= finish) { dates.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); } return dates; }

  const exchangeRates = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.53, JPY: 149.50, CHF: 0.88, CNY: 7.24, INR: 83.12 };

  function convertCurrency(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amount;
    const fromRate = exchangeRates[fromCurrency] || 1;
    const toRate = exchangeRates[toCurrency] || 1;
    return amount * (toRate / fromRate);
  }

  function renderDashboard() {
    const displayCurrency = $('#dashboard-currency').value || 'USD';
    const totals = currentTotals();
    const transactionSpend = state.data.transactions.reduce((sum, item) => sum + (item.type === 'expense' ? number(item.amount) : 0), 0);
    const spendInDisplayCurrency = convertCurrency(transactionSpend, state.data.settings.balanceCurrency || 'USD', displayCurrency);
    
    // Convert all totals to display currency
    const convertedTotals = {};
    let totalNetWorth = 0;
    Object.entries(totals).forEach(([currency, value]) => {
      const converted = convertCurrency(value, currency, displayCurrency);
      convertedTotals[currency] = converted;
      totalNetWorth += converted;
    });
    
    const balance = number(state.data.settings.balance);
    const balanceInDisplay = convertCurrency(balance, state.data.settings.balanceCurrency || 'USD', displayCurrency);
    
    $('#headline-metrics').innerHTML = `<div class="metric"><span class="eyebrow">NET WORTH</span><span class="value">${money(totalNetWorth, displayCurrency)}</span><span class="detail">Across local records</span></div><div class="metric"><span class="eyebrow">AVAILABLE</span><span class="value">${money(balanceInDisplay, displayCurrency)}</span><span class="detail">Next payday ${state.data.settings.payday ? dateLabel(state.data.settings.payday) : 'not set'}</span></div><div class="metric"><span class="eyebrow">EXPENSES LOGGED</span><span class="value">${money(spendInDisplayCurrency, displayCurrency)}</span><span class="detail">Local activity only</span></div>`;
    
    const payday = state.data.settings.payday || today();
    const days = Math.max(1, Math.ceil((new Date(`${payday}T12:00:00`) - new Date()) / 86400000));
    const daily = balance / days;
    const dailyInDisplay = convertCurrency(daily, state.data.settings.balanceCurrency || 'USD', displayCurrency);
    const paydayBalanceInDisplay = convertCurrency(balance - daily * days, state.data.settings.balanceCurrency || 'USD', displayCurrency);
    
    $('#runway-summary').innerHTML = `<div><span>Daily safe-to-spend</span><strong>${money(dailyInDisplay, displayCurrency)}</strong></div><div><span>Days to payday</span><strong>${days}</strong></div><div><span>Payday balance</span><strong>${money(paydayBalanceInDisplay, displayCurrency)}</strong></div>`;
    
    // Render runway table instead of chart
    const rows = Array.from({ length: Math.min(days + 1, 31) }, (_, index) => {
      const runningBalance = balance - daily * index;
      const runningInDisplay = convertCurrency(runningBalance, state.data.settings.balanceCurrency || 'USD', displayCurrency);
      const date = new Date();
      date.setDate(date.getDate() + index);
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return { label, value: runningBalance, valueInDisplay: runningInDisplay };
    });
    
    $('#runway-table').innerHTML = rows.map((row, index) => `
      <div class="stack-row">
        <span><strong>Day ${index + 1}</strong><small>${row.label}</small></span>
        <strong>${money(row.valueInDisplay, displayCurrency)}</strong>
      </div>
    `).join('') || '<p class="muted">Set your balance and payday to see the runway.</p>';
    
    $('#networth-breakdown').innerHTML = Object.entries(totals).length ? Object.entries(totals).map(([currency, value]) => {
      const converted = convertCurrency(value, currency, displayCurrency);
      return `<div class="stack-row"><span><strong>${currency}</strong><small>Net position (converted)</small></span><strong>${money(converted, displayCurrency)}</strong></div>`;
    }).join('') : '<p class="muted">Add an account snapshot to begin.</p>';
    
    const budgets = state.data.budgets;
    $('#budget-health').innerHTML = budgets.length ? budgets.slice(0, 2).map((budget) => {
      const spentInDisplay = convertCurrency(number(budget.spent || 0), budget.currency, displayCurrency);
      const limitInDisplay = convertCurrency(number(budget.limit), budget.currency, displayCurrency);
      return `<div class="stack-row"><span><strong>${budget.name}</strong><small>${spentInDisplay.toFixed(2)} of ${limitInDisplay.toFixed(2)} ${displayCurrency}</small></span><strong>${Math.max(0, limitInDisplay - spentInDisplay).toFixed(2)} left</strong></div>`;
    }).join('') : '<p class="muted">Set a monthly budget target.</p>';
  }

  function renderCashflow() {
    if (!state.data) return;
    const form = $('#cash-settings-form'); const settings = state.data.settings || {};
    if (!form) return;
    form.balance.value = settings.balance ?? ''; form.currency.value = settings.balanceCurrency || 'USD'; form.payday.value = settings.payday || today();
    const rangeEl = $('#cash-range'); if (rangeEl) rangeEl.textContent = settings.payday ? `Through ${dateLabel(settings.payday)}` : 'Set your next payday';
    const currencySelect = $('#cashflow-currency');
    const displayCurrency = (currencySelect && currencySelect.value) || settings.balanceCurrency || 'USD';
    if (currencySelect) currencySelect.value = displayCurrency;
    // iOS runway: one row per day from today through payday with starting, safe, commitments, bills, ending.
    const balanceCurrency = settings.balanceCurrency || 'USD';
    const balance = number(settings.balance);
    const paydayStr = settings.payday || today();
    const startDay = new Date(); startDay.setHours(12, 0, 0, 0);
    const endDay = new Date(`${paydayStr}T12:00:00`);
    const dayCount = Math.max(1, Math.ceil((endDay - startDay) / 86400000) + 1);
    const safeToday = dayCount ? balance / dayCount : 0;
    const bills = (state.data.bills || []).filter((b) => currencyOf(b) === balanceCurrency);
    const commitments = (state.data.commitments || []).filter((c) => currencyOf(c) === balanceCurrency);
    const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    function billsOn(date) {
      return bills.filter((b) => {
        const dueDay = Math.min(number(b.dueDay) || 1, daysInMonth(date.getFullYear(), date.getMonth()));
        if (dueDay !== date.getDate()) return false;
        const wd = date.getDay();
        let shifted = new Date(date); if (wd === 6) shifted.setDate(shifted.getDate() + 2); else if (wd === 0) shifted.setDate(shifted.getDate() + 1);
        return shifted.getDate() === date.getDate();
      }).reduce((s, b) => s + number(b.amount), 0);
    }
    function commitmentsOn(date) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return commitments.filter((c) => String(c.date) === key).reduce((s, c) => s + number(c.amount), 0);
    }
    let running = balance; let cumulative = 0; let rowsHtml = '';
    const totalDays = Math.min(dayCount, 45);
    for (let i = 0; i < totalDays; i += 1) {
      const d = new Date(startDay); d.setDate(d.getDate() + i);
      const starting = running;
      const cToday = commitmentsOn(d);
      const bToday = billsOn(d);
      cumulative += cToday;
      const ending = starting - safeToday - cToday - bToday;
      running = ending;
      rowsHtml += `<div class="stack-row"><span><strong>${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong><small>Day ${i + 1}</small></span><span>${money(convertCurrency(starting, balanceCurrency, displayCurrency), displayCurrency)}<small>Starting</small></span><span>${money(convertCurrency(safeToday, balanceCurrency, displayCurrency), displayCurrency)}<small>Safe today</small></span><span>${money(convertCurrency(cToday, balanceCurrency, displayCurrency), displayCurrency)}<small>Commitments</small></span><span>${money(convertCurrency(cumulative, balanceCurrency, displayCurrency), displayCurrency)}<small>Cumulative</small></span><span>${money(convertCurrency(bToday, balanceCurrency, displayCurrency), displayCurrency)}<small>Bills</small></span><span><strong>${money(convertCurrency(ending, balanceCurrency, displayCurrency), displayCurrency)}</strong><small>Ending</small></span></div>`;
    }
    const tableEl = $('#cashflow-table'); if (tableEl) tableEl.innerHTML = rowsHtml || '<p class="muted">Set your balance and payday to see the daily runway.</p>';
    const cashSummary = $('#cash-runway-summary');
    if (cashSummary) cashSummary.innerHTML = `<div><span>Safe to commit each day</span><strong>${money(convertCurrency(safeToday, balanceCurrency, displayCurrency), displayCurrency)}</strong></div><div><span>Days to payday</span><strong>${totalDays}</strong></div><div><span>Projected at payday</span><strong>${money(convertCurrency(running, balanceCurrency, displayCurrency), displayCurrency)}</strong></div>`;
    const cList = $('#commitment-list');
    if (cList) cList.innerHTML = (state.data.commitments || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((item) => {
      const cur = currencyOf(item);
      return `<div class="stack-row"><span><strong>${escapeHtml(item.name || 'Commitment')}</strong><small>${dateLabel(item.date)} · ${cur}</small></span><span><strong>${money(number(item.amount), cur)}</strong> <button class="text-button" data-edit="commitments" data-id="${item.id}">Edit</button> <button class="text-button" data-delete="commitments" data-id="${item.id}">Delete</button></span></div>`;
    }).join('') || '<p class="muted">No commitments recorded yet.</p>';
    const bList = $('#bill-list');
    if (bList) bList.innerHTML = (state.data.bills || []).map((bill) => {
      const cur = currencyOf(bill);
      return `<div class="stack-row"><span><strong>${escapeHtml(bill.name || 'Bill')}</strong><small>${escapeHtml(bill.category || '')} · due day ${bill.dueDay ?? ''} · ${cur}</small></span><span><strong>${money(number(bill.amount), cur)}</strong> <button class="text-button" data-edit="bills" data-id="${bill.id}">Edit</button> <button class="text-button" data-delete="bills" data-id="${bill.id}">Delete</button></span></div>`;
    }).join('') || '<p class="muted">No recurring bills yet.</p>';
  }

  function renderPosition() {
    if (!state.data) return;
    const select = $('#position-currency');
    const entries = state.data.netWorthEntries || [];
    const history = state.data.netWorthHistory || [];
    const currenciesUsed = [...new Set([...entries.map(currencyOf), ...history.map(currencyOf)])];
    const fallback = state.data.settings?.balanceCurrency || 'USD';
    const displayCurrency = currenciesUsed.includes(select.value) ? select.value : (currenciesUsed[0] || fallback);
    select.value = displayCurrency;
    select.innerHTML = currencyOptions(displayCurrency);
    const points = snapshotSeries('netWorthHistory', displayCurrency);
    const growthEl = $('#position-growth'); if (growthEl) growthEl.textContent = monthGrowth(points);
    const totals = currentTotals();
    const totalsEl = $('#position-totals');
    if (totalsEl) totalsEl.innerHTML = Object.entries(totals)
      .map(([currency, value]) => {
        const converted = convertCurrency(value, currency, displayCurrency);
        return `<div class="stack-row"><span><strong>${currency}</strong><small>Net position (converted to ${displayCurrency})</small></span><strong>${money(converted, displayCurrency)}</strong></div>`;
      })
      .join('') || '<p class="muted">No current position recorded.</p>';
    const entryRows = entries.map((e) => {
      const cur = currencyOf(e);
      const sub = [e.institution, e.kind, cur].filter(Boolean).join(' • ');
      return `<div class="stack-row"><span><strong>${escapeHtml(e.name || 'Account')}</strong><small>${escapeHtml(sub)}</small></span><span><strong>${money(number(e.value), cur)}</strong> <button class="text-button" data-edit="netWorthEntries" data-id="${e.id}">Edit</button> <button class="text-button" data-update-entry="netWorthEntries" data-id="${e.id}">Update</button> <button class="text-button" data-delete="netWorthEntries" data-id="${e.id}">Delete</button></span></div>`;
    }).join('');
    const histRows = points.map((p) => {
      const cur = currencyOf(p);
      const converted = convertCurrency(number(p.value), cur, displayCurrency);
      return `<div class="stack-row"><span><strong>${money(converted, displayCurrency)}</strong><small>${dateLabel(p.date)} · ${escapeHtml(seriesNameOf(p))} · original: ${money(number(p.value), cur)} ${cur}</small></span><span><button class="text-button" data-edit="netWorthHistory" data-id="${p.id}">Edit</button> <button class="text-button" data-delete="netWorthHistory" data-id="${p.id}">Delete</button></span></div>`;
    }).join('');
    const histEl = $('#position-history');
    if (histEl) histEl.innerHTML = (entryRows ? `<div class="section-heading"><div><p class="eyebrow">ACCOUNTS</p><h3>Current position</h3></div></div>` + entryRows : '') + (histRows ? `<div class="section-heading"><div><p class="eyebrow">HISTORY</p><h3>Dated snapshots</h3></div></div>` + histRows : '<p class="muted">No position values recorded yet.</p>');
  }
  function renderPortfolio() {
    if (!state.data) return;
    const select = $('#portfolio-currency');
    const holdings = state.data.holdings || [];
    const hist = state.data.portfolioHistory || [];
    const currenciesUsed = [...new Set([...holdings.map(currencyOf), ...hist.map(currencyOf)])];
    const fallback = state.data.settings?.balanceCurrency || 'USD';
    const displayCurrency = currenciesUsed.includes(select.value) ? select.value : (currenciesUsed[0] || fallback);
    select.value = displayCurrency;
    select.innerHTML = currencyOptions(displayCurrency);
    const pts = snapshotSeries('portfolioHistory', displayCurrency);
    const growthEl = $('#portfolio-growth'); if (growthEl) growthEl.textContent = monthGrowth(pts);
    const holdRows = holdings.map((h) => {
      const cur = currencyOf(h);
      const mv = number(h.quantity) * number(h.price);
      const sub = [h.symbol, h.type, `${number(h.quantity)} units`, cur].filter(Boolean).join(' • ');
      return `<div class="stack-row"><span><strong>${escapeHtml(seriesNameOf(h))}</strong><small>${escapeHtml(sub)}</small></span><span><strong>${money(mv, cur)}</strong> <button class="text-button" data-edit="holdings" data-id="${h.id}">Edit</button> <button class="text-button" data-update-entry="holdings" data-id="${h.id}">Update</button> <button class="text-button" data-delete="holdings" data-id="${h.id}">Delete</button></span></div>`;
    }).join('');
    const snapRows = pts.map((p) => {
        const cur = currencyOf(p);
        const converted = convertCurrency(number(p.value), cur, displayCurrency);
        return `<div class="stack-row"><span><strong>${money(converted, displayCurrency)}</strong><small>${dateLabel(p.date)} · ${escapeHtml(seriesNameOf(p))} · original: ${money(number(p.value), cur)} ${cur}</small></span><span><button class="text-button" data-edit="portfolioHistory" data-id="${p.id}">Edit</button> <button class="text-button" data-delete="portfolioHistory" data-id="${p.id}">Delete</button></span></div>`;
      }).join('');
    const portEl = $('#portfolio-history');
    if (portEl) portEl.innerHTML = (holdRows ? `<div class="section-heading"><div><p class="eyebrow">HOLDINGS</p><h3>Current holdings</h3></div></div>` + holdRows : '') + (snapRows ? `<div class="section-heading"><div><p class="eyebrow">HISTORY</p><h3>Dated snapshots</h3></div></div>` + snapRows : '<p class="muted">No portfolio values recorded yet.</p>');
  }
  function renderPensions() {
    if (!state.data) return;
    const select = $('#pension-currency');
    const pots = state.data.pensions || [];
    const phist = state.data.pensionHistory || [];
    const currenciesUsed = [...new Set([...pots.map(currencyOf), ...phist.map(currencyOf)])];
    const fallback = state.data.settings?.balanceCurrency || 'USD';
    const displayCurrency = currenciesUsed.includes(select.value) ? select.value : (currenciesUsed[0] || fallback);
    select.value = displayCurrency;
    select.innerHTML = currencyOptions(displayCurrency);
    const pts = snapshotSeries('pensionHistory', displayCurrency);
    const growthEl = $('#pension-growth'); if (growthEl) growthEl.textContent = monthGrowth(pts);
    const potRows = pots.map((pp) => {
      const cur = currencyOf(pp);
      const sub = [pp.provider, cur].filter(Boolean).join(' • ');
      return `<div class="stack-row"><span><strong>${escapeHtml(pp.name || 'Pension pot')}</strong><small>${escapeHtml(sub)}</small></span><span><strong>${money(number(pp.value), cur)}</strong> <button class="text-button" data-edit="pensions" data-id="${pp.id}">Edit</button> <button class="text-button" data-update-entry="pensions" data-id="${pp.id}">Update</button> <button class="text-button" data-delete="pensions" data-id="${pp.id}">Delete</button></span></div>`;
    }).join('');
    const snapRows = pts.map((p) => {
        const cur = currencyOf(p);
        const converted = convertCurrency(number(p.value), cur, displayCurrency);
        return `<div class="stack-row"><span><strong>${money(converted, displayCurrency)}</strong><small>${dateLabel(p.date)} · ${escapeHtml(seriesNameOf(p))} · original: ${money(number(p.value), cur)} ${cur}</small></span><span><button class="text-button" data-edit="pensionHistory" data-id="${p.id}">Edit</button> <button class="text-button" data-delete="pensionHistory" data-id="${p.id}">Delete</button></span></div>`;
      }).join('');
    const penEl = $('#pension-history');
    if (penEl) penEl.innerHTML = (potRows ? `<div class="section-heading"><div><p class="eyebrow">POTS</p><h3>Current pots</h3></div></div>` + potRows : '') + (snapRows ? `<div class="section-heading"><div><p class="eyebrow">HISTORY</p><h3>Dated snapshots</h3></div></div>` + snapRows : '<p class="muted">No pension values recorded yet.</p>');
  }
  function renderBudgets() { $('#budget-list').innerHTML = state.data.budgets.map((budget) => { const used = number(budget.spent); const limit = number(budget.limit); const percent = Math.min(100, limit ? (used / limit) * 100 : 0); return `<article class="budget-card ${percent > 100 ? 'over' : ''}"><p class="eyebrow">MONTHLY TARGET</p><h3>${budget.name}</h3><div class="budget-number">${money(Math.max(0, limit - used), budget.currency)} left</div><div class="progress"><span style="width:${percent}%"></span></div><p class="muted" style="margin-top:8px">${money(used, budget.currency)} used of ${money(limit, budget.currency)}</p><button class="text-button" data-delete="budgets" data-id="${budget.id}">Remove</button></article>`; }).join('') || '<p class="muted">No budgets yet. Add a safety target.</p>'; }
  function render() {
    if (!state.data) return;
    renderDashboard();
    renderCashflow();
    renderPosition();
    renderPortfolio();
    renderPensions();
    renderBudgets();
  }

  function addSpendModal() {
    openModal('Record daily spend', `<form>
      <label>Name<input name="name" placeholder="Evening groceries" required></label>
      <label>Date${dateInput()}</label>
      <label>Amount<input name="amount" type="number" step="0.01" required></label>
      <label>Category<input name="category" placeholder="Food"></label>
      <label>Currency<select name="currency">${options()}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Save spend</button></div>
    </form>`, async (data) => {
      const name = String(data.name || '').trim();
      if (!name) { showToast('Give the spend a name such as Evening groceries'); return false; }
      await saveRecord('transactions', { id: id(), type: 'expense', date: data.date, amount: decimal(data.amount), category: data.category || 'Spend', currency: data.currency, name });
      showToast('Daily spend saved');
    });
  }

  function editSpendModal(transaction) {
    openModal('Update spend', `<form>
      <label>Name<input name="name" value="${escapeHtml(transaction?.name || '')}" required></label>
      <label>Date${dateInput(transaction?.date || '', 'date')}</label>
      <label>Amount<input name="amount" type="number" step="0.01" value="${transaction?.amount || ''}" required></label>
      <label>Category<input name="category" value="${escapeHtml(transaction?.category || '')}"></label>
      <label>Currency<select name="currency">${options(transaction?.currency || 'USD')}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Update spend</button></div>
    </form>`, async (data) => {
      await saveRecord('transactions', { id: transaction.id, type: 'expense', date: data.date, amount: decimal(data.amount), category: data.category || 'Spend', currency: data.currency, name: data.name });
      showToast('Spend updated');
    });
  }

  function commitmentModal(existing) {
    const isEdit = Boolean(existing);
    openModal(isEdit ? 'Update commitment' : 'Add commitment', `<form>
      <label>Name<input name="name" value="${escapeHtml(existing?.name || '')}" placeholder="Evening groceries" required></label>
      <label>Date${dateInput(existing?.date || '', 'date')}</label>
      <label>Amount<input name="amount" type="number" step="0.01" value="${existing?.amount ?? ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(existing?.currencyCode || state.data?.settings?.balanceCurrency || 'USD')}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">${isEdit ? 'Save commitment' : 'Add commitment'}</button></div>
    </form>`, async (data) => {
      const name = String(data.name || '').trim();
      if (!name) { showToast('Give the commitment a name'); return false; }
      if (!(Number(data.amount) > 0)) { showToast('Enter a valid amount'); return false; }
      await saveRecord('commitments', { id: existing?.id || id(), name, date: data.date, amount: decimal(data.amount), currencyCode: data.currency });
      showToast(isEdit ? 'Commitment updated' : 'Commitment added');
    });
  }

  function billModal(existing) {
    const isEdit = Boolean(existing);
    openModal(isEdit ? 'Update bill' : 'Add bill', `<form>
      <label>Name<input name="name" value="${escapeHtml(existing?.name || '')}" placeholder="Rent" required></label>
      <label>Category<input name="category" value="${escapeHtml(existing?.category || '')}" placeholder="Housing"></label>
      <label>Amount<input name="amount" type="number" step="0.01" value="${existing?.amount ?? ''}" required></label>
      <label>Due day (1-31)<input name="dueDay" type="number" min="1" max="31" value="${existing?.dueDay ?? ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(existing?.currencyCode || state.data?.settings?.balanceCurrency || 'USD')}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">${isEdit ? 'Save bill' : 'Add bill'}</button></div>
    </form>`, async (data) => {
      const name = String(data.name || '').trim();
      if (!name) { showToast('Give the bill a name'); return false; }
      if (!(Number(data.amount) > 0)) { showToast('Enter a valid amount'); return false; }
      const dueDay = Math.min(31, Math.max(1, Number(data.dueDay) || 1));
      await saveRecord('bills', { id: existing?.id || id(), name, category: data.category || 'Bill', amount: decimal(data.amount), dueDay, currencyCode: data.currency });
      showToast(isEdit ? 'Bill updated' : 'Bill added');
    });
  }

  // Mirrors the iOS AddNetWorthView: creates a named current account/asset/liability.
  function positionModal() { openModal('Add account', `<form>
    <label>Name<input name="name" placeholder="Barclays savings" required></label>
    <label>Institution<input name="institution" placeholder="Barclays"></label>
    <label>Kind<select name="kind"><option value="Asset">Asset</option><option value="Liability">Liability</option></select></label>
    <label>Current value<input name="value" type="number" step="0.01" required></label>
    <label>Currency<select name="currency">${currencyOptions()}</select></label>
    <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Add account</button></div>
  </form>`, async (data) => {
    const name = String(data.name || '').trim();
    if (!name) { showToast('Give the account a name'); return false; }
    await saveRecord('netWorthEntries', { id: id(), name, institution: data.institution || '', kind: data.kind || 'Asset', value: decimal(data.value), currencyCode: data.currency });
    showToast('Account added');
  }); }
  // Mirrors the iOS AddHoldingView: creates a named fund or investment account.
  function portfolioModal() { openModal('Add holding', `<form>
    <label>Name<input name="name" placeholder="Fund 1" required></label>
    <label>Symbol<input name="symbol" placeholder="VUSA"></label>
    <label>Asset type<input name="type" placeholder="ETF"></label>
    <label>Quantity<input name="quantity" type="number" step="0.0001" required></label>
    <label>Unit price<input name="price" type="number" step="0.01" required></label>
    <label>Currency<select name="currency">${currencyOptions()}</select></label>
    <label>Anticipated annual growth %<input name="growth" type="number" step="0.1" value="5"></label>
    <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Add holding</button></div>
  </form>`, async (data) => {
    const name = String(data.name || '').trim();
    if (!name) { showToast('Give the holding a name'); return false; }
    await saveRecord('holdings', { id: id(), name, symbol: data.symbol || '', type: data.type || '', quantity: decimal(data.quantity), price: decimal(data.price), currencyCode: data.currency });
    await saveSetting('portfolioGrowth', number(data.growth) / 100);
    showToast('Holding added');
  }); }
  // Mirrors the iOS AddPensionView: creates a named pension pot.
  function pensionModal() { openModal('Add pension pot', `<form>
    <label>Pot name<input name="name" placeholder="Pension 1" required></label>
    <label>Provider<input name="provider" placeholder="Provider"></label>
    <label>Current value<input name="value" type="number" step="0.01" required></label>
    <label>Currency<select name="currency">${currencyOptions()}</select></label>
    <label>Anticipated annual growth %<input name="growth" type="number" step="0.1" value="5"></label>
    <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Add pension pot</button></div>
  </form>`, async (data) => {
    const name = String(data.name || '').trim();
    if (!name) { showToast('Give the pot a name'); return false; }
    await saveRecord('pensions', { id: id(), name, provider: data.provider || '', value: decimal(data.value), currencyCode: data.currency });
    await saveSetting('pensionGrowth', number(data.growth) / 100);
    showToast('Pension pot added');
  }); }
  function budgetModal() { openModal('Add monthly budget', `<form><label>Budget name<input name="name" placeholder="Essentials" required></label><label>Monthly limit<input name="limit" type="number" step="0.01" required></label><label>Already spent<input name="spent" type="number" step="0.01" value="0"></label><label>Currency<select name="currency">${currencyOptions()}</select></label><div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button">Save budget</button></div></form>`, async (data) => { await saveRecord('budgets', { id: id(), name: data.name, limit: decimal(data.limit), spent: decimal(data.spent), currency: data.currency }); showToast('Budget saved'); }); }

  function setupEvents() {
    $('#theme-toggle').onclick = () => setTheme(state.theme === 'dark' ? 'light' : 'dark');
    $$('.nav-item').forEach((button) => button.onclick = () => switchView(button.dataset.nav));
    $$('[data-action="open-cashflow"]').forEach((button) => button.onclick = () => switchView('cashflow'));
    $$('[data-action="open-position"]').forEach((button) => button.onclick = () => switchView('position'));
    $$('[data-action="open-budgets"]').forEach((button) => button.onclick = () => switchView('budgets'));
    const bind = (selector, handler) => { const el = $(selector); if (el) el.onclick = handler; };
    bind('[data-action="open-commitment-modal"]', () => commitmentModal());
    bind('[data-action="open-bill-modal"]', () => billModal());
    bind('[data-action="open-position-modal"]', positionModal);
    bind('[data-action="open-portfolio-modal"]', portfolioModal);
    bind('[data-action="open-pension-modal"]', pensionModal);
    bind('[data-action="open-budget-modal"]', budgetModal);
    bind('[data-action="open-cash-modal"]', addSpendModal);
    $('#cash-settings-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); await saveSetting('balance', decimal(data.balance)); await saveSetting('balanceCurrency', data.currency); await saveSetting('payday', data.payday); showToast('Runway settings saved'); render(); };
    // iOS-aligned stores: dated histories, not the legacy snapshots store.
    $('#position-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); const name = String(data.series || '').trim(); if (!name) { showToast('Give this account a name such as Barclays savings'); return false; } await saveRecord('netWorthHistory', { id: id(), series: name, date: data.date, value: decimal(data.value), currencyCode: data.currency }); showToast('Position snapshot saved'); return false; };
    $('#portfolio-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); const name = String(data.series || '').trim(); if (!name) { showToast('Give this fund a name such as Fund 1'); return false; } await saveRecord('portfolioHistory', { id: id(), series: name, date: data.date, value: decimal(data.value), currencyCode: data.currency }); await saveSetting('portfolioGrowth', number(data.growth) / 100); showToast('Portfolio data saved'); return false; };
    $('#pension-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); const name = String(data.series || '').trim(); if (!name) { showToast('Give this pot a name such as Pension 1'); return false; } await saveRecord('pensionHistory', { id: id(), series: name, date: data.date, value: decimal(data.value), currencyCode: data.currency }); await saveSetting('pensionGrowth', number(data.growth) / 100); showToast('Pension data saved'); return false; };
    const bindChange = (selector, handler) => { const el = $(selector); if (el) el.onchange = handler; };
    bindChange('#position-currency', renderPosition);
    bindChange('#portfolio-currency', renderPortfolio);
    bindChange('#pension-currency', renderPensions);
    bindChange('#dashboard-currency', renderDashboard);
    bindChange('#cashflow-currency', renderCashflow);
    document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-delete]');
    if (!button) return;
    const recordId = button.dataset.id;
    const store = button.dataset.delete;
    if (confirm('Delete this local record?')) {
      await deleteRecord(store, recordId);
      showToast('Record deleted');
    }
    return;
  });
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-edit]');
    if (!button) return;
    const recordId = button.dataset.id;
    const store = button.dataset.edit;
    if (!recordId) return;
    const list = state.data[store] || [];
    const match = list.find((item) => item.id === recordId);
    if (!match) return;
    if (store === 'commitments') return commitmentModal(match);
    if (store === 'bills') return billModal(match);
    if (store === 'transactions') return editSpendModal(match);
    if (store === 'netWorthEntries') return editNetWorthEntryModal(match);
    if (store === 'holdings') return editHoldingModal(match);
    if (store === 'pensions') return editPensionModal(match);
    if (store === 'netWorthHistory' || store === 'portfolioHistory' || store === 'pensionHistory') return editHistoryModal(match, store);
  });
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-update-entry]');
    if (!button) return;
    const match = (state.data[button.dataset.updateEntry] || []).find((item) => item.id === button.dataset.id);
    if (match) updateEntryModal(match, button.dataset.updateEntry);
  });

  function updateEntryModal(entry, store) {
    const labels = { netWorthEntries: 'net worth', holdings: 'unit price', pensions: 'pension value' };
    const subject = entry.name || entry.symbol || 'this entry';
    const cur = currencyOf(entry);
    openModal(`Update ${labels[store] || 'value'}`, `<form>
      <label>Name<input name="name" value="${escapeHtml(subject)}" disabled></label>
      <label>Date${dateInput()}</label>
      <label>${store === 'holdings' ? 'Unit price on this date' : 'Value on this date'}<input name="value" type="number" step="0.01" required></label>
      <p class="muted">Stored in ${cur}. A dated snapshot is recorded under ${escapeHtml(subject)}.</p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Update</button></div>
    </form>`, async (data) => {
      if (data.value === '' || Number.isNaN(Number(data.value))) { showToast('Enter a valid value'); return false; }
      const amount = decimal(data.value);
      const date = data.date || today();
      const series = entry.name || entry.symbol || subject;
      if (store === 'netWorthEntries') {
        entry.value = amount;
        await saveRecord('netWorthEntries', entry);
        await saveRecord('netWorthHistory', { id: id(), series, date, value: amount, currencyCode: cur });
      } else if (store === 'holdings') {
        entry.price = amount;
        await saveRecord('holdings', entry);
        await saveRecord('portfolioHistory', { id: id(), series, date, value: number(entry.quantity) * amount, currencyCode: cur });
      } else if (store === 'pensions') {
        entry.value = amount;
        await saveRecord('pensions', entry);
        await saveRecord('pensionHistory', { id: id(), series, date, value: amount, currencyCode: cur });
      }
      showToast('Value updated and snapshot recorded');
    });
  }

  function editNetWorthEntryModal(entry) {
    openModal('Edit account', `<form>
      <label>Name<input name="name" value="${escapeHtml(entry.name || '')}" placeholder="Barclays savings" required></label>
      <label>Institution<input name="institution" value="${escapeHtml(entry.institution || '')}"></label>
      <label>Kind<select name="kind"><option value="Asset" ${entry.kind !== 'Liability' ? 'selected' : ''}>Asset</option><option value="Liability" ${entry.kind === 'Liability' ? 'selected' : ''}>Liability</option></select></label>
      <label>Current value<input name="value" type="number" step="0.01" value="${entry.value ?? ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(currencyOf(entry))}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Save account</button></div>
    </form>`, async (data) => {
      const name = String(data.name || '').trim();
      if (!name) { showToast('Give the account a name'); return false; }
      await saveRecord('netWorthEntries', { ...entry, name, institution: data.institution || '', kind: data.kind, value: decimal(data.value), currencyCode: data.currency });
      showToast('Account updated');
    });
  }

  function editHoldingModal(holding) {
    openModal('Edit holding', `<form>
      <label>Name<input name="name" value="${escapeHtml(holding.name || '')}" placeholder="Fund 1" required></label>
      <label>Symbol<input name="symbol" value="${escapeHtml(holding.symbol || '')}"></label>
      <label>Asset type<input name="type" value="${escapeHtml(holding.type || '')}" placeholder="ETF"></label>
      <label>Quantity<input name="quantity" type="number" step="0.0001" value="${holding.quantity ?? ''}" required></label>
      <label>Unit price<input name="price" type="number" step="0.01" value="${holding.price ?? ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(currencyOf(holding))}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Save holding</button></div>
    </form>`, async (data) => {
      const name = String(data.name || '').trim();
      if (!name) { showToast('Give the holding a name'); return false; }
      await saveRecord('holdings', { ...holding, name, symbol: data.symbol || '', type: data.type || '', quantity: decimal(data.quantity), price: decimal(data.price), currencyCode: data.currency });
      showToast('Holding updated');
    });
  }

  function editPensionModal(pension) {
    openModal('Edit pension pot', `<form>
      <label>Pot name<input name="name" value="${escapeHtml(pension.name || '')}" placeholder="Pension 1" required></label>
      <label>Provider<input name="provider" value="${escapeHtml(pension.provider || '')}"></label>
      <label>Current value<input name="value" type="number" step="0.01" value="${pension.value ?? ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(currencyOf(pension))}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Save pension</button></div>
    </form>`, async (data) => {
      const name = String(data.name || '').trim();
      if (!name) { showToast('Give the pot a name'); return false; }
      await saveRecord('pensions', { ...pension, name, provider: data.provider || '', value: decimal(data.value), currencyCode: data.currency });
      showToast('Pension updated');
    });
  }

  function editHistoryModal(record, store) {
    const titles = { netWorthHistory: 'net worth', portfolioHistory: 'portfolio', pensionHistory: 'pension' };
    const names = (state.data[store] || []).map((r) => r.series).filter((v, i, a) => a.indexOf(v) === i);
    const seriesOptions = names.map((s) => `<option value="${escapeHtml(s)}" ${s === record.series ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('') || `<option value="${escapeHtml(record.series)}" selected>${escapeHtml(record.series)}</option>`;
    openModal(`Update ${titles[store]} snapshot`, `<form>
      <label>Series name<select name="series">${seriesOptions}</select></label>
      <label>Snapshot date${dateInput(record.date || '', 'date')}</label>
      <label>Value<input name="value" type="number" step="0.01" value="${record.value ?? ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(currencyOf(record))}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Update snapshot</button></div>
    </form>`, async (data) => {
      await saveRecord(store, { ...record, series: data.series, date: data.date, value: decimal(data.value), currencyCode: data.currency });
      showToast('Snapshot updated');
    });
  }
    $('#export-data').onclick = async () => { const backup = { format: 'financial-health-backup', version: 1, exportedAt: new Date().toISOString(), data: await loadData() }; const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `financial-health-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); $('#backup-status').textContent = 'Backup exported locally.'; };
    $('#import-data').onchange = async (event) => { const file = event.target.files[0]; if (!file || !confirm('Restore this backup? It will replace current local data.')) return; try { const backup = JSON.parse(await file.text()); if (backup.format !== 'financial-health-backup') throw new Error('Invalid backup'); for (const store of stores) await clearStore(store); for (const [store, values] of Object.entries(backup.data)) { if (store === 'settings') { for (const [key, value] of Object.entries(values)) await put('settings', { id: key, key, value }); } else if (stores.includes(store)) { for (const value of values) await put(store, value); } } state.data = await loadData(); render(); $('#backup-status').textContent = 'Backup restored locally.'; showToast('Backup restored'); } catch (error) { $('#backup-status').textContent = `Restore failed: ${error.message}`; } };
  }

  async function start() { setTheme(state.theme); populateCurrencies(); state.data = await loadData(); 
    // Populate dashboard currency dropdown
    const dashboardCurrencySelect = $('#dashboard-currency');
    if (dashboardCurrencySelect) {
      dashboardCurrencySelect.innerHTML = currencyOptions(state.data?.settings?.balanceCurrency || 'USD');
    }
    setupEvents(); render(); if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {}); window.addEventListener('resize', () => { renderDashboard(); renderCashflow(); renderPosition(); renderPortfolio(); renderPensions(); }); }
  start().catch((error) => { document.body.innerHTML = `<main class="panel" style="margin:24px"><h2>Local database unavailable</h2><p>${error.message}</p></main>`; });
})();
