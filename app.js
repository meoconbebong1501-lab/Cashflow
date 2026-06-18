// ============================================================
// SỔ CHI — app.js
// Lưu ý quan trọng về timezone: KHÔNG dùng Date.toISOString() để
// lấy ngày, vì nó quy đổi về UTC và có thể lệch 1 ngày với giờ
// Việt Nam (UTC+7) — đây là lỗi đã từng gặp ở TaskFlow. Toàn bộ
// app này dùng toLocalISO() lấy năm/tháng/ngày theo giờ máy người
// dùng (giả định máy đặt giờ Việt Nam).
// ============================================================

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------- State ----------------
const state = {
  user: null,
  categories: [],
  recurringTemplates: [],
  transactions: [],
  budgets: [],
  currentMonth: startOfMonth(new Date()),
  addType: 'expense',
  recurAddType: 'expense',
};

// ---------------- Date helpers ----------------
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function isSameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }

function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayLocalISO() { return toLocalISO(new Date()); }
function monthLabel(d) { return `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`; }
function formatDateVN(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------- Format helpers ----------------
function formatVND(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('vi-VN') + ' ₫';
}
function formatVNDSigned(n, type) {
  const sign = type === 'income' ? '+' : '-';
  return sign + formatVND(Math.abs(Number(n) || 0));
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// ---------------- Toast ----------------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------------- Auth ----------------
let authMode = 'login'; // 'login' | 'signup'

document.getElementById('auth-switch-btn').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('auth-submit').textContent = authMode === 'login' ? 'Đăng nhập' : 'Đăng ký';
  document.getElementById('auth-switch-text').textContent = authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
  document.getElementById('auth-switch-btn').textContent = authMode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập';
  document.getElementById('auth-error').classList.add('hidden');
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  const submitBtn = document.getElementById('auth-submit');
  submitBtn.disabled = true;

  try {
    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      showToast('Đăng ký thành công! Nếu cần xác nhận email, hãy kiểm tra hộp thư.');
    }
  } catch (err) {
    errEl.textContent = translateAuthError(err.message);
    errEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

function translateAuthError(msg) {
  if (!msg) return 'Có lỗi xảy ra, vui lòng thử lại.';
  if (msg.includes('Invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (msg.includes('User already registered')) return 'Email này đã được đăng ký.';
  if (msg.includes('Password should be at least')) return 'Mật khẩu cần ít nhất 6 ký tự.';
  if (msg.toLowerCase().includes('rate limit')) return 'Bạn thử quá nhiều lần, vui lòng đợi một chút.';
  return msg;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    state.user = session.user;
    showAppShell();
  } else {
    state.user = null;
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

async function showAppShell() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  await loadAllData();
}

// ---------------- Tabs ----------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

function setActiveTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
}

// ---------------- Month switcher ----------------
document.getElementById('month-prev').addEventListener('click', () => changeMonth(-1));
document.getElementById('month-next').addEventListener('click', () => changeMonth(1));

function changeMonth(delta) {
  const d = state.currentMonth;
  state.currentMonth = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  loadAllData();
}
function renderMonthLabel() {
  document.getElementById('month-label').textContent = monthLabel(state.currentMonth);
}

// ---------------- Data loading ----------------
async function loadAllData() {
  renderMonthLabel();
  await Promise.all([loadCategories(), loadRecurringTemplates(), loadBudgets()]);
  await loadTransactionsForMonth();
  renderAll();
}

async function loadCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name');
  if (error) { console.error(error); showToast('Không tải được danh mục.'); return; }
  state.categories = data || [];
}

async function loadRecurringTemplates() {
  const { data, error } = await supabase.from('recurring_templates').select('*').order('day_of_month');
  if (error) { console.error(error); return; }
  state.recurringTemplates = data || [];
}

async function loadBudgets() {
  const { data, error } = await supabase.from('budgets').select('*');
  if (error) { console.error(error); return; }
  state.budgets = data || [];
}

async function loadTransactionsForMonth() {
  const from = toLocalISO(startOfMonth(state.currentMonth));
  const to = toLocalISO(endOfMonth(state.currentMonth));
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .gte('occurred_on', from)
    .lte('occurred_on', to)
    .order('occurred_on', { ascending: false });
  if (error) { console.error(error); showToast('Không tải được giao dịch.'); return; }
  state.transactions = data || [];
}

async function loadPastMonthsExpenseTotals(monthsBack) {
  const endMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
  const startMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - monthsBack, 1);
  const from = toLocalISO(startMonth);
  const to = toLocalISO(endOfMonth(endMonth));
  if (endMonth < startMonth) return {};

  const { data, error } = await supabase
    .from('transactions')
    .select('category_id, amount')
    .eq('type', 'expense')
    .gte('occurred_on', from)
    .lte('occurred_on', to);
  if (error) { console.error(error); return {}; }

  const byCat = {};
  (data || []).forEach((t) => {
    if (!t.category_id) return;
    byCat[t.category_id] = (byCat[t.category_id] || 0) + Number(t.amount);
  });
  const result = {};
  Object.keys(byCat).forEach((catId) => { result[catId] = byCat[catId] / monthsBack; });
  return result;
}

// ---------------- Render dispatch ----------------
function renderAll() {
  renderDashboard();
  renderTransactionsTab();
  renderRecurringTab();
  renderBudgetsTab();
  populateCategorySelects();
}

// ---------------- Category lookup helpers ----------------
function getCategory(id) { return state.categories.find((c) => c.id === id); }
function categoryName(id) { const c = getCategory(id); return c ? c.name : 'Không phân loại'; }
function categoryColor(id) { const c = getCategory(id); return c ? c.color : '#8D99AE'; }

// ---------------- Dashboard ----------------
async function renderDashboard() {
  const income = state.transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = state.transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const balance = income - expense;

  document.getElementById('sum-income').textContent = formatVND(income);
  document.getElementById('sum-expense').textContent = formatVND(expense);
  const balEl = document.getElementById('sum-balance');
  balEl.textContent = (balance < 0 ? '-' : '') + formatVND(Math.abs(balance));
  balEl.classList.toggle('negative', balance < 0);

  renderCategoryBars(expense);
  await renderSavingsTips(income, expense);
  renderDashboardFixedList();
}

function renderCategoryBars(totalExpense) {
  const el = document.getElementById('category-bars');
  const byCat = {};
  state.transactions.filter((t) => t.type === 'expense').forEach((t) => {
    const key = t.category_id || 'none';
    byCat[key] = (byCat[key] || 0) + Number(t.amount);
  });
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  if (rows.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="glyph">▣</div><p>Chưa có chi tiêu nào tháng này.</p></div>';
    return;
  }

  const max = rows[0][1];
  el.innerHTML = rows.map(([catId, amount]) => {
    const pct = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
    const widthPct = max > 0 ? Math.max(4, Math.round((amount / max) * 100)) : 0;
    const color = catId === 'none' ? '#8D99AE' : categoryColor(catId);
    const name = catId === 'none' ? 'Không phân loại' : categoryName(catId);
    return `
      <div class="cat-bar-row">
        <div class="cat-bar-top">
          <span class="cat-bar-name"><span class="cat-dot" style="background:${color}"></span>${escapeHtml(name)}</span>
          <span class="cat-bar-amount">${formatVND(amount)} · ${pct}%</span>
        </div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${widthPct}%; background:${color}"></div></div>
      </div>`;
  }).join('');
}

async function renderSavingsTips(income, expense) {
  const el = document.getElementById('savings-tips');
  const avgByCat = await loadPastMonthsExpenseTotals(3);

  const byCatThisMonth = {};
  state.transactions.filter((t) => t.type === 'expense' && t.category_id).forEach((t) => {
    byCatThisMonth[t.category_id] = (byCatThisMonth[t.category_id] || 0) + Number(t.amount);
  });

  const isCurrentRealMonth = isSameMonth(state.currentMonth, new Date());
  const dayProgress = isCurrentRealMonth ? new Date().getDate() / daysInMonth(state.currentMonth) : 1;

  const tips = [];

  Object.keys(byCatThisMonth).forEach((catId) => {
    const avg = avgByCat[catId];
    if (!avg || avg <= 0) return;
    const projected = isCurrentRealMonth ? byCatThisMonth[catId] / Math.max(dayProgress, 0.05) : byCatThisMonth[catId];
    const diffPct = Math.round(((projected - avg) / avg) * 100);
    if (diffPct >= 15) {
      tips.push({
        level: 'warn',
        text: `${categoryName(catId)} đang chi nhiều hơn khoảng ${diffPct}% so với trung bình 3 tháng trước${isCurrentRealMonth ? ' (ước tính cho cả tháng)' : ''}.`,
      });
    }
  });

  state.budgets.forEach((b) => {
    const limit = Number(b.monthly_limit);
    if (!(limit > 0)) return;
    const spent = byCatThisMonth[b.category_id] || 0;
    if (spent > limit) {
      tips.push({ level: 'danger', text: `${categoryName(b.category_id)} đã vượt ngân sách (${formatVND(spent)} / ${formatVND(limit)}).` });
    }
  });

  if (income > 0 && expense > income) {
    tips.push({ level: 'danger', text: `Tháng này chi nhiều hơn thu ${formatVND(expense - income)}. Cân nhắc giảm các khoản không cố định.` });
  } else if (income > 0 && expense >= 0) {
    const savingRate = Math.round(((income - expense) / income) * 100);
    tips.push({ level: 'ok', text: `Bạn đang để dành được khoảng ${savingRate}% thu nhập tháng này.` });
  }

  if (tips.length === 0) {
    el.innerHTML = '<p class="tip-empty">Chưa đủ dữ liệu để đưa ra gợi ý — cứ tiếp tục ghi chép, sau vài tháng app sẽ so sánh được xu hướng chi tiêu của bạn.</p>';
    return;
  }

  const marks = { warn: '⚠️', danger: '❗', ok: '✓' };
  el.innerHTML = tips.map((t) => `<div class="tip-row"><span class="tip-mark">${marks[t.level]}</span><span>${escapeHtml(t.text)}</span></div>`).join('');
}

function renderDashboardFixedList() {
  const el = document.getElementById('dashboard-fixed-list');
  const active = state.recurringTemplates.filter((r) => r.is_active);
  if (active.length === 0) {
    el.innerHTML = '<p class="tip-empty">Chưa có chi phí cố định nào. Thêm ở tab "Cố định".</p>';
    document.getElementById('fixed-due-hint').textContent = '';
    return;
  }
  const paidCount = active.filter((r) => isRecurringPaidThisMonth(r.id)).length;
  document.getElementById('fixed-due-hint').textContent = `${paidCount}/${active.length} đã thanh toán`;
  el.innerHTML = active.map((r) => recurringRowHtml(r)).join('');
  el.querySelectorAll('[data-mark-paid]').forEach((btn) => {
    btn.addEventListener('click', () => markRecurringPaid(btn.dataset.markPaid));
  });
}

// ---------------- Transactions tab ----------------
function renderTransactionsTab() {
  const el = document.getElementById('transactions-list');
  if (state.transactions.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="glyph">≡</div><p>Chưa có giao dịch nào trong tháng này.</p><p>Bấm nút + để thêm.</p></div>';
    return;
  }
  const byDate = {};
  state.transactions.forEach((t) => {
    byDate[t.occurred_on] = byDate[t.occurred_on] || [];
    byDate[t.occurred_on].push(t);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  el.innerHTML = dates.map((date) => `
    <div class="ledger-day-label">${formatDateVN(date)}</div>
    ${byDate[date].map((t) => `
      <div class="ledger-row">
        <span class="ledger-cat-dot" style="background:${categoryColor(t.category_id)}"></span>
        <div class="ledger-main">
          <div class="ledger-cat-name">${escapeHtml(categoryName(t.category_id))}</div>
          ${t.note ? `<div class="ledger-note">${escapeHtml(t.note)}</div>` : ''}
        </div>
        <div class="ledger-amount ${t.type}">${formatVNDSigned(t.amount, t.type)}</div>
        <button type="button" class="ledger-del" data-del-tx="${t.id}" aria-label="Xóa">✕</button>
      </div>`).join('')}
  `).join('');

  el.querySelectorAll('[data-del-tx]').forEach((btn) => {
    btn.addEventListener('click', () => deleteTransaction(btn.dataset.delTx));
  });
}

async function deleteTransaction(id) {
  if (!confirm('Xóa giao dịch này?')) return;
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) { console.error(error); showToast('Không xóa được, thử lại sau.'); return; }
  await loadTransactionsForMonth();
  renderAll();
  showToast('Đã xóa giao dịch.');
}

// ---------------- Recurring (chi phí cố định) ----------------
function isRecurringPaidThisMonth(templateId) {
  return state.transactions.some((t) => t.recurring_template_id === templateId);
}

function recurringStatus(r) {
  if (isRecurringPaidThisMonth(r.id)) return 'paid';
  if (!isSameMonth(state.currentMonth, new Date())) return 'due';
  return new Date().getDate() > r.day_of_month ? 'overdue' : 'due';
}

function recurringRowHtml(r) {
  const status = recurringStatus(r);
  const chip = {
    paid: '<span class="status-chip status-paid">Đã trả</span>',
    due: '<span class="status-chip status-due">Sắp tới hạn</span>',
    overdue: '<span class="status-chip status-overdue">Quá hạn</span>',
  }[status];
  const action = status === 'paid' ? '' : `<button type="button" class="recur-action-btn" data-mark-paid="${r.id}">Đã trả</button>`;
  return `
    <div class="recur-row">
      <span class="ledger-cat-dot" style="background:${categoryColor(r.category_id)}"></span>
      <div class="recur-main">
        <div class="recur-name">${escapeHtml(r.name)}</div>
        <div class="recur-meta">Hạn ngày ${r.day_of_month} · ${escapeHtml(categoryName(r.category_id))}</div>
        <div class="recur-amount">${formatVND(r.amount)}</div>
      </div>
      ${chip}
      ${action}
    </div>`;
}

function renderRecurringTab() {
  const el = document.getElementById('recurring-list');
  if (state.recurringTemplates.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="glyph">↻</div><p>Chưa có chi phí cố định nào.</p><p>Thêm tiền nhà, internet, trả góp... để app nhắc bạn mỗi tháng.</p></div>';
    return;
  }
  el.innerHTML = state.recurringTemplates.map((r) => recurringRowHtml(r)).join('');
  el.querySelectorAll('[data-mark-paid]').forEach((btn) => {
    btn.addEventListener('click', () => markRecurringPaid(btn.dataset.markPaid));
  });
}

async function markRecurringPaid(templateId) {
  const r = state.recurringTemplates.find((x) => x.id === templateId);
  if (!r) return;
  if (isRecurringPaidThisMonth(templateId)) { showToast('Khoản này đã được ghi nhận rồi.'); return; }

  const day = Math.min(r.day_of_month, daysInMonth(state.currentMonth));
  const date = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth(), day);

  const { error } = await supabase.from('transactions').insert({
    user_id: state.user.id,
    category_id: r.category_id,
    recurring_template_id: r.id,
    type: r.type,
    amount: r.amount,
    occurred_on: toLocalISO(date),
    note: r.name,
  });
  if (error) { console.error(error); showToast('Không ghi nhận được, thử lại sau.'); return; }
  await loadTransactionsForMonth();
  renderAll();
  showToast(`Đã ghi nhận "${r.name}".`);
}

document.getElementById('add-recurring-btn').addEventListener('click', () => {
  document.getElementById('recurring-form').reset();
  setRecurType('expense');
  openModal('modal-recurring');
});

function setRecurType(type) {
  state.recurAddType = type;
  document.querySelectorAll('.rtype-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  populateCategorySelects();
}
document.querySelectorAll('.rtype-btn').forEach((b) => b.addEventListener('click', () => setRecurType(b.dataset.type)));

document.getElementById('recurring-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('recur-name').value.trim();
  const amount = Number(document.getElementById('recur-amount').value);
  const category_id = document.getElementById('recur-category').value;
  const day_of_month = Number(document.getElementById('recur-day').value);

  if (!name || !(amount >= 0) || !category_id || !(day_of_month >= 1 && day_of_month <= 31)) {
    showToast('Vui lòng kiểm tra lại thông tin.');
    return;
  }

  const { error } = await supabase.from('recurring_templates').insert({
    user_id: state.user.id,
    name,
    amount,
    category_id,
    type: state.recurAddType,
    day_of_month,
    is_active: true,
  });
  if (error) { console.error(error); showToast('Không lưu được, thử lại sau.'); return; }
  closeModal('modal-recurring');
  await loadRecurringTemplates();
  renderAll();
  showToast('Đã thêm chi phí cố định.');
});

// ---------------- Budgets tab ----------------
function renderBudgetsTab() {
  const el = document.getElementById('budgets-list');
  const expenseCats = state.categories.filter((c) => c.type === 'expense');
  if (expenseCats.length === 0) {
    el.innerHTML = '<p class="tip-empty">Chưa có danh mục chi tiêu.</p>';
    return;
  }

  const spentByCat = {};
  state.transactions.filter((t) => t.type === 'expense' && t.category_id).forEach((t) => {
    spentByCat[t.category_id] = (spentByCat[t.category_id] || 0) + Number(t.amount);
  });

  el.innerHTML = expenseCats.map((c) => {
    const budget = state.budgets.find((b) => b.category_id === c.id);
    const limit = budget ? Number(budget.monthly_limit) : 0;
    const spent = spentByCat[c.id] || 0;
    const over = limit > 0 && spent > limit;
    return `
      <div class="budget-row">
        <div class="budget-top">
          <span class="budget-cat-name"><span class="cat-dot" style="background:${c.color}; display:inline-block; margin-right:6px;"></span>${escapeHtml(c.name)}</span>
          <span class="budget-spent">${formatVND(spent)}${limit > 0 ? ' / ' + formatVND(limit) : ''}</span>
        </div>
        ${limit > 0 ? `<div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.min(100, Math.round((spent / limit) * 100))}%; background:${over ? 'var(--red-lacquer)' : c.color}"></div></div>` : ''}
        ${over ? `<div class="budget-over-text">Đã vượt ${formatVND(spent - limit)}</div>` : ''}
        <div class="budget-input-row">
          <input type="number" min="0" step="10000" placeholder="Đặt hạn mức/tháng" value="${limit > 0 ? limit : ''}" data-budget-input="${c.id}">
          <button type="button" class="recur-action-btn" data-save-budget="${c.id}">Lưu</button>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('[data-save-budget]').forEach((btn) => {
    btn.addEventListener('click', () => saveBudget(btn.dataset.saveBudget));
  });
}

async function saveBudget(categoryId) {
  const input = document.querySelector(`[data-budget-input="${categoryId}"]`);
  const value = Number(input.value);
  if (!(value >= 0)) { showToast('Hạn mức không hợp lệ.'); return; }

  const existing = state.budgets.find((b) => b.category_id === categoryId);
  let error;
  if (existing) {
    ({ error } = await supabase.from('budgets').update({ monthly_limit: value }).eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('budgets').insert({ user_id: state.user.id, category_id: categoryId, monthly_limit: value }));
  }
  if (error) { console.error(error); showToast('Không lưu được ngân sách.'); return; }
  await loadBudgets();
  renderAll();
  showToast('Đã lưu ngân sách.');
}

// ---------------- Quick add modal ----------------
document.getElementById('fab-add').addEventListener('click', () => {
  document.getElementById('add-form').reset();
  setAddType('expense');
  document.getElementById('add-date').value = todayLocalISO();
  openModal('modal-add');
});

function setAddType(type) {
  state.addType = type;
  document.querySelectorAll('.type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  populateCategorySelects();
}
document.querySelectorAll('.type-btn').forEach((b) => b.addEventListener('click', () => setAddType(b.dataset.type)));

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = Number(document.getElementById('add-amount').value);
  const category_id = document.getElementById('add-category').value;
  const occurred_on = document.getElementById('add-date').value;
  const note = document.getElementById('add-note').value.trim();

  if (!(amount > 0) || !category_id || !occurred_on) {
    showToast('Vui lòng nhập đủ thông tin.');
    return;
  }

  const { error } = await supabase.from('transactions').insert({
    user_id: state.user.id,
    category_id,
    type: state.addType,
    amount,
    occurred_on,
    note: note || null,
  });
  if (error) { console.error(error); showToast('Không lưu được, thử lại sau.'); return; }
  closeModal('modal-add');

  // occurred_on là chuỗi 'YYYY-MM-DD' thuần từ <input type="date">, không qua quy đổi UTC.
  // Thêm 'T00:00:00' khi parse để JS hiểu là giờ địa phương, không phải UTC.
  const txMonth = new Date(`${occurred_on}T00:00:00`);
  if (isSameMonth(txMonth, state.currentMonth)) {
    await loadTransactionsForMonth();
    renderAll();
  }
  showToast('Đã lưu giao dịch.');
});

function populateCategorySelects() {
  const pairs = [
    { el: document.getElementById('add-category'), type: state.addType },
    { el: document.getElementById('recur-category'), type: state.recurAddType },
  ];
  pairs.forEach(({ el, type }) => {
    const prev = el.value;
    const cats = state.categories.filter((c) => c.type === type);
    el.innerHTML = cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (cats.some((c) => c.id === prev)) el.value = prev;
  });
}

// ---------------- Modal helpers ----------------
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
});

// ---------------- Service worker (PWA) ----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
