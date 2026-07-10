/**
 * Expense & Budget Visualizer
 * Pure Vanilla JS — no frameworks
 */

'use strict';

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────
const STORAGE_KEY    = 'expense_visualizer_transactions';
const CATEGORIES_KEY = 'expense_visualizer_categories';
const LIMIT_KEY      = 'expense_visualizer_limit';

const CATEGORY_COLORS = {
  Food:      '#FF6384',
  Transport: '#36A2EB',
  Fun:       '#FFCE56',
  Health:    '#4BC0C0',
  Shopping:  '#9966FF',
  Other:     '#FF9F40',
};

const DEFAULT_CATEGORIES = ['Food', 'Transport', 'Fun'];

// ─────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────
let transactions        = [];
let chartInstance       = null;
let customCategories    = [];
let currentMonthOffset  = 0; // 0 = current month, -1 = last month, etc.

// ─────────────────────────────────────────────────
// Local Storage helpers
// ─────────────────────────────────────────────────
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    return parsed;
  } catch {
    // Corrupted data — reset to empty
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    clearStorageError();
  } catch (err) {
    // Quota exceeded or other write error
    showStorageError('Storage quota exceeded. Transaction saved in-memory only.');
  }
}

// ─────────────────────────────────────────────────
// Categories helpers
// ─────────────────────────────────────────────────
function loadCategories() {
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveCategories() {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(customCategories));
  } catch {}
}

function getAllCategories() {
  return [...DEFAULT_CATEGORIES, ...customCategories];
}

function renderCategoryOptions() {
  const all = getAllCategories();

  // Update form category select
  const current = elCategory.value;
  elCategory.innerHTML = all
    .map(c => `<option value="${escapeHtml(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');
  // Keep selected value if still valid, else reset to first
  if (!all.includes(elCategory.value)) elCategory.value = all[0];

  // Update filter dropdown — keep "All" first, then all categories
  const filterCurrent = elFilterCategory.value;
  elFilterCategory.innerHTML = `<option value="All">All Categories</option>` +
    all.map(c => `<option value="${escapeHtml(c)}"${c === filterCurrent ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  if (filterCurrent !== 'All' && !all.includes(filterCurrent)) elFilterCategory.value = 'All';
}

function handleAddCategory() {
  const input   = document.getElementById('new-category');
  const errorEl = document.getElementById('category-error');
  const name    = input.value.trim();

  errorEl.textContent = '';

  if (!name) {
    errorEl.textContent = 'Category name cannot be empty.';
    return;
  }
  if (name.length > 30) {
    errorEl.textContent = 'Category name must be 30 characters or fewer.';
    return;
  }
  const all = getAllCategories();
  if (all.some(c => c.toLowerCase() === name.toLowerCase())) {
    errorEl.textContent = 'This category already exists.';
    return;
  }

  customCategories.push(name);
  saveCategories();
  renderCategoryOptions();
  input.value = '';
  // Auto-select the new category in the form
  elCategory.value = name;
}

// ─────────────────────────────────────────────────
// Spending Limit
// ─────────────────────────────────────────────────
function loadSpendingLimit() {
  const raw = localStorage.getItem(LIMIT_KEY);
  const val = parseFloat(raw);
  return isNaN(val) ? 0 : val;
}

function saveSpendingLimit(value) {
  localStorage.setItem(LIMIT_KEY, String(value));
}

function renderSpendingLimit() {
  const limit         = loadSpendingLimit();
  const elLimitInput  = document.getElementById('spending-limit');
  const elLimitStatus = document.getElementById('limit-status');
  const elBalanceAmt  = document.getElementById('balance');

  if (limit > 0) {
    elLimitInput.value = limit;
  }

  // Only check current month's spending for the limit indicator
  const { year, month } = getMonthYear(0); // always current month for balance card
  const monthlyTotal = transactions
    .filter(t => {
      const d = new Date(t.timestamp);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  if (limit > 0) {
    const pct = Math.min((monthlyTotal / limit) * 100, 100).toFixed(0);
    if (monthlyTotal > limit) {
      elLimitStatus.textContent = `⚠️ Over limit! Spent ${formatCurrency(monthlyTotal)} of ${formatCurrency(limit)} (${pct}%)`;
      elLimitStatus.className   = 'limit-status over-limit-text';
      elBalanceAmt.classList.add('over-limit-pulse');
    } else {
      elLimitStatus.textContent = `Spent ${formatCurrency(monthlyTotal)} of ${formatCurrency(limit)} (${pct}%)`;
      elLimitStatus.className   = 'limit-status under-limit-text';
      elBalanceAmt.classList.remove('over-limit-pulse');
    }
  } else {
    elLimitStatus.textContent = '';
    elLimitStatus.className   = 'limit-status';
    elBalanceAmt.classList.remove('over-limit-pulse');
  }
}

function handleSetLimit() {
  const input = document.getElementById('spending-limit');
  const val   = parseFloat(input.value);
  if (isNaN(val) || val < 0) {
    input.value = '';
    saveSpendingLimit(0);
  } else {
    saveSpendingLimit(val);
  }
  renderSpendingLimit();
  renderMonthlySummary();
}

// ─────────────────────────────────────────────────
// Monthly Summary
// ─────────────────────────────────────────────────
function getMonthYear(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function formatMonthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function renderMonthlySummary() {
  const elMonthLabel    = document.getElementById('month-label');
  const elMonthlyList   = document.getElementById('monthly-list');
  const elMonthlyTotal  = document.getElementById('monthly-total');
  const elMonthlyTotalV = document.getElementById('monthly-total-value');
  const elMonthlyPH     = document.getElementById('monthly-placeholder');

  const { year, month } = getMonthYear(currentMonthOffset);
  elMonthLabel.textContent = formatMonthLabel(year, month);

  // Filter transactions for this month
  const monthly = transactions.filter(t => {
    const d = new Date(t.timestamp);
    return d.getFullYear() === year && d.getMonth() === month;
  }).sort((a, b) => b.timestamp - a.timestamp);

  elMonthlyList.innerHTML = '';

  if (monthly.length === 0) {
    elMonthlyPH.hidden    = false;
    elMonthlyTotal.hidden = true;
    return;
  }

  elMonthlyPH.hidden    = true;
  elMonthlyTotal.hidden = false;

  let total = 0;
  const spendingLimit = loadSpendingLimit();

  monthly.forEach(t => {
    total += t.amount;
    const li = document.createElement('li');
    li.className = 'monthly-item';
    li.innerHTML = `
      <span class="monthly-item-desc">${escapeHtml(t.description)}</span>
      <span class="monthly-item-cat">${escapeHtml(t.category)}</span>
      <span class="monthly-item-date">${formatDate(t.timestamp)}</span>
      <span class="monthly-item-amount">${formatCurrency(t.amount)}</span>
    `;
    elMonthlyList.appendChild(li);
  });

  elMonthlyTotalV.textContent = formatCurrency(total);

  // Highlight total if over limit (only meaningful for current month)
  if (spendingLimit > 0 && currentMonthOffset === 0 && total > spendingLimit) {
    elMonthlyTotalV.classList.add('over-limit');
    elMonthlyTotal.classList.add('over-limit');
  } else {
    elMonthlyTotalV.classList.remove('over-limit');
    elMonthlyTotal.classList.remove('over-limit');
  }
}

// ─────────────────────────────────────────────────
// Unique ID
// ─────────────────────────────────────────────────
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('id-ID', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });
}

// ─────────────────────────────────────────────────
// Balance calculations
// ─────────────────────────────────────────────────
function calcTotals() {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

// ─────────────────────────────────────────────────
// DOM References (resolved after DOMContentLoaded)
// ─────────────────────────────────────────────────
let elBalance, elExpenses;
let elForm, elDescription, elAmount, elCategory;
let elDescError, elAmountError, elStorageError;
let elTransactionList, elListPlaceholder;
let elFilterCategory;
let elChartCanvas, elChartPlaceholder, elChartWrapper;

function resolveElements() {
  elBalance          = document.getElementById('balance');
  elExpenses         = document.getElementById('total-expenses');

  elForm             = document.getElementById('transaction-form');
  elDescription      = document.getElementById('description');
  elAmount           = document.getElementById('amount');
  elCategory         = document.getElementById('category');

  elDescError        = document.getElementById('desc-error');
  elAmountError      = document.getElementById('amount-error');
  elStorageError     = document.getElementById('storage-error');

  elTransactionList  = document.getElementById('transaction-list');
  elListPlaceholder  = document.getElementById('list-placeholder');

  elFilterCategory   = document.getElementById('filter-category');

  elChartCanvas      = document.getElementById('spending-chart');
  elChartPlaceholder = document.getElementById('chart-placeholder');
  elChartWrapper     = document.getElementById('chart-wrapper');

  // Custom category button & enter-key shortcut
  document.getElementById('add-category-btn').addEventListener('click', handleAddCategory);
  document.getElementById('new-category').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); }
  });

  // Spending limit controls
  document.getElementById('set-limit-btn').addEventListener('click', handleSetLimit);
  document.getElementById('spending-limit').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSetLimit();
  });

  // Month navigation
  document.getElementById('month-prev').addEventListener('click', () => {
    currentMonthOffset--;
    renderMonthlySummary();
  });
  document.getElementById('month-next').addEventListener('click', () => {
    if (currentMonthOffset < 0) {
      currentMonthOffset++;
      renderMonthlySummary();
    }
  });
}

// ─────────────────────────────────────────────────
// Render: Balance
// ─────────────────────────────────────────────────
function renderBalance() {
  const total = calcTotals();
  elBalance.textContent  = formatCurrency(total);
  elExpenses.textContent = formatCurrency(total);
}

// ─────────────────────────────────────────────────
// Render: Transaction List
// ─────────────────────────────────────────────────
function renderTransactions() {
  const filter = elFilterCategory.value;

  // Sort newest first
  const sorted = [...transactions].sort((a, b) => b.timestamp - a.timestamp);

  // Apply category filter
  const filtered = filter === 'All'
    ? sorted
    : sorted.filter(t => t.category === filter);

  // Clear list
  elTransactionList.innerHTML = '';

  if (filtered.length === 0) {
    elListPlaceholder.hidden = false;
    elListPlaceholder.textContent = filter === 'All'
      ? 'No transactions yet. Add one above!'
      : `No transactions found for category "${filter}".`;
    return;
  }

  elListPlaceholder.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const t of filtered) {
    fragment.appendChild(createTransactionItem(t));
  }
  elTransactionList.appendChild(fragment);
}

function createTransactionItem(t) {
  const li = document.createElement('li');
  li.className = 'transaction-item expense';
  li.dataset.id = t.id;

  li.innerHTML = `
    <div class="transaction-info">
      <div class="transaction-description" title="${escapeHtml(t.description)}">${escapeHtml(t.description)}</div>
      <div class="transaction-meta">
        <span class="transaction-badge badge-expense">Expense</span>
        <span>${escapeHtml(t.category)}</span>
        <span>${formatDate(t.timestamp)}</span>
      </div>
    </div>
    <span class="transaction-amount expense">${formatCurrency(t.amount)}</span>
    <button
      class="btn btn-delete"
      type="button"
      aria-label="Delete transaction: ${escapeHtml(t.description)}"
      data-id="${t.id}"
    >Delete</button>
  `;

  return li;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────
// Render: Chart
// ─────────────────────────────────────────────────
function renderChart() {
  // Only expense transactions
  const expenses = transactions.filter(t => t.type === 'expense');

  if (expenses.length === 0) {
    elChartWrapper.hidden     = true;
    elChartPlaceholder.hidden = false;
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }

  elChartWrapper.hidden     = false;
  elChartPlaceholder.hidden = true;

  // Aggregate by category
  const totals = {};
  for (const t of expenses) {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  }

  const labels     = Object.keys(totals);
  const data       = Object.values(totals);
  const colors     = labels.map(l => CATEGORY_COLORS[l] || '#aaa');
  const grandTotal = data.reduce((s, v) => s + v, 0);

  if (chartInstance) {
    // Update existing chart
    chartInstance.data.labels                      = labels;
    chartInstance.data.datasets[0].data            = data;
    chartInstance.data.datasets[0].backgroundColor = colors;
    chartInstance.update();
    return;
  }

  // Create new chart
  chartInstance = new Chart(elChartCanvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 14,
            font: { size: 13 },
            color: '#1e293b',
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const value = ctx.parsed;
              const pct   = ((value / grandTotal) * 100).toFixed(1);
              return ` ${ctx.label}: ${formatCurrency(value)} (${pct}%)`;
            },
          },
        },
      },
    },
    // Inline plugin to draw percentage labels on segments
    plugins: [{
      id: 'percentageLabels',
      afterDraw(chart) {
        const { ctx, data: chartData } = chart;
        const meta  = chart.getDatasetMeta(0);
        const total = chartData.datasets[0].data.reduce((s, v) => s + v, 0);

        ctx.save();
        ctx.font         = 'bold 11px -apple-system, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        meta.data.forEach((arc, i) => {
          const val = chartData.datasets[0].data[i];
          const pct = ((val / total) * 100).toFixed(1);
          // Only label if segment is large enough to read
          if (parseFloat(pct) < 5) return;

          const midAngle = (arc.startAngle + arc.endAngle) / 2;
          const outerR   = arc.outerRadius;
          const innerR   = arc.innerRadius;
          const r        = innerR + (outerR - innerR) * 0.6;
          const x        = arc.x + r * Math.cos(midAngle);
          const y        = arc.y + r * Math.sin(midAngle);

          ctx.fillStyle = '#fff';
          ctx.fillText(`${pct}%`, x, y);
        });

        ctx.restore();
      },
    }],
  });
}

// ─────────────────────────────────────────────────
// Full re-render
// ─────────────────────────────────────────────────
function renderAll() {
  renderBalance();
  renderTransactions();
  renderChart();
  renderMonthlySummary();
  renderSpendingLimit();
}

// ─────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────
function showError(el, inputEl, message) {
  el.textContent = message;
  if (inputEl) inputEl.classList.add('invalid');
}

function clearError(el, inputEl) {
  el.textContent = '';
  if (inputEl) inputEl.classList.remove('invalid');
}

function showStorageError(msg) {
  elStorageError.textContent = msg;
}

function clearStorageError() {
  elStorageError.textContent = '';
}

function validateForm() {
  let valid = true;

  clearError(elDescError, elDescription);
  clearError(elAmountError, elAmount);

  const desc   = elDescription.value.trim();
  const amtRaw = elAmount.value.trim();

  if (!desc) {
    showError(elDescError, elDescription, 'Description is required.');
    valid = false;
  } else if (desc.length > 100) {
    showError(elDescError, elDescription, 'Description must be 100 characters or fewer.');
    valid = false;
  }

  if (!amtRaw) {
    showError(elAmountError, elAmount, 'Amount is required.');
    valid = false;
  } else {
    const amt = parseFloat(amtRaw);
    if (isNaN(amt) || amt < 0.01) {
      showError(elAmountError, elAmount, 'Amount must be at least 0.01.');
      valid = false;
    } else if (amt > 999999999.99) {
      showError(elAmountError, elAmount, 'Amount must not exceed 999,999,999.99.');
      valid = false;
    }
  }

  return valid;
}

// ─────────────────────────────────────────────────
// Event: Form submit
// ─────────────────────────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();
  clearStorageError();

  if (!validateForm()) return;

  const newTransaction = {
    id:          generateId(),
    description: elDescription.value.trim(),
    amount:      Math.round(parseFloat(elAmount.value) * 100) / 100,
    type:        'expense',
    category:    elCategory.value,
    timestamp:   Date.now(),
  };

  transactions.unshift(newTransaction);
  saveToStorage(transactions);
  renderAll();

  // Reset form to defaults
  elDescription.value = '';
  elAmount.value      = '';
  elCategory.value    = getAllCategories()[0];
  elDescription.focus();
}

// ─────────────────────────────────────────────────
// Event: Delete transaction (event delegation)
// ─────────────────────────────────────────────────
function handleListClick(e) {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;

  const id = btn.dataset.id;
  transactions = transactions.filter(t => t.id !== id);
  saveToStorage(transactions);
  renderAll();
}

// ─────────────────────────────────────────────────
// Event: Filter change
// ─────────────────────────────────────────────────
function handleFilterChange() {
  renderTransactions();
}

// ─────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────
function init() {
  resolveElements();

  // Load persisted data
  transactions     = loadFromStorage();
  customCategories = loadCategories();

  // Populate category dropdowns before first render
  renderCategoryOptions();

  // Attach core events
  elForm.addEventListener('submit', handleFormSubmit);
  elTransactionList.addEventListener('click', handleListClick);
  elFilterCategory.addEventListener('change', handleFilterChange);

  // Initial render
  renderAll();
}

// Chart.js is loaded synchronously in <head> before this script runs,
// so it's always available. We still wait for the DOM to be fully parsed.
document.addEventListener('DOMContentLoaded', init);
