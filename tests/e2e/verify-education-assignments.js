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
// A second tenant with its own Owner is seeded so the submission routes can be
// probed for cross-tenant leakage over the same real HTTP surface the browser
// uses: 401 anonymous, 403 wrong-student, 400 field injection, 404 for another
// tenant's records. None of those probes is mocked.
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
const ARCHIVED_DESCRIPTION = 'Archived instructions with <b>markup</b> and <img src=x onerror="window.__eduXss=1">';

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

function signToken(userId, username, role, tenantId) {
  return jwt.sign({
    sub: String(userId),
    username,
    role: role || 'Viewer',
    tenantId: tenantId || 'asg-a',
    jti: crypto.randomUUID()
  }, JWT_SECRET, { expiresIn: '15m' });
}

function signStudentToken(userId, username) {
  return signToken(userId, username, 'Viewer');
}

const OWNER = { id: 'u-owner', username: 'asgOwner', role: 'Owner', tenantIds: ['asg-a'], tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP };
const STU1_USER = { id: 'u-s1', username: 'asgStudent1', role: 'Viewer', tenantIds: ['asg-a'], tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP };
const STU2_USER = { id: 'u-s2', username: 'asgStudent2', role: 'Viewer', tenantIds: ['asg-a'], tokenVersion: 0, createdAt: STAMP, updatedAt: STAMP };
const FOREIGN_OWNER = {
  id: 'u-ob', username: 'asgOwnerB', role: 'Owner', tenantIds: ['asg-b'], tokenVersion: 0,
  createdAt: STAMP, updatedAt: STAMP
};
const TEACHER_USER = {
  id: 'u-t1', username: 'asgTeacher', role: 'Viewer', tenantIds: ['asg-a'], tokenVersion: 0,
  permissions: [
    'education.classes.view', 'education.enrollments.view', 'education.students.view',
    'education.teachers.view', 'education.courses.view', 'education.scheduling.view',
    'education.grading.view', 'education.grading.edit'
  ],
  createdAt: STAMP, updatedAt: STAMP
};

function seedStores() {
  seed('companies', [
    { id: 'asg-a', name: 'Assignments Tenant', code: 'ASG', active: true, status: 'ACTIVE', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-b', name: 'Foreign Tenant', code: 'FGN', active: true, status: 'ACTIVE', createdAt: STAMP, updatedAt: STAMP }
  ]);
  seed('users', { users: [OWNER, STU1_USER, STU2_USER, FOREIGN_OWNER, TEACHER_USER] });
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
    { id: 'tch-a1', tenantId: 'asg-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP }
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
    { id: 'asg-2', tenantId: 'asg-a', classId: 'cls-a1', title: 'Quiz 1', description: 'Chapter 2', dueDate: '2026-03-08', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-3', tenantId: 'asg-a', classId: 'cls-a1', title: 'Archived Task', description: ARCHIVED_DESCRIPTION, dueDate: '2026-02-01', status: 'archived', createdAt: STAMP, updatedAt: STAMP }
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
      // agent:false keeps every proxied API call on its own connection, so a
      // socket the API server closed (see the deliberate outage in the
      // error/retry scenario) can never be reused for the next call.
      const proxied = http.request({ hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers, agent: false }, upstream => {
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

async function runScenario(browser, port, token, linkedId, expectRows, submit) {
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
  const listStatuses = await page.$$eval(
    '#edu-student-assignments-list [data-edu-assignment-status]',
    nodes => nodes.map(n => n.getAttribute('data-edu-assignment-status'))
  ).catch(() => []);

  const writeControls = await page.$$eval(
    '#edu-student-assignments input, #edu-student-assignments textarea, #edu-student-assignments select, #edu-student-assignments form, #edu-student-assignments button:not([data-edu-assignment-id])',
    nodes => nodes.length
  ).catch(() => -1);

  const details = {
    activeOpened: false, activeTitle: '', activeValues: [], activeStatus: '', activeWriteControls: -1,
    archivedOpened: false, archivedStatus: '', archivedValues: [], archivedInjected: false,
    archivedXss: true, detailWriteControls: -1, closed: false, focusReturned: false,
    responseOk: false
  };
  const submission = {
    formVisible: false, saveClicked: false, submitted: false, submittedStatus: '',
    content: '', updateVisible: false
  };

  if (expectRows) {
    const open = async (id) => {
      await page.click('button[data-edu-assignment-id="' + id + '"]');
      return page.waitForFunction(() => {
        const o = document.getElementById('edu-assignment-detail-overlay');
        const b = document.getElementById('edu-assignment-detail-body');
        return !!(o && o.classList.contains('is-open') && b && b.querySelector('.edu-detail-text'));
      }, null, { timeout: 20000 }).then(() => true, () => false);
    };
    const read = () => page.evaluate(() => {
      const body = document.getElementById('edu-assignment-detail-body');
      const status = body ? body.querySelector('[data-edu-assignment-status]') : null;
      return {
        title: (document.getElementById('edu-assignment-detail-title') || {}).textContent || '',
        values: body ? Array.from(body.querySelectorAll('.edu-detail-text')).map(n => n.textContent) : [],
        status: status ? status.getAttribute('data-edu-assignment-status') : '',
        injected: !!(body && body.querySelector('b, img, script, iframe, object')),
        writeControls: body ? body.querySelectorAll('input, textarea, select, form, button').length : -1,
        xss: typeof window.__eduXss !== 'undefined'
      };
    });

    details.activeOpened = await open('asg-1');
    // The submission card is fetched AFTER the detail body paints, so the write
    // surface is measured only once its save control exists. Without this wait
    // the count races the async render and intermittently reads 0 controls.
    await page.waitForSelector('#edu-assignment-submission-save', { timeout: 20000 }).catch(() => {});
    const activeData = await read();
    details.activeTitle = activeData.title;
    details.activeValues = activeData.values;
    details.activeStatus = activeData.status;
    details.activeWriteControls = activeData.writeControls;

    if (submit) {
      submission.formVisible = await page.waitForSelector('#edu-assignment-submission-content', { timeout: 20000 })
        .then(() => true, () => false);
      if (submission.formVisible) {
        await page.fill('#edu-assignment-submission-content', 'My browser answer');
        submission.saveClicked = true;
        await page.click('#edu-assignment-submission-save');
        submission.submitted = await page.waitForFunction(() => {
          const card = document.getElementById('edu-assignment-submission');
          return !!(card && card.querySelector('[data-edu-submission-status="submitted"]'));
        }, null, { timeout: 20000 }).then(() => true, () => false);
        submission.submittedStatus = await page.$eval(
          '#edu-assignment-submission [data-edu-submission-status]',
          n => n.getAttribute('data-edu-submission-status')
        ).catch(() => '');
        submission.content = await page.$$eval(
          '#edu-assignment-submission .edu-detail-text',
          nodes => (nodes[0] ? nodes[0].textContent : '')
        ).catch(() => '');
        submission.updateVisible = await page.$eval(
          '#edu-assignment-submission-save',
          n => !!(n && !n.disabled && String(n.textContent || '').trim())
        ).catch(() => false);
      }
    }

    await page.click('#edu-assignment-detail-done');
    details.closed = await page.waitForFunction(() => {
      const o = document.getElementById('edu-assignment-detail-overlay');
      return !!(o && !o.classList.contains('is-open') && o.getAttribute('aria-hidden') === 'true');
    }, null, { timeout: 10000 }).then(() => true, () => false);
    details.focusReturned = await page.evaluate(() => {
      const a = document.activeElement;
      return !!(a && a.getAttribute && a.getAttribute('data-edu-assignment-id') === 'asg-1');
    }).catch(() => false);

    details.archivedOpened = await open('asg-3');
    const archivedData = await read();
    details.archivedStatus = archivedData.status;
    details.archivedValues = archivedData.values;
    details.archivedInjected = archivedData.injected;
    details.archivedXss = archivedData.xss;
    details.detailWriteControls = archivedData.writeControls;
    await page.click('#edu-assignment-detail-close');
    await page.waitForFunction(() => {
      const o = document.getElementById('edu-assignment-detail-overlay');
      return !!(o && !o.classList.contains('is-open'));
    }, null, { timeout: 10000 }).catch(() => {});
  }

  const detailResponses = assignmentResponses.filter(r => /\/assignments\/asg-/.test(r.url));
  details.responseOk = detailResponses.length >= 2 && detailResponses.every(r => r.status === 200);

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
    rows, listText, cardPresent, rtl, listStatuses, writeControls, details, submission,
    assignReq, assignCount, consoleErrors, pageErrors, failedApi
  };
}

async function runTeacherScenario(browser, port, token) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedApi = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (typeof m.location === 'function' && m.location()) || {};
    consoleErrors.push({ text: m.text(), url: loc.url || '' });
  });
  page.on('response', res => {
    if (res.status() >= 400 && res.url().indexOf('/api/v1/') !== -1) {
      failedApi.push({ status: res.status(), url: res.url() });
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
  await page.goto(base + '/education/index.html#teacher', { waitUntil: 'load', timeout: 30000 });

  const cardVisible = await page.waitForSelector('#edu-teacher-submissions', { timeout: 25000 })
    .then(() => true, () => false);
  let optionReady = false;
  if (cardVisible) {
    optionReady = await page.waitForFunction(() => {
      const s = document.getElementById('edu-teacher-sub-assignment');
      if (!s) return false;
      return Array.from(s.options || []).some(o => o.value === 'asg-1');
    }, null, { timeout: 25000 }).then(() => true, () => false);
  }
  let rowsReady = false;
  let submittedText = '';
  let reviewed = false;
  let gradeValue = '';
  let feedbackValue = '';
  let reviewStatus = '';
  if (optionReady) {
    await page.selectOption('#edu-teacher-sub-assignment', 'asg-1');
    rowsReady = await page.waitForFunction(() => {
      const host = document.getElementById('edu-teacher-sub-rows');
      return !!(host && host.querySelectorAll('table tbody tr').length > 0);
    }, null, { timeout: 20000 }).then(() => true, () => false);
  }
  if (rowsReady) {
    submittedText = await page.$eval('#edu-teacher-sub-rows', n => n.textContent).catch(() => '');
    await page.fill('input[id^="edu-teacher-sub-grade-"]', 'A');
    await page.fill('textarea[id^="edu-teacher-sub-feedback-"]', 'Good work');
    await page.click('button[data-edu-submission-id]');
    reviewed = await page.waitForFunction(() => {
      const host = document.getElementById('edu-teacher-sub-rows');
      const status = host ? host.querySelector('[data-edu-submission-status]') : null;
      const grade = host ? host.querySelector('input[id^="edu-teacher-sub-grade-"]') : null;
      return !!(status && status.getAttribute('data-edu-submission-status') === 'reviewed' &&
        grade && grade.value === 'A');
    }, null, { timeout: 20000 }).then(() => true, () => false);
    if (reviewed) {
      reviewStatus = await page.$eval('#edu-teacher-sub-rows [data-edu-submission-status]',
        n => n.getAttribute('data-edu-submission-status')).catch(() => '');
      gradeValue = await page.$eval('input[id^="edu-teacher-sub-grade-"]', n => n.value).catch(() => '');
      feedbackValue = await page.$eval('textarea[id^="edu-teacher-sub-feedback-"]', n => n.value).catch(() => '');
    }
  }

  await context.close();
  return {
    cardVisible, optionReady, rowsReady, submittedText, reviewed, reviewStatus,
    gradeValue, feedbackValue, consoleErrors, pageErrors, failedApi
  };
}

async function runReviewedStudentScenario(browser, port, token) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedApi = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (typeof m.location === 'function' && m.location()) || {};
    consoleErrors.push({ text: m.text(), url: loc.url || '' });
  });
  page.on('response', res => {
    if (res.status() >= 400 && res.url().indexOf('/api/v1/') !== -1) {
      failedApi.push({ status: res.status(), url: res.url() });
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

  const listReady = await page.waitForFunction(() => {
    const l = document.getElementById('edu-student-assignments-list');
    return !!(l && l.querySelector('button[data-edu-assignment-id="asg-1"]'));
  }, null, { timeout: 25000 }).then(() => true, () => false);
  let opened = false;
  let status = '';
  let values = [];
  let textareaCount = -1;
  if (listReady) {
    await page.click('button[data-edu-assignment-id="asg-1"]');
    opened = await page.waitForFunction(() => {
      const card = document.getElementById('edu-assignment-submission');
      const statusNode = card ? card.querySelector('[data-edu-submission-status]') : null;
      return !!(statusNode && statusNode.getAttribute('data-edu-submission-status') === 'reviewed');
    }, null, { timeout: 20000 }).then(() => true, () => false);
    if (opened) {
      status = await page.$eval('#edu-assignment-submission [data-edu-submission-status]',
        n => n.getAttribute('data-edu-submission-status')).catch(() => '');
      values = await page.$$eval('#edu-assignment-submission .edu-detail-text',
        nodes => nodes.map(n => n.textContent)).catch(() => []);
      textareaCount = await page.$$eval('#edu-assignment-submission textarea', nodes => nodes.length)
        .catch(() => -1);
    }
    await page.click('#edu-assignment-detail-close').catch(() => {});
  }

  await context.close();
  return { listReady, opened, status, values, textareaCount, consoleErrors, pageErrors, failedApi };
}

async function runResponsiveScenario(browser, port, token) {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'mobile', width: 390, height: 844 }
  ];
  const out = { checks: [], consoleErrors: [], pageErrors: [], failedApi: [] };
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.on('pageerror', e => out.pageErrors.push({ viewport: viewport.name, text: e.message }));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const loc = (typeof m.location === 'function' && m.location()) || {};
      out.consoleErrors.push({ viewport: viewport.name, text: m.text(), url: loc.url || '' });
    });
    page.on('response', res => {
      if (res.status() >= 400 && res.url().indexOf('/api/v1/') !== -1) {
        out.failedApi.push({ viewport: viewport.name, status: res.status(), url: res.url() });
      }
    });
    await page.addInitScript(t => {
      try {
        localStorage.setItem('access_token', t);
        localStorage.setItem('omnistore_language', 'ar');
        localStorage.setItem('omnistore_platform_lang', 'ar');
      } catch (_) {}
    }, token);
    await page.goto('http://127.0.0.1:' + port + '/education/index.html#student', { waitUntil: 'load', timeout: 30000 });
    const listReady = await page.waitForFunction(() => {
      const l = document.getElementById('edu-student-assignments-list');
      return !!(l && l.querySelector('button[data-edu-assignment-id="asg-1"]'));
    }, null, { timeout: 25000 }).then(() => true, () => false);
    let layout = null;
    let detail = null;
    if (listReady) {
      layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const card = document.getElementById('edu-student-assignments');
        return {
          scrollWidth: Math.max(doc.scrollWidth, body ? body.scrollWidth : 0),
          innerWidth: window.innerWidth,
          cardVisible: !!(card && card.getBoundingClientRect().width > 0),
          rowCount: card ? card.querySelectorAll('table tbody tr').length : 0
        };
      });
      await page.click('button[data-edu-assignment-id="asg-1"]');
      const detailReady = await page.waitForSelector('#edu-assignment-detail-overlay.is-open #edu-assignment-submission-card', { timeout: 20000 })
        .then(() => true, () => false);
      if (detailReady) {
        detail = await page.evaluate(() => {
          const dialog = document.querySelector('#edu-assignment-detail-overlay .edu-dialog');
          const card = document.getElementById('edu-assignment-submission-card');
          const rect = dialog ? dialog.getBoundingClientRect() : null;
          return {
            visible: !!(card && card.getBoundingClientRect().width > 0),
            dialogWidth: rect ? Math.round(rect.width) : 0,
            dialogLeft: rect ? Math.round(rect.left) : -1,
            dialogRight: rect ? Math.round(rect.right) : -1,
            innerWidth: window.innerWidth,
            textareaCount: card ? card.querySelectorAll('textarea').length : -1
          };
        });
      }
      await page.click('#edu-assignment-detail-close').catch(() => {});
    }
    out.checks.push({ viewport: viewport.name, listReady, layout, detail });
    await context.close();
  }
  return out;
}

async function runLtrScenario(browser, port, token) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    consoleErrors.push(m.text());
  });
  await page.addInitScript(t => {
    try {
      localStorage.setItem('access_token', t);
      localStorage.setItem('omnistore_language', 'en');
      localStorage.setItem('omnistore_platform_lang', 'en');
    } catch (_) {}
  }, token);
  await page.goto('http://127.0.0.1:' + port + '/education/index.html#student', { waitUntil: 'load', timeout: 30000 });
  const listReady = await page.waitForFunction(() => {
    const l = document.getElementById('edu-student-assignments-list');
    return !!(l && l.querySelector('button[data-edu-assignment-id="asg-1"]'));
  }, null, { timeout: 25000 }).then(() => true, () => false);
  const result = await page.evaluate(() => {
    const card = document.getElementById('edu-student-assignments');
    return {
      docDir: document.documentElement.getAttribute('dir') || '',
      computed: card ? getComputedStyle(card).direction : '',
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  }).catch(() => ({ docDir: '', computed: '', scrollWidth: -1, innerWidth: -1 }));
  await context.close();
  return Object.assign({ listReady, consoleErrors, pageErrors }, result);
}

// ---------------------------------------------------------------------------
// ERROR / RETRY. A real outage, not an intercepted route: the Express app is
// stopped, so the page's next read through the static proxy meets a real
// connection failure, and it is restarted on the same port so the retry the
// page offers can actually recover. Nothing is stubbed and the page is never
// reloaded, so the banner asserted here is the one a user would meet.
// ---------------------------------------------------------------------------
function stopApiServer(server) {
  return new Promise(resolve => {
    try { if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections(); } catch (_) {}
    try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch (_) {}
    server.close(() => resolve());
  });
}

// Rebinding the port the proxy already targets. The short retry loop only
// absorbs the moment between close and the OS releasing the listener; if the
// port never comes back the scenario fails instead of pretending otherwise.
async function listenOnPort(app, port, attempts) {
  const tries = attempts || 12;
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const server = app.listen(port, '127.0.0.1');
        server.on('listening', () => resolve(server));
        server.on('error', reject);
      });
    } catch (err) {
      lastErr = err;
      if (err && err.code !== 'EADDRINUSE') throw err;
      await new Promise(r => setTimeout(r, 150));
    }
  }
  throw lastErr || new Error('could not rebind the API port');
}

async function runErrorRetryScenario(browser, port, api, lang, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  let outage = false;
  const unexpectedConsole = [];
  const unexpectedFailed = [];
  const pageErrors = [];

  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // While the app is deliberately stopped Chromium logs the failed resource.
    // Every other console error, before or after, still counts as a defect.
    const expected = outage && /Failed to load resource/.test(text);
    if (!expected) unexpectedConsole.push(text.slice(0, 200));
  });
  page.on('response', res => {
    const url = res.url();
    if (url.indexOf('/api/v1/') === -1 || res.status() < 400) return;
    if (outage && res.status() === 502) return;
    unexpectedFailed.push({ status: res.status(), url: url.slice(0, 120) });
  });

  await page.addInitScript((cfg) => {
    try {
      localStorage.setItem('access_token', cfg.token);
      localStorage.setItem('omnistore_language', cfg.lang);
      localStorage.setItem('omnistore_platform_lang', cfg.lang);
    } catch (_) {}
  }, { token: signStudentToken('u-s1', 'asgStudent1'), lang });

  const base = 'http://127.0.0.1:' + port;
  await page.goto(base + '/education/index.html#student', { waitUntil: 'load', timeout: 30000 });

  const baseline = await page.waitForFunction(() => {
    const list = document.getElementById('edu-student-assignments-list');
    return !!(list && list.querySelector('button[data-edu-assignment-id="asg-1"]'));
  }, null, { timeout: 25000 }).then(() => true, () => false);

  await stopApiServer(api.server);
  outage = true;

  // A linked student's picker lists only their own record, so the blank entry
  // forces a real change event and the student is then chosen again. Each
  // selection re-runs the same reads the first paint used, now against a
  // stopped service.
  const cleared = await page.selectOption('#edu-student-picker', '').then(() => true, () => false);
  const reselected = await page.selectOption('#edu-student-picker', 'stu-1').then(() => true, () => false);
  const bannerShown = await page.waitForSelector('#edu-student-detail .edu-banner-error', { timeout: 25000 })
    .then(() => true, () => false);
  const banner = bannerShown
    ? await page.$eval('#edu-student-detail .edu-banner-error', n => ({
      text: (n.textContent || '').trim().slice(0, 160),
      buttons: n.querySelectorAll('button').length
    })).catch(() => ({ text: '', buttons: 0 }))
    : { text: '', buttons: 0 };
  const retryVisible = await page.isVisible('#edu-student-detail .edu-banner-error button').catch(() => false);
  // A failed read must never be painted as "no assignments": the card is
  // absent entirely rather than rendering a misleading empty state.
  const noFakeEmpty = await page.$('#edu-student-assignments').then(node => !node).catch(() => false);
  // The banner and its control have to be usable at the tested viewport, not
  // merely present in the DOM.
  const bannerBox = retryVisible
    ? await page.$eval('#edu-student-detail .edu-banner-error', n => {
      const b = n.getBoundingClientRect();
      const btn = n.querySelector('button');
      const r = btn ? btn.getBoundingClientRect() : null;
      return {
        bannerWidth: b.width,
        buttonWidth: r ? r.width : 0,
        buttonLeft: r ? r.left : -1,
        buttonRight: r ? r.right : -1,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
    }).catch(() => null)
    : null;
  const retryFits = !!(bannerBox && bannerBox.bannerWidth > 0 && bannerBox.buttonWidth > 0 &&
    bannerBox.buttonLeft >= 0 && bannerBox.buttonRight <= bannerBox.innerWidth + 1 &&
    bannerBox.scrollWidth <= bannerBox.innerWidth + 1);

  // Let the failed-resource console entries land while the outage is still the
  // thing that explains them.
  await page.waitForTimeout(700);
  outage = false;

  api.server = await listenOnPort(api.app, api.port);
  const clicked = retryVisible
    ? await page.click('#edu-student-detail .edu-banner-error button').then(() => true, () => false)
    : false;

  const recovered = await page.waitForFunction(() => {
    const detail = document.getElementById('edu-student-detail');
    const card = document.getElementById('edu-student-assignments');
    if (!card) return false;
    if (detail && detail.querySelector('.edu-banner-error')) return false;
    const list = document.getElementById('edu-student-assignments-list');
    return !!(list && list.querySelector('button[data-edu-assignment-id="asg-1"]'));
  }, null, { timeout: 25000 }).then(() => true, () => false);

  const layout = await page.evaluate(() => ({
    docDir: document.documentElement.getAttribute('dir') || '',
    cardDir: (() => {
      const card = document.getElementById('edu-student-detail');
      return card ? getComputedStyle(card).direction : '';
    })(),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  })).catch(() => ({ docDir: '', cardDir: '', scrollWidth: -1, innerWidth: -1 }));

  await context.close();

  const dirOk = lang === 'ar'
    ? (layout.docDir === 'rtl' && layout.cardDir === 'rtl')
    : (layout.docDir === 'ltr' && layout.cardDir === 'ltr');
  const ok = baseline && cleared && reselected && bannerShown &&
    banner.buttons === 1 && banner.text.length > 0 &&
    retryVisible && retryFits && noFakeEmpty && clicked && recovered && dirOk &&
    layout.scrollWidth <= layout.innerWidth + 1 &&
    unexpectedConsole.length === 0 && unexpectedFailed.length === 0 && pageErrors.length === 0;

  return {
    lang, ok, baseline, cleared, reselected, bannerShown, clicked, recovered, noFakeEmpty, dirOk,
    retryFits, viewport: viewport || null, bannerBox,
    bannerButtons: banner.buttons, bannerText: banner.text,
    docDir: layout.docDir, cardDir: layout.cardDir,
    scrollWidth: layout.scrollWidth, innerWidth: layout.innerWidth,
    unexpectedConsole, unexpectedFailed, pageErrors
  };
}

const EDU = '/api/v1/tenant/education';

// One real HTTP call against the same origin the browser uses (the static
// proxy forwards /api/ to the booted Express app). No interception.
function httpJson(port, method, urlPath, token, body) {
  return new Promise(resolve => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, res => {
      let text = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (_) { json = null; }
        resolve({ status: res.statusCode, body: json, text: text.slice(0, 400) });
      });
    });
    req.on('error', err => resolve({ status: 0, body: null, text: 'REQUEST_ERROR: ' + err.message }));
    req.setTimeout(15000, () => { req.destroy(new Error('request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Tenant / ownership isolation on the submission routes. Runs BEFORE the
// browser scenarios so no submission exists yet: the injected-body case must
// therefore fail on validation (400), not on the reviewed lock (409).
async function runIsolationChecks(port) {
  const stu1 = signStudentToken('u-s1', 'asgStudent1');
  const stu2 = signStudentToken('u-s2', 'asgStudent2');
  const foreign = signToken('u-ob', 'asgOwnerB', 'Owner', 'asg-b');
  const anonRead = await httpJson(port, 'GET', EDU + '/assignments/asg-1/submissions');
  const stu2Read = await httpJson(port, 'GET', EDU + '/assignments/asg-1/submissions', stu2);
  const stu2Write = await httpJson(port, 'PUT', EDU + '/assignments/asg-1/submission', stu2, { content: 'Hijack' });
  const injected = await httpJson(port, 'PUT', EDU + '/assignments/asg-1/submission', stu1, { content: 'Mine', tenantId: 'asg-b' });
  const foreignRead = await httpJson(port, 'GET', EDU + '/assignments/asg-1/submissions', foreign);
  const foreignReview = await httpJson(port, 'PATCH', EDU + '/assignments/asg-1/submissions/any/review', foreign, { grade: 'A' });
  const denied = [stu2Read, stu2Write, foreignRead, foreignReview];
  const noPayload = denied.every(r => !r.body || r.body.data === undefined || r.body.data === null);
  return { anonRead, stu2Read, stu2Write, injected, foreignRead, foreignReview, noPayload };
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
    ASSIGNMENT_DETAILS: 'NOT_COVERED',
    ARCHIVED_STATUS: 'NOT_COVERED',
    SAFE_TEXT_RENDERING: 'NOT_COVERED',
    DETAILS_CLOSE: 'NOT_COVERED',
    DETAILS_WRITE_SURFACE: 'NOT_COVERED',
    STUDENT_SUBMISSION: 'NOT_COVERED',
    TEACHER_REVIEW: 'NOT_COVERED',
    REVIEWED_LOCK: 'NOT_COVERED',
    EMPTY_STATE: 'NOT_COVERED',
    ERROR_RETRY: 'NOT_TESTABLE_WITHOUT_PRODUCT_OR_MOCK_CHANGES',
    RTL: 'NOT_COVERED',
    RTL_LTR: 'NOT_COVERED',
    UI_UX_DESKTOP_TABLET_MOBILE: 'NOT_COVERED',
    STUDENT_WRITE_SURFACE: 'NOT_COVERED',
    TENANT_ISOLATION: 'NOT_COVERED',
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
    // Handle used by the outage scenario to stop and rebind the SAME app on the
    // SAME port the proxy targets, so recovery is real rather than simulated.
    const api = { app, port: apiPort, server: apiServer };

    const isolation = await runIsolationChecks(port);

    browser = await chromium.launch();
    report.BROWSER_STARTED = 'PASS';
    report.TEST_EXECUTED = 'YES';

    const has = await runScenario(browser, port, signStudentToken('u-s1', 'asgStudent1'), 'stu-1', true, true);
    const empty = await runScenario(browser, port, signStudentToken('u-s2', 'asgStudent2'), 'stu-2', false, false);
    const teacher = await runTeacherScenario(browser, port, signToken('u-t1', 'asgTeacher', 'Viewer'));
    const reviewedStu = await runReviewedStudentScenario(browser, port, signStudentToken('u-s1', 'asgStudent1'));
    const responsive = await runResponsiveScenario(browser, port, signStudentToken('u-s1', 'asgStudent1'));
    const ltr = await runLtrScenario(browser, port, signStudentToken('u-s1', 'asgStudent1'));
    // Desktop RTL and phone-width LTR, so the banner and its retry are proven
    // in both directions and at both ends of the supported width range.
    const retryRtl = await runErrorRetryScenario(browser, port, api, 'ar', { width: 1280, height: 800 });
    const retryLtr = await runErrorRetryScenario(browser, port, api, 'en', { width: 390, height: 844 });
    // The outage scenario stops and restarts the app, so the cleanup must close
    // whichever server instance is live at the end.
    apiServer = api.server;

    const hasRowsText = has.rows.join(' | ');
    const hasRendered = has.listOk && has.rows.length === 3 &&
      hasRowsText.indexOf('Homework 1') !== -1 && hasRowsText.indexOf('Quiz 1') !== -1 &&
      hasRowsText.indexOf('Archived Task') !== -1 &&
      hasRowsText.indexOf('Algebra A1') !== -1 && hasRowsText.indexOf('2026-03-01') !== -1;
    const emptyRendered = empty.listOk && empty.rows.length === 0 &&
      /No assignments|لا توجد واجبات/.test(empty.listText);
    const getOk = !!(has.assignReq && has.assignReq.status === 200 && has.assignCount === 3 &&
      empty.assignReq && empty.assignReq.status === 200 && empty.assignCount === 0);
    const detailsOk = has.details.activeOpened && has.details.activeTitle === 'Homework 1' &&
      has.details.activeValues[0] === 'Homework 1' && has.details.activeValues[1] === 'Algebra A1' &&
      has.details.activeValues[2] === '2026-03-01' && has.details.activeValues[3] === 'Page 10' &&
      has.details.activeStatus === 'active' && has.details.responseOk;
    const archivedOk = has.details.archivedOpened && has.details.archivedStatus === 'archived' &&
      has.details.archivedValues[0] === 'Archived Task' &&
      has.listStatuses.filter(s => s === 'archived').length === 1 &&
      has.listStatuses.filter(s => s === 'active').length === 2;
    const safeTextOk = has.details.archivedOpened && has.details.archivedInjected === false &&
      has.details.archivedXss === false &&
      has.details.archivedValues[3] === ARCHIVED_DESCRIPTION;
    const detailsCloseOk = has.details.closed && has.details.focusReturned;
    const detailSurfaceOk = has.details.activeWriteControls >= 2 && has.details.detailWriteControls === 0;
    const submissionOk = has.submission.formVisible && has.submission.saveClicked &&
      has.submission.submitted && has.submission.submittedStatus === 'submitted' &&
      has.submission.content === 'My browser answer' && has.submission.updateVisible;
    const teacherOk = teacher.cardVisible && teacher.optionReady && teacher.rowsReady &&
      teacher.submittedText.indexOf('My browser answer') !== -1 &&
      teacher.reviewed && teacher.reviewStatus === 'reviewed' &&
      teacher.gradeValue === 'A' && teacher.feedbackValue === 'Good work';
    const reviewedOk = reviewedStu.listReady && reviewedStu.opened &&
      reviewedStu.status === 'reviewed' && reviewedStu.values[0] === 'My browser answer' &&
      reviewedStu.values[1] === 'A' && reviewedStu.values[2] === 'Good work' &&
      reviewedStu.textareaCount === 0;
    const pickerOk = has.pickerOk && empty.pickerOk &&
      has.pickerValue === 'stu-1' && empty.pickerValue === 'stu-2' && has.pickerOptions >= 2;
    const rtlOk = has.rtl.docDir === 'rtl' && has.rtl.computed === 'rtl' &&
      empty.rtl.docDir === 'rtl' && empty.rtl.computed === 'rtl';
    const workspaceOk = has.workspaceOk && empty.workspaceOk && has.cardPresent && empty.cardPresent;
    const noWriteSurface = has.writeControls === 0 && empty.writeControls === 0;
    const isolationOk = isolation.anonRead.status === 401 &&
      isolation.stu2Read.status === 403 && isolation.stu2Write.status === 403 &&
      isolation.injected.status === 400 &&
      isolation.foreignRead.status === 404 && isolation.foreignReview.status === 404 &&
      isolation.noPayload;
    const responsiveOk = responsive.checks.length === 3 && responsive.checks.every(row =>
      row.listReady && row.layout &&
      row.layout.scrollWidth <= row.layout.innerWidth + 1 &&
      row.layout.cardVisible && row.layout.rowCount === 3 &&
      row.detail && row.detail.visible &&
      row.detail.dialogLeft >= 0 && row.detail.dialogRight <= row.detail.innerWidth + 1 &&
      row.detail.textareaCount === 0);
    const ltrOk = ltr.listReady && ltr.docDir === 'ltr' && ltr.computed === 'ltr' &&
      ltr.scrollWidth <= ltr.innerWidth + 1;
    const errorRetryOk = retryRtl.ok && retryLtr.ok;

    const allConsole = has.consoleErrors.concat(empty.consoleErrors, teacher.consoleErrors,
      reviewedStu.consoleErrors, responsive.consoleErrors, ltr.consoleErrors);
    const allPage = has.pageErrors.concat(empty.pageErrors, teacher.pageErrors,
      reviewedStu.pageErrors, responsive.pageErrors, ltr.pageErrors);
    const allFailed = has.failedApi.concat(empty.failedApi, teacher.failedApi,
      reviewedStu.failedApi, responsive.failedApi);

    check('STUDENT_WORKSPACE: section#edu-body-student opened for both linked students', workspaceOk);
    check('STUDENT_PICKER: #edu-student-picker present and preselects the linked student', pickerOk,
      'has=' + has.pickerValue + ' empty=' + empty.pickerValue + ' options=' + has.pickerOptions);
    check('GET_ASSIGNMENTS: real GET /api/v1/tenant/education/assignments returned 200 (3 rows / 0 rows)', getOk,
      'has=' + (has.assignReq ? has.assignReq.status + '/' + has.assignCount : 'none') +
      ' empty=' + (empty.assignReq ? empty.assignReq.status + '/' + empty.assignCount : 'none'));
    check('ASSIGNMENT_RENDERING: rendered assignment rows with title/class/due date', hasRendered, hasRowsText.slice(0, 300));
    check('ASSIGNMENT_DETAILS: row opens the server-authorised detail with title/description/class/due', detailsOk,
      'opened=' + has.details.activeOpened + ' title=' + has.details.activeTitle +
      ' values=' + JSON.stringify(has.details.activeValues) + ' status=' + has.details.activeStatus +
      ' responses=' + has.details.responseOk);
    check('ARCHIVED_STATUS: archived assignment is labelled in the list and the details', archivedOk,
      'list=' + JSON.stringify(has.listStatuses) + ' detail=' + has.details.archivedStatus);
    check('SAFE_TEXT_RENDERING: description markup stays inert text', safeTextOk,
      'injected=' + has.details.archivedInjected + ' xss=' + has.details.archivedXss +
      ' text=' + JSON.stringify(has.details.archivedValues.slice(3)));
    check('DETAILS_CLOSE: dialog closes and focus returns to the row control', detailsCloseOk,
      'closed=' + has.details.closed + ' focused=' + has.details.focusReturned);
    check('DETAILS_WRITE_SURFACE: active assignment has the submission form; archived has none', detailSurfaceOk,
      'active=' + has.details.activeWriteControls + ' archived=' + has.details.detailWriteControls);
    check('STUDENT_SUBMISSION: linked student saves content through the real PUT route', submissionOk,
      JSON.stringify(has.submission));
    check('TEACHER_REVIEW: linked teacher reads and reviews the submission in the UI', teacherOk,
      'card=' + teacher.cardVisible + ' options=' + teacher.optionReady + ' rows=' + teacher.rowsReady +
      ' reviewed=' + teacher.reviewed + ' status=' + teacher.reviewStatus +
      ' grade=' + teacher.gradeValue + ' feedback=' + teacher.feedbackValue);
    check('REVIEWED_LOCK: reviewed submission is read-only for the student with grade and feedback', reviewedOk,
      'opened=' + reviewedStu.opened + ' status=' + reviewedStu.status +
      ' values=' + JSON.stringify(reviewedStu.values) + ' textareas=' + reviewedStu.textareaCount);
    check('EMPTY_STATE: zero-assignment student renders the empty state (not a table)', emptyRendered, empty.listText.slice(0, 200));
    check('RTL: document dir=rtl and assignments card computed direction=rtl', rtlOk,
      'has=' + has.rtl.docDir + '/' + has.rtl.computed + ' empty=' + empty.rtl.docDir + '/' + empty.rtl.computed);
    check('UI_UX_DESKTOP_TABLET_MOBILE: list and dialog fit without horizontal overflow', responsiveOk,
      JSON.stringify(responsive.checks));
    check('RTL_LTR: English locale renders LTR without horizontal overflow', ltrOk,
      'list=' + ltr.listReady + ' dir=' + ltr.docDir + '/' + ltr.computed +
      ' width=' + ltr.scrollWidth + '/' + ltr.innerWidth);
    check('STUDENT_WRITE_SURFACE: assignment list renders no write controls', noWriteSurface,
      'has=' + has.writeControls + ' empty=' + empty.writeControls);
    check('ERROR_RETRY: a stopped service shows an error with a retry that recovers (RTL + LTR)', errorRetryOk,
      'rtl=' + JSON.stringify({
        baseline: retryRtl.baseline, cleared: retryRtl.cleared, reselected: retryRtl.reselected,
        banner: retryRtl.bannerShown, buttons: retryRtl.bannerButtons,
        clicked: retryRtl.clicked, recovered: retryRtl.recovered, noFakeEmpty: retryRtl.noFakeEmpty,
        retryFits: retryRtl.retryFits, dir: retryRtl.docDir + '/' + retryRtl.cardDir,
        unexpectedFailed: retryRtl.unexpectedFailed.length,
        unexpectedConsole: retryRtl.unexpectedConsole.length, pageErrors: retryRtl.pageErrors.length
      }) +
      ' ltr=' + JSON.stringify({
        baseline: retryLtr.baseline, cleared: retryLtr.cleared, reselected: retryLtr.reselected,
        banner: retryLtr.bannerShown, buttons: retryLtr.bannerButtons,
        clicked: retryLtr.clicked, recovered: retryLtr.recovered, noFakeEmpty: retryLtr.noFakeEmpty,
        retryFits: retryLtr.retryFits, dir: retryLtr.docDir + '/' + retryLtr.cardDir,
        unexpectedFailed: retryLtr.unexpectedFailed.length,
        unexpectedConsole: retryLtr.unexpectedConsole.length, pageErrors: retryLtr.pageErrors.length
      }));
    check('TENANT_ISOLATION: anonymous 401, wrong-student 403, field injection 400, foreign tenant 404', isolationOk,
      'anon=' + isolation.anonRead.status + ' stu2.read=' + isolation.stu2Read.status +
      ' stu2.write=' + isolation.stu2Write.status + ' inject=' + isolation.injected.status +
      ' foreign.read=' + isolation.foreignRead.status + ' foreign.review=' + isolation.foreignReview.status +
      ' noPayload=' + isolation.noPayload);

    report.STUDENT_WORKSPACE = workspaceOk ? 'PASS' : 'FAIL';
    report.STUDENT_PICKER = pickerOk ? 'PASS' : 'FAIL';
    report.GET_ASSIGNMENTS = getOk ? 'PASS' : 'FAIL';
    report.ASSIGNMENT_RENDERING = hasRendered ? 'PASS' : 'FAIL';
    report.ASSIGNMENT_DETAILS = detailsOk ? 'PASS' : 'FAIL';
    report.ARCHIVED_STATUS = archivedOk ? 'PASS' : 'FAIL';
    report.SAFE_TEXT_RENDERING = safeTextOk ? 'PASS' : 'FAIL';
    report.DETAILS_CLOSE = detailsCloseOk ? 'PASS' : 'FAIL';
    report.DETAILS_WRITE_SURFACE = detailSurfaceOk ? 'PASS' : 'FAIL';
    report.STUDENT_SUBMISSION = submissionOk ? 'PASS' : 'FAIL';
    report.TEACHER_REVIEW = teacherOk ? 'PASS' : 'FAIL';
    report.REVIEWED_LOCK = reviewedOk ? 'PASS' : 'FAIL';
    report.EMPTY_STATE = emptyRendered ? 'PASS' : 'FAIL';
    report.RTL = rtlOk ? 'PASS' : 'FAIL';
    report.RTL_LTR = ltrOk ? 'PASS' : 'FAIL';
    report.UI_UX_DESKTOP_TABLET_MOBILE = responsiveOk ? 'PASS' : 'FAIL';
    report.STUDENT_WRITE_SURFACE = noWriteSurface ? 'PASS' : 'FAIL';
    report.TENANT_ISOLATION = isolationOk ? 'PASS' : 'FAIL';
    report.ERROR_RETRY = errorRetryOk ? 'PASS' : 'FAIL';
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
  const scenarioPass = ['STUDENT_WORKSPACE', 'STUDENT_PICKER', 'GET_ASSIGNMENTS', 'ASSIGNMENT_RENDERING',
    'ASSIGNMENT_DETAILS', 'ARCHIVED_STATUS', 'SAFE_TEXT_RENDERING', 'DETAILS_CLOSE',
    'DETAILS_WRITE_SURFACE', 'STUDENT_SUBMISSION', 'TEACHER_REVIEW', 'REVIEWED_LOCK',
    'EMPTY_STATE', 'RTL', 'RTL_LTR', 'UI_UX_DESKTOP_TABLET_MOBILE', 'TENANT_ISOLATION', 'ERROR_RETRY']
    .every(k => report[k] === 'PASS');
  const finalResult = report.BLOCKER !== 'none'
    ? 'BLOCKED'
    : (scenarioPass && report.PAGE_ERRORS === '0' && report.FAILED_REQUESTS === 'none' ? 'PASS' : 'FAIL');

  console.log('');
  console.log('STUDENT_ASSIGNMENT_DETAILS_PHASE_I_A_RESULT');
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
  console.log('ASSIGNMENT_DETAILS=' + report.ASSIGNMENT_DETAILS);
  console.log('ARCHIVED_STATUS=' + report.ARCHIVED_STATUS);
  console.log('SAFE_TEXT_RENDERING=' + report.SAFE_TEXT_RENDERING);
  console.log('DETAILS_CLOSE=' + report.DETAILS_CLOSE);
  console.log('DETAILS_WRITE_SURFACE=' + report.DETAILS_WRITE_SURFACE);
  console.log('STUDENT_SUBMISSION=' + report.STUDENT_SUBMISSION);
  console.log('TEACHER_REVIEW=' + report.TEACHER_REVIEW);
  console.log('REVIEWED_LOCK=' + report.REVIEWED_LOCK);
  console.log('EMPTY_STATE=' + report.EMPTY_STATE);
  console.log('ERROR_RETRY=' + report.ERROR_RETRY);
  console.log('RTL=' + report.RTL);
  console.log('RTL_LTR=' + report.RTL_LTR);
  console.log('UI_UX_DESKTOP_TABLET_MOBILE=' + report.UI_UX_DESKTOP_TABLET_MOBILE);
  console.log('STUDENT_WRITE_SURFACE=' + report.STUDENT_WRITE_SURFACE);
  console.log('TENANT_ISOLATION=' + report.TENANT_ISOLATION);
  console.log('CONSOLE_ERRORS=' + report.CONSOLE_ERRORS);
  console.log('PAGE_ERRORS=' + report.PAGE_ERRORS);
  console.log('FAILED_REQUESTS=' + report.FAILED_REQUESTS);
  console.log('BLOCKER=' + report.BLOCKER);
  console.log('FINAL_RESULT=' + finalResult);

  process.exitCode = finalResult === 'PASS' ? 0 : (finalResult === 'BLOCKED' ? 2 : 1);
  setTimeout(() => process.exit(process.exitCode), 400);
})();
