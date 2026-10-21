'use strict';

// Student Assignments E2E — REAL browser + REAL backend. No API mocks, no
// page.route interception.
//
// Boots the repository's actual Express app (backend/server.js) against an
// isolated temporary data directory (DIGITRONICS_DATA_DIR), seeds that temp
// store with the real education record shapes, serves the real
// education/index.html from a local static server, and proxies /api/v1/* to
// the real app on the same origin (the page hard-codes a relative API_BASE).
// Two linked-student identities are exercised:
//   stu-1 -> enrolled in a class that HAS assignments   (rendering)
//   stu-2 -> enrolled in a class with NO assignments     (empty state)
// All network calls are genuine HTTP requests to the real app; nothing is
// stubbed. Nothing in backend/data or any product file is read or written.
//
// Only this test file was changed in Phase D.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_FILE = path.resolve(__filename);
const JWT_SECRET = 'test-jwt-secret-for-jest-suites';
const STAMP = '2026-01-01T00:00:00.000Z';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-asg-e2e-'));

process.env.DIGITRONICS_DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';
process.env.ENABLE_TENANT_CARRY = 'true';
process.env.ENABLE_TENANT_ROLES = 'false';
process.env.ENABLE_MULTI_COMPANY_LOGIN = 'false';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.LOG_FILE = '';
process.env.PLATFORM_ADMINS = '';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 400) : ''));
  return !!ok;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function seed(name, payload) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(payload, null, 2), 'utf-8');
}

function signStudentToken(userId, username) {
  return jwt.sign({
    sub: String(userId),
    username,
    role: 'Viewer',
    tenantId: 'asg-a',
    jti: crypto.randomUUID()
  }, JWT_SECRET, { expiresIn: '15m' });
}

const OWNER = { id: 'u-owner', username: 'asgOwner', role: 'Owner', tenantIds: ['asg-a'], tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP };
const STU1_USER = { id: 'u-s1', username: 'asgStudent1', role: 'Viewer', tenantIds: ['asg-a'], tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP };
const STU2_USER = { id: 'u-s2', username: 'asgStudent2', role: 'Viewer', tenantIds: ['asg-a'], tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP };

function seedStores() {
  seed('companies', [{ id: 'asg-a', name: 'Assignments Tenant', code: 'ASG', active: true, status: 'ACTIVE', createdAt: STAMP, updatedAt: STAMP }]);
  seed('users', { users: [OWNER, STU1_USER, STU2_USER] });
  seed('educationCenters', { centers: [
    { id: 'cen-a1', tenantId: 'asg-a', centerCode: 'CA1', name: 'Center A1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationPrograms', { programs: [
    { id: 'prg-a1', tenantId: 'asg-a', centerId: 'cen-a1', name: 'Track A1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationCourses', { courses: [
    { id: 'crs-a1', tenantId: 'asg-a', programId: 'prg-a1', name: 'Course A1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationTeachers', { teachers: [
    { id: 'tch-a1', tenantId: 'asg-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationClasses', { classes: [
    { id: 'cls-a1', tenantId: 'asg-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cls-a2', tenantId: 'asg-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA2', name: 'Geometry A2', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationStudents', { students: [
    { id: 'stu-1', tenantId: 'asg-a', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', userId: 'u-s1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'stu-2', tenantId: 'asg-a', studentCode: 'S2', firstName: 'Sam', lastName: 'Two', status: 'active', userId: 'u-s2', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationEnrollments', { enrollments: [
    { id: 'enr-1', tenantId: 'asg-a', studentId: 'stu-1', classId: 'cls-a1', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP },
    { id: 'enr-2', tenantId: 'asg-a', studentId: 'stu-2', classId: 'cls-a2', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed('educationAssignments', { assignments: [
    { id: 'asg-1', tenantId: 'asg-a', classId: 'cls-a1', title: 'Homework 1', description: 'Page 10', dueDate: '2026-03-01', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-2', tenantId: 'asg-a', classId: 'cls-a1', title: 'Quiz 1', description: 'Chapter 2', dueDate: '2026-03-08', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startStaticProxy(apiPort) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      const headers = Object.assign({}, req.headers);
      headers.host = '127.0.0.1:' + apiPort;
      const proxied = http.request({ hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers }, upstream => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      });
      proxied.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('proxy error: ' + err.message);
      });
      req.pipe(proxied);
      return;
    }
    const rel = urlPath === '/' ? 'education/index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function listenApp(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.on('listening', () => resolve(server));
    server.on('error', reject);
  });
}

async function runScenario(browser, port, token, linkedId, expectRows) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedApi = [];
  const assignmentResponses = [];

  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (typeof m.location === 'function' && m.location()) || {};
    consoleErrors.push({ text: m.text(), url: loc.url || '' });
  });
  page.on('response', async res => {
    const url = res.url();
    if (url.indexOf('/api/v1/tenant/education/assignments') !== -1) {
      let body = '';
      try { body = await res.text(); } catch (_) { body = ''; }
      assignmentResponses.push({ status: res.status(), method: res.request().method(), url, body });
    }
    if (res.status() >= 400 && url.indexOf('/api/v1/') !== -1) {
      failedApi.push({ status: res.status(), url });
    }
  });

  await page.addInitScript(t => {
    try {
      localStorage.setItem('access_token', t);
      localStorage.setItem('omnistore_language', 'ar');
      localStorage.setItem('omnistore_platform_lang', 'ar');
    } catch (_) {}
  }, token);

  const base = 'http://127.0.0.1:' + port;
  await page.goto(base + '/education/index.html#student', { waitUntil: 'load', timeout: 30000 });

  const workspaceOk = await page.waitForSelector('section#edu-body-student', { timeout: 25000 }).then(() => true, () => false);
  const pickerOk = await page.waitForSelector('#edu-student-picker', { timeout: 25000 }).then(() => true, () => false);
  let pickerValue = '';
  let pickerOptions = 0;
  if (pickerOk) {
    await page.waitForFunction(() => {
      const s = document.getElementById('edu-student-picker');
      return !!(s && s.options && s.options.length > 0 && s.value);
    }, null, { timeout: 25000 }).catch(() => {});
    pickerValue = await page.$eval('#edu-student-picker', s => s.value).catch(() => '');
    pickerOptions = await page.$eval('#edu-student-picker', s => s.options.length).catch(() => 0);
  }

  let listOk = false;
  if (expectRows) {
    listOk = await page.waitForFunction(() => {
      const l = document.getElementById('edu-student-assignments-list');
      return !!(l && l.querySelectorAll('table tbody tr').length > 0);
    }, null, { timeout: 25000 }).then(() => true, () => false);
  } else {
    listOk = await page.waitForFunction(() => {
      const l = document.getElementById('edu-student-assignments-list');
      return !!(l && l.querySelector('.edu-state'));
    }, null, { timeout: 25000 }).then(() => true, () => false);
  }

  const rows = await page.$$eval('#edu-student-assignments-list table tbody tr', trs => trs.map(tr => tr.textContent)).catch(() => []);
  const listText = await page.$eval('#edu-student-assignments-list', n => n.textContent).catch(() => '');
  const cardPresent = await page.$('#edu-student-assignments').then(n => !!n).catch(() => false);
  const rtl = await page.evaluate(() => {
    const card = document.getElementById('edu-student-assignments');
    return {
      docDir: document.documentElement.getAttribute('dir'),
      computed: card ? getComputedStyle(card).direction : ''
    };
  }).catch(() => ({ docDir: '', computed: '' }));
  const writeControls = await page.$$eval(
    '#edu-student-assignments input, #edu-student-assignments textarea, #edu-student-assignments select, #edu-student-assignments button, #edu-student-assignments form',
    nodes => nodes.length
  ).catch(() => -1);

  const assignReq = assignmentResponses.find(r => r.method === 'GET') || null;
  let assignCount = null;
  if (assignReq && assignReq.body) {
    try {
      const parsed = JSON.parse(assignReq.body);
      if (parsed && Array.isArray(parsed.data)) assignCount = parsed.data.length;
    } catch (_) {}
  }

  await context.close();

  return {
    linkedId, expectRows, workspaceOk, pickerOk, pickerValue, pickerOptions, listOk,
    rows, listText, cardPresent, rtl, writeControls, assignReq, assignCount,
    consoleErrors, pageErrors, failedApi
  };
}

(async () => {
  const beforeHash = sha256(TARGET_FILE);
  let apiServer = null;
  let staticServer = null;
  let browser = null;
  const report = {
    REPO_ROOT: ROOT,
    TARGET_SHA256_START: beforeHash,
    BROWSER_STARTED: 'FAIL',
    TEST_EXECUTED: 'NO',
    STUDENT_WORKSPACE: 'NOT_COVERED',
    STUDENT_PICKER: 'NOT_COVERED',
    GET_ASSIGNMENTS: 'NOT_COVERED',
    ASSIGNMENT_RENDERING: 'NOT_COVERED',
    EMPTY_STATE: 'NOT_COVERED',
    ERROR_RETRY: 'NOT_TESTABLE_WITHOUT_PRODUCT_OR_MOCK_CHANGES',
    RTL: 'NOT_COVERED',
    STUDENT_WRITE_SURFACE: 'NOT_IMPLEMENTED_IN_PRODUCT',
    CONSOLE_ERRORS: '0',
    PAGE_ERRORS: '0',
    FAILED_REQUESTS: 'none',
    BLOCKER: 'none'
  };

  try {
    seedStores();
    const app = require(path.join(ROOT, 'backend', 'server.js'));
    apiServer = await listenApp(app);
    const apiPort = apiServer.address().port;
    staticServer = await startStaticProxy(apiPort);
    const port = staticServer.address().port;

    browser = await chromium.launch();
    report.BROWSER_STARTED = 'PASS';
    report.TEST_EXECUTED = 'YES';

    const has = await runScenario(browser, port, signStudentToken('u-s1', 'asgStudent1'), 'stu-1', true);
    const empty = await runScenario(browser, port, signStudentToken('u-s2', 'asgStudent2'), 'stu-2', false);

    const hasRowsText = has.rows.join(' | ');
    const hasRendered = has.listOk && has.rows.length === 2 &&
      hasRowsText.indexOf('Homework 1') !== -1 && hasRowsText.indexOf('Quiz 1') !== -1 &&
      hasRowsText.indexOf('Algebra A1') !== -1 && hasRowsText.indexOf('2026-03-01') !== -1;
    const emptyRendered = empty.listOk && empty.rows.length === 0 &&
      /No assignments|لا توجد واجبات/.test(empty.listText);
    const getOk = !!(has.assignReq && has.assignReq.status === 200 && has.assignCount === 2 &&
      empty.assignReq && empty.assignReq.status === 200 && empty.assignCount === 0);
    const pickerOk = has.pickerOk && empty.pickerOk &&
      has.pickerValue === 'stu-1' && empty.pickerValue === 'stu-2' && has.pickerOptions >= 2;
    const rtlOk = has.rtl.docDir === 'rtl' && has.rtl.computed === 'rtl' &&
      empty.rtl.docDir === 'rtl' && empty.rtl.computed === 'rtl';
    const workspaceOk = has.workspaceOk && empty.workspaceOk && has.cardPresent && empty.cardPresent;
    const noWriteSurface = has.writeControls === 0 && empty.writeControls === 0;

    const allConsole = has.consoleErrors.concat(empty.consoleErrors);
    const allPage = has.pageErrors.concat(empty.pageErrors);
    const allFailed = has.failedApi.concat(empty.failedApi);

    check('STUDENT_WORKSPACE: section#edu-body-student opened for both linked students', workspaceOk);
    check('STUDENT_PICKER: #edu-student-picker present and preselects the linked student', pickerOk,
      'has=' + has.pickerValue + ' empty=' + empty.pickerValue + ' options=' + has.pickerOptions);
    check('GET_ASSIGNMENTS: real GET /api/v1/tenant/education/assignments returned 200 (2 rows / 0 rows)', getOk,
      'has=' + (has.assignReq ? has.assignReq.status + '/' + has.assignCount : 'none') +
      ' empty=' + (empty.assignReq ? empty.assignReq.status + '/' + empty.assignCount : 'none'));
    check('ASSIGNMENT_RENDERING: rendered assignment rows with title/class/due date', hasRendered, hasRowsText.slice(0, 300));
    check('EMPTY_STATE: zero-assignment student renders the empty state (not a table)', emptyRendered, empty.listText.slice(0, 200));
    check('RTL: document dir=rtl and assignments card computed direction=rtl', rtlOk,
      'has=' + has.rtl.docDir + '/' + has.rtl.computed + ' empty=' + empty.rtl.docDir + '/' + empty.rtl.computed);
    check('STUDENT_WRITE_SURFACE: no write controls rendered (read-only product surface)', noWriteSurface,
      'has=' + has.writeControls + ' empty=' + empty.writeControls);

    report.STUDENT_WORKSPACE = workspaceOk ? 'PASS' : 'FAIL';
    report.STUDENT_PICKER = pickerOk ? 'PASS' : 'FAIL';
    report.GET_ASSIGNMENTS = getOk ? 'PASS' : 'FAIL';
    report.ASSIGNMENT_RENDERING = hasRendered ? 'PASS' : 'FAIL';
    report.EMPTY_STATE = emptyRendered ? 'PASS' : 'FAIL';
    report.RTL = rtlOk ? 'PASS' : 'FAIL';
    report.STUDENT_WRITE_SURFACE = noWriteSurface ? 'NOT_IMPLEMENTED_IN_PRODUCT' : 'FAIL';
    report.CONSOLE_ERRORS = String(allConsole.length);
    report.PAGE_ERRORS = String(allPage.length);
    report.FAILED_REQUESTS = allFailed.length ? JSON.stringify(allFailed.slice(0, 10)) : 'none';
    if (allConsole.length) console.log('CONSOLE_ERROR_DETAIL=' + JSON.stringify(allConsole.slice(0, 10)));
    if (allPage.length) console.log('PAGE_ERROR_DETAIL=' + JSON.stringify(allPage.slice(0, 10)));

    if (allConsole.length || allPage.length || allFailed.length) {
      console.log('NOTE: console/page/API errors observed; see detail above.');
    }
  } catch (err) {
    report.TEST_EXECUTED = browser ? 'YES' : 'NO';
    report.ERROR = err && err.stack ? err.stack.split('\n').slice(0, 6).join(' | ') : String(err);
    const missingDep = /Cannot find module '(express|dotenv)'/.test(String(err && err.message));
    if (missingDep) {
      report.BLOCKER = 'ENVIRONMENT_BLOCKER: backend runtime dependencies are not installed in this worktree (' +
        String(err.message) + '). Installing packages is prohibited by the Phase D scope.';
    } else {
      report.BLOCKER = 'EXECUTION_ERROR: ' + String(err && err.message);
    }
    console.error('EXECUTION_ERROR: ' + report.ERROR);
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (apiServer) await new Promise(r => apiServer.close(r)); } catch (_) {}
    try { if (staticServer) await new Promise(r => staticServer.close(r)); } catch (_) {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  const afterHash = sha256(TARGET_FILE);
  const scenarioPass = ['STUDENT_WORKSPACE', 'STUDENT_PICKER', 'GET_ASSIGNMENTS', 'ASSIGNMENT_RENDERING', 'EMPTY_STATE', 'RTL']
    .every(k => report[k] === 'PASS');
  const finalResult = report.BLOCKER !== 'none'
    ? 'BLOCKED'
    : (scenarioPass && report.PAGE_ERRORS === '0' && report.FAILED_REQUESTS === 'none' ? 'PASS' : 'FAIL');

  console.log('');
  console.log('STUDENT_ASSIGNMENTS_PHASE_D_RESULT');
  console.log('REPO_ROOT=' + report.REPO_ROOT);
  console.log('BRANCH=' + require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim());
  console.log('HEAD=' + require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim());
  console.log('TARGET_SHA256_BEFORE=' + beforeHash);
  console.log('TARGET_SHA256_AFTER=' + afterHash);
  console.log('BROWSER_STARTED=' + report.BROWSER_STARTED);
  console.log('TEST_EXECUTED=' + report.TEST_EXECUTED);
  console.log('STUDENT_WORKSPACE=' + report.STUDENT_WORKSPACE);
  console.log('STUDENT_PICKER=' + report.STUDENT_PICKER);
  console.log('GET_ASSIGNMENTS=' + report.GET_ASSIGNMENTS);
  console.log('ASSIGNMENT_RENDERING=' + report.ASSIGNMENT_RENDERING);
  console.log('EMPTY_STATE=' + report.EMPTY_STATE);
  console.log('ERROR_RETRY=' + report.ERROR_RETRY);
  console.log('RTL=' + report.RTL);
  console.log('STUDENT_WRITE_SURFACE=' + report.STUDENT_WRITE_SURFACE);
  console.log('CONSOLE_ERRORS=' + report.CONSOLE_ERRORS);
  console.log('PAGE_ERRORS=' + report.PAGE_ERRORS);
  console.log('FAILED_REQUESTS=' + report.FAILED_REQUESTS);
  console.log('BLOCKER=' + report.BLOCKER);
  console.log('FINAL_RESULT=' + finalResult);

  process.exitCode = finalResult === 'PASS' ? 0 : (finalResult === 'BLOCKED' ? 2 : 1);
  setTimeout(() => process.exit(process.exitCode), 400);
})();
