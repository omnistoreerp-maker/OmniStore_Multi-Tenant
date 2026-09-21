'use strict';

// frontendEmployeesSync.test.js — HR page backend-mode regression tests.
//
// In backend mode the employees page renders rows straight from the API
// (digitronicsDataAdapter.listEmployees), but the row-action handlers only
// looked records up in the local DB.employees mirror. Three shipped defects
// are pinned as fixed here:
//   1. dead row buttons: handlers used `e.id === id` (strict) or the local
//      mirror only, so API rows (uuid ids) could never be found
//   2. injection-broken onclick: row templates interpolated `${e.id}`
//      unquoted — uuid ids produce invalid JS inside the attribute
//   3. delete resurrection: deleteEmployee only called the backend when
//      `_backendId` was set, so records whose sync flag was lost stayed on
//      the server and reappeared on every reload
// The REAL functions are extracted from the shipped index.html (same
// approach as frontendPlatformGating.test.js). _findEmployee is an adapter
// object method, so it is lifted into a standalone function for the sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

// Extract a `function name(...)` OR `async function name(...)` declaration
// (the optional async prefix matters: deleteEmployee is async and awaits).
function extractFunction(name) {
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(HTML);
  if (!match) throw new Error('function not found: ' + name);
  const open = HTML.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) return HTML.slice(match.index, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

// Extract an object-literal method (`  name(...) { ... }`) and convert it to
// a standalone function declaration for the sandbox.
function extractObjectMethod(name) {
  const re = new RegExp('\\n(\\s+)' + name + '\\s*\\(', 'g');
  const match = re.exec(HTML);
  if (!match) throw new Error('object method not found: ' + name);
  const open = HTML.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) {
        const body = HTML.slice(match.index + 1, i + 1).trim();
        return 'function ' + body;
      }
    }
  }
  throw new Error('unterminated object method: ' + name);
}

function elementStub() {
  return {
    style: {}, value: '', textContent: '', innerHTML: '', display: '',
    appendChild: () => {}, addEventListener: () => {}, querySelectorAll: () => [], dataset: {}
  };
}

function buildSandbox(opts = {}) {
  const db = { employees: opts.dbEmployees || [], employeeAttendance: [], employeeLeaves: [], employeeOvertime: [], payrollRuns: [], salaryLog: [], employeeLedger: [], employeeAdvances: [], employeeEvaluations: [], employeeBonuses: [], employeeDeductions: [] };
  const context = {
    console,
    DB: db,
    USE_BACKEND: opts.useBackend !== undefined ? opts.useBackend : true,
    backendApi: opts.backendApi !== undefined ? opts.backendApi : { employees: {} },
    currentUser: { username: 'admin', role: 'Owner' },
    confirm: () => true,
    requirePermission: () => true,
    permissionDenied: () => {},
    can: () => true,
    canManageEmployee: () => true,
    getTodayAttendance: () => null,
    localDateString: () => '2026-09-21',
    localDateTimeString: () => '2026-09-21T12:00',
    getEmployeeBranchId: () => 'MAIN',
    getBranchNameById: () => 'MAIN',
    saveDB: opts.saveDB || (() => {}),
    renderEmployees: opts.renderEmployees || (() => {}),
    renderHRManagement: () => {},
    renderEmployeePerformance: () => {},
    renderDashboard: () => {},
    logAudit: () => {},
    showToast: opts.showToast || (() => {}),
    calcAttendanceOvertime: () => 0,
    document: {
      getElementById: () => elementStub(),
      createElement: () => elementStub(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout, setInterval: () => 42, clearInterval: () => {}
  };
  context.globalThis = context;
  context.window = context;

  const code = [
    'let editingEmployeeId = null;',
    extractObjectMethod('_findEmployee'),
    extractFunction('employeeCheckIn'),
    extractFunction('employeeCheckOut'),
    extractFunction('openEmployeeLeaveModal'),
    extractFunction('deleteEmployeeById'),
    extractFunction('deleteEmployee')
  ].join('\n');

  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-employees-sync.js' });
  return { context, db };
}

describe('frontend employees backend-mode sync (real index.html functions)', () => {
  test('row actions find backend rows by _backendId via _findEmployee', () => {
    const backendRecord = { id: 'uuid-1', _backendId: 'uuid-1', name: 'Ali', salary: 100 };
    const { context } = buildSandbox({ dbEmployees: [backendRecord] });
    expect(context._findEmployee('uuid-1')).toBe(backendRecord);
    expect(context._findEmployee('missing')).toBeNull();
  });

  test('employeeCheckIn works on a backend uuid record (was dead before the fix)', () => {
    const record = { id: 'uuid-2', _backendId: 'uuid-2', name: 'Mona' };
    const calls = [];
    const { context } = buildSandbox({
      dbEmployees: [record],
      saveDB: () => calls.push('save'),
      renderEmployees: () => calls.push('render')
    });
    context.employeeCheckIn('uuid-2');
    expect(calls).toContain('save');
    expect(context.DB.employeeAttendance.length).toBe(1);
    expect(context.DB.employeeAttendance[0].employeeId).toBe('uuid-2');
  });

  test('row templates quote employee ids inside onclick handlers', () => {
    // The shipped template interpolated ${e.id} raw; uuid ids broke the
    // attribute JS. The templates now wrap ids in quotes + escapeHtml.
    expect(/employeeCheckIn\('\$\{escapeHtml\(e\.id\)\}'\)/.test(HTML)).toBe(true);
    expect(/paySalary\('\$\{escapeHtml\(e\.id\)\}'\)/.test(HTML)).toBe(true);
    expect(/deleteEmployeeById\('\$\{escapeHtml\(e\.id\)\}'\)/.test(HTML)).toBe(true);
  });

  test('deleteEmployee always calls the backend (id-first fallback), no resurrection', async () => {
    const deleted = [];
    const backendApi = { employees: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const record = { id: 'legacy-id-9', name: 'Sync Lost' }; // no _backendId
    const { context } = buildSandbox({ dbEmployees: [record], backendApi });
    await context.deleteEmployee(0);
    expect(deleted).toEqual(['legacy-id-9']);
    expect(context.DB.employees.length).toBe(0);
  });

  test('deleteEmployee uses _backendId when present', async () => {
    const deleted = [];
    const backendApi = { employees: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const record = { id: 'local-1', _backendId: 'uuid-77', name: 'Synced' };
    const { context } = buildSandbox({ dbEmployees: [record], backendApi });
    await context.deleteEmployee(0);
    expect(deleted).toEqual(['uuid-77']);
  });

  test('deleteEmployeeById finds backend rows by _backendId too', async () => {
    const deleted = [];
    const backendApi = { employees: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const record = { id: 'uuid-88', _backendId: 'uuid-88', name: 'By Ref' };
    const { context } = buildSandbox({ dbEmployees: [record], backendApi });
    await context.deleteEmployeeById('uuid-88');
    expect(deleted).toEqual(['uuid-88']);
  });

  test('listEmployees hydrates the DB mirror from the API response', () => {
    // The adapter must write the API rows back into DB.employees so
    // subsequent row actions operate on what was rendered.
    expect(/async listEmployees\s*\(/.test(HTML)).toBe(true);
    expect(HTML.includes('DB.employees = employees.slice()')).toBe(true);
  });
});
