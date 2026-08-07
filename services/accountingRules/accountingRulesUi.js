(function (root) {
  'use strict';

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const money = value => typeof root.formatMoney === 'function' ? root.formatMoney(Number(value || 0)) : Number(value || 0).toFixed(2);
  const accountFields = [
    ['cash', 'Cash / Treasury'], ['receivable', 'Accounts Receivable'], ['inventory', 'Inventory Asset'],
    ['payable', 'Accounts Payable'], ['revenue', 'Sales Revenue'], ['cogs', 'Cost of Goods Sold'],
    ['expense', 'Operating Expense'], ['taxPayable', 'Tax Payable'], ['taxReceivable', 'Tax Receivable'],
    ['discount', 'Sales Discount'], ['salesReturns', 'Sales Returns'], ['otherIncome', 'Other Income'],
    ['adjustment', 'Inventory Adjustment'], ['transferClearing', 'Transfer Clearing'],
    ['openingEquity', 'Opening Balance Equity'], ['retainedEarnings', 'Retained Earnings']
  ];

  function option(value, label, selected) {
    return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }

  function renderAccountSettings(settings) {
    const host = document.getElementById('accountingDefaultAccounts');
    if (!host) return;
    const accounts = root.OmniChartOfAccounts.accounts;
    host.innerHTML = accountFields.map(([field, label]) => `
      <div class="form-group"><label>${esc(label)}</label>
        <select id="accountRuleAccount_${esc(field)}">
          ${accounts.map(account => option(account.key, `${account.code} — ${account.nameAr}`, settings.defaultAccounts[field])).join('')}
        </select>
      </div>`).join('');
  }

  function renderSimulatorSelectors(settings) {
    const registry = root.OmniAccountingRuleRegistry;
    if (!registry.isBooted()) registry.boot();
    const profileSelect = document.getElementById('accountRuleBusinessType');
    const operationSelect = document.getElementById('accountRuleOperation');
    if (profileSelect) {
      const current = registry.resolveProfileId(typeof root.getCurrentBusinessType === 'function' ? root.getCurrentBusinessType() : 'computer_shop');
      profileSelect.innerHTML = registry.listProfiles().map(profile => option(profile.id, `${profile.nameAr} — ${profile.id}`, current)).join('');
    }
    if (operationSelect) {
      operationSelect.innerHTML = root.OmniAccountingRuleTemplates.operationIds.map(id => {
        const template = root.OmniAccountingRuleTemplates.get(id);
        return option(id, `${template.ruleName} — ${id}`, 'sale');
      }).join('');
    }
    const currency = document.getElementById('accountRuleCurrency');
    if (currency) currency.value = settings.currency;
  }

  function renderAccountingConfiguration() {
    root.OmniAccountingRuleRegistry.boot();
    const settings = root.OmniAccountingRulesSettings.load();
    const tax = document.getElementById('accountRuleDefaultTax');
    const inventory = document.getElementById('accountRuleInventoryMethod');
    const profit = document.getElementById('accountRuleProfitMethod');
    const negative = document.getElementById('accountRuleAllowNegative');
    const auto = document.getElementById('accountRuleAutoPreview');
    const validation = document.getElementById('accountRuleValidationEnabled');
    if (tax) tax.value = settings.defaultTaxRate;
    if (inventory) inventory.value = settings.inventoryMethod;
    if (profit) profit.value = settings.profitCalculationMethod;
    if (negative) negative.checked = settings.allowNegativeStock;
    if (auto) auto.checked = settings.autoJournalPreview;
    if (validation) validation.checked = settings.enableAccountingValidation;
    renderAccountSettings(settings);
    renderSimulatorSelectors(settings);
    const stats = root.OmniAccountingRuleRegistry.stats();
    const status = document.getElementById('accountingRulesStatus');
    if (status) status.innerHTML = `<span class="badge badge-blue">Preview Only</span> ${stats.profiles} Business Profiles · ${stats.rules} Rules · لا يتم حفظ أي قيد`;
    syncAccountingSimulatorTax();
    previewAccountingRuleSimulation();
  }

  function collectSettings() {
    const existing = root.OmniAccountingRulesSettings.load();
    const defaultAccounts = { ...existing.defaultAccounts };
    accountFields.forEach(([field]) => {
      const element = document.getElementById(`accountRuleAccount_${field}`);
      if (element) defaultAccounts[field] = element.value;
    });
    return {
      defaultTaxRate: Number(document.getElementById('accountRuleDefaultTax')?.value || 0),
      inventoryMethod: document.getElementById('accountRuleInventoryMethod')?.value || 'weighted_average',
      profitCalculationMethod: document.getElementById('accountRuleProfitMethod')?.value || 'invoice_cost',
      allowNegativeStock: !!document.getElementById('accountRuleAllowNegative')?.checked,
      autoJournalPreview: !!document.getElementById('accountRuleAutoPreview')?.checked,
      enableAccountingValidation: !!document.getElementById('accountRuleValidationEnabled')?.checked,
      currency: document.getElementById('accountRuleCurrency')?.value || existing.currency,
      defaultAccounts
    };
  }

  function saveAccountingRulesConfiguration() {
    if (typeof root.requirePermission === 'function' && !root.requirePermission('manageSettings')) return;
    root.OmniAccountingRulesSettings.save(collectSettings());
    if (typeof root.showToast === 'function') root.showToast('تم حفظ إعدادات المحاسبة محليًا فقط');
    renderAccountingConfiguration();
  }

  function resetAccountingRulesConfiguration() {
    if (typeof root.requirePermission === 'function' && !root.requirePermission('manageSettings')) return;
    root.OmniAccountingRulesSettings.reset();
    if (typeof root.showToast === 'function') root.showToast('تمت استعادة إعدادات المحاسبة الافتراضية');
    renderAccountingConfiguration();
  }

  function syncAccountingSimulatorTax() {
    const settings = collectSettings();
    const amount = Number(document.getElementById('accountRuleAmount')?.value || 0);
    const discount = Number(document.getElementById('accountRuleDiscount')?.value || 0);
    const tax = Math.round(Math.max(0, amount - discount) * settings.defaultTaxRate) / 100;
    const taxInput = document.getElementById('accountRuleTax');
    if (taxInput) taxInput.value = tax.toFixed(2);
    maybePreviewAccountingRuleSimulation();
  }

  function simulatorContext(settings) {
    const amount = Number(document.getElementById('accountRuleAmount')?.value || 0);
    const operation = document.getElementById('accountRuleOperation')?.value || 'sale';
    const sourceAccount = settings.defaultAccounts.cash;
    const destinationAccount = settings.defaultAccounts.transferClearing;
    const context = {
      amount,
      cost: Number(document.getElementById('accountRuleCost')?.value || 0),
      tax: Number(document.getElementById('accountRuleTax')?.value || 0),
      taxRate: Number(settings.defaultTaxRate || 0),
      discount: Number(document.getElementById('accountRuleDiscount')?.value || 0),
      quantity: Number(document.getElementById('accountRuleQuantity')?.value || 0),
      availableStock: Number(document.getElementById('accountRuleAvailableStock')?.value || 0),
      currency: document.getElementById('accountRuleCurrency')?.value || settings.currency,
      paymentType: document.getElementById('accountRulePaymentType')?.value || 'cash',
      inventoryDirection: document.getElementById('accountRuleInventoryDirection')?.value || 'in',
      sourceAccount,
      destinationAccount
    };
    if (['opening_balance', 'closing_balance', 'manual_journal'].includes(operation)) {
      const creditAccount = operation === 'closing_balance' ? settings.defaultAccounts.retainedEarnings : settings.defaultAccounts.openingEquity;
      context.entries = [
        { accountKey: settings.defaultAccounts.cash, debit: amount, credit: 0, memo: 'Simulator debit' },
        { accountKey: creditAccount, debit: 0, credit: amount, memo: 'Simulator credit' }
      ];
    }
    return context;
  }

  function renderSimulation(result) {
    const status = document.getElementById('accountRulePreviewStatus');
    const tbody = document.getElementById('accountRulePreviewTbody');
    const issues = document.getElementById('accountRuleValidationResults');
    const effects = document.getElementById('accountRuleEffects');
    if (status) status.innerHTML = result.valid
      ? `<span class="badge badge-green">Valid & Balanced</span> Debit ${money(result.totals.debit)} = Credit ${money(result.totals.credit)}`
      : `<span class="badge badge-red">Validation Failed</span> الفرق ${money(result.totals && result.totals.difference)}`;
    if (tbody) tbody.innerHTML = (result.lines || []).map(line => `<tr>
      <td>${esc(line.accountCode)}</td><td>${esc(line.accountNameAr)}</td>
      <td>${money(line.debit)}</td><td>${money(line.credit)}</td><td>${esc(line.memo)}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center">لا توجد سطور معاينة</td></tr>';
    const allIssues = [...(result.validation.errors || []), ...(result.validation.warnings || [])];
    if (issues) issues.innerHTML = allIssues.length
      ? allIssues.map(item => `<div class="alert ${item.severity === 'error' ? 'alert-error' : 'alert-warning'}" style="font-size:.76rem;margin-bottom:6px"><code>${esc(item.code)}</code> — ${esc(item.message)}</div>`).join('')
      : '<div class="alert alert-success">كل قواعد التحقق ناجحة.</div>';
    if (effects && result.effects) effects.innerHTML = [
      ['Inventory Effect', `${result.effects.inventory.quantityDelta} units / ${money(result.effects.inventory.valueDelta)}`],
      ['Cash Effect', money(result.effects.cash.amountDelta)],
      ['Tax Input / Output', `${money(result.effects.tax.inputTaxDelta)} / ${money(result.effects.tax.outputTaxDelta)}`],
      ['Profit Effect', money(result.effects.profit.amountDelta)]
    ].map(([label, value]) => `<div class="report-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function previewAccountingRuleSimulation() {
    try {
      const settings = collectSettings();
      const businessType = document.getElementById('accountRuleBusinessType')?.value || 'computer_shop';
      const operation = document.getElementById('accountRuleOperation')?.value || 'sale';
      const result = root.OmniAccountingRulePreview.preview(businessType, operation, simulatorContext(settings), settings);
      renderSimulation(result);
      return result;
    } catch (error) {
      const host = document.getElementById('accountRuleValidationResults');
      if (host) host.innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
      return null;
    }
  }

  function maybePreviewAccountingRuleSimulation() {
    if (document.getElementById('accountRuleAutoPreview')?.checked) previewAccountingRuleSimulation();
  }

  root.renderAccountingConfiguration = renderAccountingConfiguration;
  root.saveAccountingRulesConfiguration = saveAccountingRulesConfiguration;
  root.resetAccountingRulesConfiguration = resetAccountingRulesConfiguration;
  root.previewAccountingRuleSimulation = previewAccountingRuleSimulation;
  root.maybePreviewAccountingRuleSimulation = maybePreviewAccountingRuleSimulation;
  root.syncAccountingSimulatorTax = syncAccountingSimulatorTax;
})(typeof globalThis !== 'undefined' ? globalThis : window);
