(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const clone = value => ns.AccountingValidator ? ns.AccountingValidator.clone(value) : JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];

  function monthlyPeriods(startDate, endDate) {
    const periods = [];
    let cursor = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    while (cursor <= end) {
      const periodStart = new Date(cursor);
      const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const cappedEnd = periodEnd > end ? end : periodEnd;
      periods.push({
        id: `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`,
        startDate: periodStart.toISOString().slice(0, 10),
        endDate: cappedEnd.toISOString().slice(0, 10),
        status: 'open'
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return periods;
  }

  function createFiscalYear(input = {}) {
    const startDate = input.startDate || `${new Date().getFullYear()}-01-01`;
    const endDate = input.endDate || `${new Date().getFullYear()}-12-31`;
    return Object.freeze({
      id: input.id || `FY-${startDate.slice(0, 4)}`,
      name: input.name || `Fiscal Year ${startDate.slice(0, 4)}`,
      startDate,
      endDate,
      status: input.status || 'open',
      periods: Object.freeze(list(input.periods).length ? input.periods : monthlyPeriods(startDate, endDate))
    });
  }

  function upsertYear(state = {}, year) {
    const next = clone(state);
    next.fiscalYears = list(next.fiscalYears).map(item => item.id === year.id ? year : item);
    if (!next.fiscalYears.some(item => item.id === year.id)) next.fiscalYears.push(year);
    return next;
  }

  function changeYearStatus(state, yearId, status) {
    const next = clone(state);
    next.fiscalYears = list(next.fiscalYears).map(year => year.id === yearId ? { ...year, status } : year);
    return next;
  }

  function changePeriodStatus(state, yearId, periodId, status) {
    const next = clone(state);
    next.fiscalYears = list(next.fiscalYears).map(year => {
      if (year.id !== yearId) return year;
      return { ...year, periods: list(year.periods).map(period => period.id === periodId ? { ...period, status } : period) };
    });
    return next;
  }

  ns.FiscalYearEngine = Object.freeze({
    version: '1.0.0',
    monthlyPeriods,
    createFiscalYear,
    upsertYear,
    closePeriod: (state, yearId, periodId) => changePeriodStatus(state, yearId, periodId, 'closed'),
    reopenPeriod: (state, yearId, periodId) => changePeriodStatus(state, yearId, periodId, 'open'),
    closeYear: (state, yearId) => changeYearStatus(state, yearId, 'closed'),
    reopenYear: (state, yearId) => changeYearStatus(state, yearId, 'open')
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
