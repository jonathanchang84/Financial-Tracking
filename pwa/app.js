(() => {
  'use strict';

  const DB_NAME = 'financial-health-local';
  const DB_VERSION = 1;
  const stores = ['settings', 'transactions', 'budgets', 'accounts', 'snapshots'];
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
  async function loadData() { const entries = await Promise.all(stores.map(async (store) => [store, await all(store)])); const result = Object.fromEntries(entries); result.settings = Object.fromEntries(result.settings.map((item) => [item.key, item.value])); return result; }
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
  function openModal(title, content, onSubmit) { const root = $('#modal-root'); root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${title}"><div class="section-heading"><div><p class="eyebrow">LOCAL ENTRY</p><h3>${title}</h3></div><button class="text-button" data-close-modal>Close</button></div>${content}</section></div>`; $('[data-close-modal]', root).onclick = closeModal; $('.modal-backdrop', root).onclick = (event) => { if (event.target === event.currentTarget) closeModal(); }; const form = $('form', root); if (form) form.onsubmit = async (event) => { event.preventDefault(); await onSubmit(formData(form)); closeModal(); }; }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  function currencyOptions(selected = 'USD') { return Object.entries(currencies).map(([code, name]) => `<option value="${code}" ${selected === code ? 'selected' : ''}>${code} · ${name}</option>`).join(''); }
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

  function currentTotals() { const totals = {}; state.data.accounts.forEach((item) => { totals[item.currency] = (totals[item.currency] || 0) + (item.kind === 'liability' ? -number(item.value) : number(item.value)); }); return totals; }
  function snapshotSeries(storeName, currency, key = null) { return state.data.snapshots.filter((item) => item.type === storeName && item.currency === currency && (!key || item.series === key)).sort((a, b) => a.date.localeCompare(b.date)); }
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
    const form = $('#cash-settings-form'); const settings = state.data.settings; form.balance.value = settings.balance ?? ''; form.currency.value = settings.balanceCurrency || 'USD'; form.payday.value = settings.payday || today(); $('#cash-range').textContent = settings.payday ? `Through ${dateLabel(settings.payday)}` : 'Set your next payday';
    
    const displayCurrency = $('#cashflow-currency').value || settings.balanceCurrency || 'USD';
    const start = new Date(); const end = new Date(`${settings.payday || today()}T12:00:00`); const days = Math.max(1, Math.ceil((end - start) / 86400000)); const balance = number(settings.balance); const daily = balance / days; let running = balance; let cumulative = 0;
    
    // Build table rows instead of chart
    const rows = monthlyDates(today(), settings.payday || today()).slice(0, 45).map((date, index) => {
      const key = date.toISOString().slice(0, 10);
      const spend = state.data.transactions.filter((item) => item.type === 'expense' && item.date === key && item.currency === (settings.balanceCurrency || 'USD')).reduce((sum, item) => sum + number(item.amount), 0);
      cumulative += spend;
      running -= daily + spend;
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const runningInDisplay = convertCurrency(running, settings.balanceCurrency || 'USD', displayCurrency);
      const cumulativeInDisplay = convertCurrency(cumulative, settings.balanceCurrency || 'USD', displayCurrency);
      const targetInDisplay = convertCurrency(daily * (index + 1), settings.balanceCurrency || 'USD', displayCurrency);
      return { label, value: running, valueInDisplay: runningInDisplay, cumulative: cumulativeInDisplay, target: targetInDisplay };
    });
    
    $('#cashflow-table').innerHTML = rows.map((row, index) => `
      <div class="stack-row">
        <span><strong>Day ${index + 1}</strong><small>${row.label}</small></span>
        <span><strong>${money(row.valueInDisplay, displayCurrency)}</strong><small>Balance</small></span>
        <span>${money(row.target, displayCurrency)}<small>Safe target</small></span>
        <span>${money(row.cumulative, displayCurrency)}<small>Spend</small></span>
      </div>
    `).join('') || '<p class="muted">Set your balance and payday to see the daily runway.</p>';
    
    $('#spend-list').innerHTML = state.data.transactions.filter((item) => item.type === 'expense').sort((a, b) => b.date.localeCompare(a.date)).map((item) => {
      const amountInDisplay = convertCurrency(number(item.amount), item.currency, displayCurrency);
      return `<div class="stack-row"><span><strong>${item.category || 'Spend'}</strong><small>${dateLabel(item.date)}</small></span><span><strong>${money(amountInDisplay, displayCurrency)}</strong><button class="text-button" data-delete="transactions" data-id="${item.id}">Delete</button></span></div>`;
    }).join('') || '<p class="muted">No daily spend recorded yet.</p>';
  }

  function renderPosition() {
    const select = $('#position-currency');
    const currenciesUsed = [...new Set(state.data.snapshots.filter((item) => item.type === 'networth').map((item) => item.currency))];
    const displayCurrency = currenciesUsed.includes(select.value) ? select.value : (currenciesUsed[0] || 'USD');
    select.value = displayCurrency;
    const points = snapshotSeries('networth', displayCurrency);
    $('#position-growth').textContent = monthGrowth(points);
    const totals = currentTotals();
    $('#position-totals').innerHTML = Object.entries(totals)
      .map(([currency, value]) => {
        const converted = convertCurrency(value, currency, displayCurrency);
        return `<div class="stack-row"><span><strong>${currency}</strong><small>Net position (converted to ${displayCurrency})</small></span><strong>${money(converted, displayCurrency)}</strong></div>`;
      })
      .join('') || '<p class="muted">No current position recorded.</p>';
    $('#position-history').innerHTML = points
      .map((p) => {
        const converted = convertCurrency(p.value, p.currency, displayCurrency);
        return `<div class="stack-row"><span><strong>${money(converted, displayCurrency)}</strong><small>${dateLabel(p.date)} · ${p.series} · original: ${money(p.value, p.currency)} ${p.currency}</small></span><span><button class="text-button" data-edit="snapshots" data-id="${p.id}">Update</button> <button class="text-button" data-delete="snapshots" data-id="${p.id}">Delete</button></span></div>`;
      })
      .join('') || '<p class="muted">No position values recorded yet.</p>';
  }
  function renderPortfolio() {
    const select = $('#portfolio-currency');
    const currenciesUsed = [...new Set(state.data.snapshots.filter((item) => item.type === 'portfolio').map((item) => item.currency))];
    const displayCurrency = currenciesUsed.includes(select.value) ? select.value : (currenciesUsed[0] || 'USD');
    select.value = displayCurrency;
    const points = snapshotSeries('portfolio', displayCurrency);
    $('#portfolio-growth').textContent = monthGrowth(points);
    $('#portfolio-history').innerHTML = `<div class="section-heading"><div><p class="eyebrow">SNAPSHOTS</p><h3>Actual recorded values</h3></div></div>` + points
      .map((p) => {
        const converted = convertCurrency(p.value, p.currency, displayCurrency);
        return `<div class="stack-row"><span><strong>${money(converted, displayCurrency)}</strong><small>${dateLabel(p.date)} · ${p.series} · original: ${money(p.value, p.currency)} ${p.currency}</small></span><span><button class="text-button" data-edit="snapshots" data-id="${p.id}">Update</button> <button class="text-button" data-delete="snapshots" data-id="${p.id}">Delete</button></span></div>`;
      })
      .join('') || '<p class="muted">No portfolio values recorded yet.</p>';
  }
  function renderPensions() {
    const select = $('#pension-currency');
    const currenciesUsed = [...new Set(state.data.snapshots.filter((item) => item.type === 'pension').map((item) => item.currency))];
    const displayCurrency = currenciesUsed.includes(select.value) ? select.value : (currenciesUsed[0] || 'USD');
    select.value = displayCurrency;
    const points = snapshotSeries('pension', displayCurrency);
    $('#pension-growth').textContent = monthGrowth(points);
    $('#pension-history').innerHTML = `<div class="section-heading"><div><p class="eyebrow">SNAPSHOTS</p><h3>Actual recorded values</h3></div></div>` + points
      .map((p) => {
        const converted = convertCurrency(p.value, p.currency, displayCurrency);
        return `<div class="stack-row"><span><strong>${money(converted, displayCurrency)}</strong><small>${dateLabel(p.date)} · ${p.series} · original: ${money(p.value, p.currency)} ${p.currency}</small></span><span><button class="text-button" data-edit="snapshots" data-id="${p.id}">Update</button> <button class="text-button" data-delete="snapshots" data-id="${p.id}">Delete</button></span></div>`;
      })
      .join('') || '<p class="muted">No pension values recorded yet.</p>';
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
  function positionModal() { openModal('Add historical net worth', `<form><label>Snapshot date${dateInput()}</label><label>Net worth value<input name="value" type="number" step="0.01" required></label><label>Currency<select name="currency">${currencyOptions()}</select></label><div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button">Save snapshot</button></div></form>`, async (data) => { await saveRecord('snapshots', { id: id(), type: 'networth', series: 'Net worth', date: data.date, value: decimal(data.value), currency: data.currency }); showToast('Historical snapshot saved'); }); }
  function portfolioModal() { openModal('Add portfolio value', `<form><label>Snapshot date${dateInput()}</label><label>Series name<input name="series" value="Portfolio" required></label><label>Portfolio value<input name="value" type="number" step="0.01" required></label><label>Currency<select name="currency">${currencyOptions()}</select></label><label>Anticipated annual growth %<input name="growth" type="number" step="0.1" value="5"></label><div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button">Save value</button></div></form>`, async (data) => { await saveRecord('snapshots', { id: id(), type: 'portfolio', series: data.series, date: data.date, value: decimal(data.value), currency: data.currency }); await saveSetting('portfolioGrowth', number(data.growth) / 100); showToast('Portfolio value saved'); }); }
  function pensionModal() { openModal('Add pension value', `<form><label>Snapshot date${dateInput()}</label><label>Series name<input name="series" value="Pension" required></label><label>Pension value<input name="value" type="number" step="0.01" required></label><label>Currency<select name="currency">${currencyOptions()}</select></label><label>Anticipated annual growth %<input name="growth" type="number" step="0.1" value="5"></label><div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button">Save value</button></div></form>`, async (data) => { await saveRecord('snapshots', { id: id(), type: 'pension', series: data.series, date: data.date, value: decimal(data.value), currency: data.currency }); await saveSetting('pensionGrowth', number(data.growth) / 100); showToast('Pension value saved'); }); }
  function budgetModal() { openModal('Add monthly budget', `<form><label>Budget name<input name="name" placeholder="Essentials" required></label><label>Monthly limit<input name="limit" type="number" step="0.01" required></label><label>Already spent<input name="spent" type="number" step="0.01" value="0"></label><label>Currency<select name="currency">${currencyOptions()}</select></label><div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button">Save budget</button></div></form>`, async (data) => { await saveRecord('budgets', { id: id(), name: data.name, limit: decimal(data.limit), spent: decimal(data.spent), currency: data.currency }); showToast('Budget saved'); }); }

  function setupEvents() {
    $('#theme-toggle').onclick = () => setTheme(state.theme === 'dark' ? 'light' : 'dark');
    $$('.nav-item').forEach((button) => button.onclick = () => switchView(button.dataset.nav));
    $$('[data-action="open-cashflow"]').forEach((button) => button.onclick = () => switchView('cashflow'));
    $$('[data-action="open-position"]').forEach((button) => button.onclick = () => switchView('position'));
    $$('[data-action="open-budgets"]').forEach((button) => button.onclick = () => switchView('budgets'));
    $('[data-action="open-cash-modal"]').onclick = addSpendModal; $('[data-action="open-position-modal"]').onclick = positionModal; $('[data-action="open-portfolio-modal"]').onclick = portfolioModal; $('[data-action="open-pension-modal"]').onclick = pensionModal; $('[data-action="open-budget-modal"]').onclick = budgetModal;
    $('#cash-settings-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); await saveSetting('balance', decimal(data.balance)); await saveSetting('balanceCurrency', data.currency); await saveSetting('payday', data.payday); showToast('Runway settings saved'); render(); };
    $('#position-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); await saveRecord('snapshots', { id: id(), type: 'networth', series: 'Net worth', date: data.date, value: decimal(data.value), currency: data.currency }); showToast('Net-worth snapshot saved'); };
    $('#portfolio-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); await saveRecord('snapshots', { id: id(), type: 'portfolio', series: 'Portfolio', date: data.date, value: decimal(data.value), currency: data.currency }); await saveSetting('portfolioGrowth', number(data.growth) / 100); showToast('Portfolio data saved'); };
    $('#pension-form').onsubmit = async (event) => { event.preventDefault(); const data = formData(event.target); await saveRecord('snapshots', { id: id(), type: 'pension', series: 'Pension', date: data.date, value: decimal(data.value), currency: data.currency }); await saveSetting('pensionGrowth', number(data.growth) / 100); showToast('Pension data saved'); };
    $('#position-currency').onchange = renderPosition; $('#portfolio-currency').onchange = renderPortfolio; $('#pension-currency').onchange = renderPensions;
    $('#dashboard-currency').onchange = renderDashboard;
    $('#cashflow-currency').onchange = renderCashflow;
    $('#spend-currency').onchange = renderCashflow;
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
    if (store === 'snapshots' && recordId) {
      const match = state.data.snapshots.find((item) => item.id === recordId);
      if (match) editSnapshotModal(match, match.type);
    }
  });

  function editSnapshotModal(snapshot, type) {
    const existingSeries = state.data.snapshots
      .filter((s) => s.type === type)
      .map((s) => s.series)
      .filter((v, i, a) => a.indexOf(v) === i);
    const seriesOptions = existingSeries.map((s) => `<option value="${s}">${s}</option>`).join('');
    openModal(`Update ${type === 'networth' ? 'net worth' : type === 'portfolio' ? 'portfolio' : 'pension'} snapshot`, `<form>
      <label>Series name<select name="series">${seriesOptions}</select></label>
      <label>Snapshot date${dateInput(snapshot?.date || '', 'date')}</label>
      <label>Value<input name="value" type="number" step="0.01" value="${snapshot?.value || ''}" required></label>
      <label>Currency<select name="currency">${currencyOptions(snapshot?.currency || 'USD')}</select></label>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Update snapshot</button></div>
    </form>`, async (data) => {
      await saveRecord('snapshots', { id: snapshot.id, type, series: data.series, date: data.date, value: decimal(data.value), currency: data.currency });
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
