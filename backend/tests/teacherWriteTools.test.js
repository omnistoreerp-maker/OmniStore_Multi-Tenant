'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EDUCATION_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'platform', 'education', 'education.js'), 'utf-8');

function extractFunction(name) {
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(EDUCATION_JS);
  if (!match) throw new Error('function not found: ' + name);
  const open = EDUCATION_JS.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < EDUCATION_JS.length; i++) {
    if (EDUCATION_JS[i] === '{') depth++;
    else if (EDUCATION_JS[i] === '}') {
      depth--;
      if (depth === 0) return EDUCATION_JS.slice(match.index, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

function createMockDocument() {
  const nodes = [];
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      id: null,
      className: '',
      textContent: '',
      innerHTML: '',
      value: '',
      type: '',
      dir: '',
      disabled: false,
      maxLength: null,
      placeholder: '',
      children: [],
      attributes: {},
      eventListeners: {},
      appendChild(child) {
        this.children.push(child);
        if (child && typeof child === 'string') {
          this.textContent += child;
        } else if (child && child.textContent) {
          this.textContent += child.textContent;
        }
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
        if (name === 'id') this.id = value;
        if (name === 'class') this.className = value;
        if (name === 'type') this.type = value;
        if (name === 'dir') this.dir = value;
        if (name === 'disabled') this.disabled = true;
        if (name === 'maxlength') this.maxLength = parseInt(value, 10);
        if (name === 'placeholder') this.placeholder = value;
        if (name === 'for') this.attributes.for = value;
        if (name === 'aria-label') this.attributes['aria-label'] = value;
      },
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      addEventListener(event, handler) {
        this.eventListeners[event] = this.eventListeners[event] || [];
        this.eventListeners[event].push(handler);
      },
      querySelector(selector) {
        function findIn(node) {
          if (typeof node === 'string') return null;
          if (selector.startsWith('#')) {
            if (node.id === selector.slice(1)) return node;
          } else if (selector.startsWith('.') && node.attributes && node.attributes.class) {
            const classes = selector.slice(1).split('.');
            const nodeClasses = (node.attributes.class || '').split(' ');
            if (classes.every(c => nodeClasses.includes(c))) return node;
          }
          if (node.children) {
            for (const child of node.children) {
              const found = findIn(child);
              if (found) return found;
            }
          }
          return null;
        }
        return findIn(this);
      },
      querySelectorAll(selector) {
        const results = [];
        function walk(node) {
          if (typeof node === 'string') return;
          if (selector.startsWith('#')) {
            if (node.id === selector.slice(1)) results.push(node);
          } else if (selector.startsWith('.') && node.attributes && node.attributes.class) {
            const classes = selector.slice(1).split('.');
            const nodeClasses = (node.attributes.class || '').split(' ');
            if (classes.every(c => nodeClasses.includes(c))) results.push(node);
          }
          if (node.children) {
            node.children.forEach(walk);
          }
        }
        walk(this);
        return results;
      }
    };
    nodes.push(el);
    return el;
  }
  function createTextNode(text) {
    return { textContent: text, nodeType: 3 };
  }
  return {
    createElement,
    createTextNode,
    nodes,
    getElementById(id) {
      return nodes.find(n => n.id === id) || null;
    }
  };
}

function runInSandbox(fnSource, sandbox) {
  const doc = createMockDocument();
  function el(tag, className, html) {
    const node = doc.createElement(tag);
    if (className) node.setAttribute('class', className);
    if (html) node.innerHTML = html;
    return node;
  }
  function explain(err) {
    return err && err.message ? err.message : 'Operation failed.';
  }
  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m;
    });
  }
  function text(value) {
    const span = doc.createElement('span');
    span.textContent = value;
    return span;
  }
  function refLabel(source, id) {
    return String(id || '');
  }
  function stateBlock(kind, message) {
    const div = doc.createElement('div');
    div.className = 'edu-empty';
    div.textContent = message;
    return div;
  }
  function banner(kind, message) {
    const div = doc.createElement('div');
    div.className = 'edu-banner';
    div.textContent = message;
    return div;
  }
  function loadingBlock() {
    const div = doc.createElement('div');
    div.className = 'edu-loading';
    div.textContent = 'Loading…';
    return div;
  }
  function pill(status) {
    return '<span class="edu-pill">' + esc(status) + '</span>';
  }
  function code(value) {
    return '<code>' + esc(value) + '</code>';
  }
  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  const context = Object.assign({
    console,
    document: doc,
    window: { document: doc },
    location: { hash: '' },
    toast: () => {},
    setTimeout,
    clearTimeout,
    Date,
    parseInt,
    Math,
    String,
    Array,
    Object,
    RegExp,
    Error,
    JSON,
    el,
    explain,
    esc,
    text,
    refLabel,
    stateBlock,
    banner,
    loadingBlock,
    pill,
    code,
    today,
    ATTENDANCE_STATUSES: ['present', 'absent', 'late', 'excused'],
    MAX_STRING_LEN: 160,
    api: () => Promise.resolve({}),
    loadRef: () => Promise.resolve([])
  }, sandbox);
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fnSource, context, { filename: 'education.js-sandbox.js' });
  return context;
}

describe('Teacher G2 — attendance and grading UI (frontend contract)', () => {
  let renderTeacherWriteTools;
  let renderTeacherAttendance;
  let renderTeacherGrading;
  let reportWriteFailure;
  let labelledControl;

  beforeAll(() => {
    const teacherWriteToolsSrc = extractFunction('renderTeacherWriteTools');
    const teacherAttendanceSrc = extractFunction('renderTeacherAttendance');
    const teacherGradingSrc = extractFunction('renderTeacherGrading');
    const reportWriteFailureSrc = extractFunction('reportWriteFailure');
    const labelledControlSrc = extractFunction('labelledControl');

    const shared = runInSandbox(teacherWriteToolsSrc, {
      renderTeacherAttendance: () => {
        const el = createMockDocument().createElement('div');
        el.id = 'edu-teacher-attendance';
        return el;
      },
      renderTeacherGrading: () => {
        const el = createMockDocument().createElement('div');
        el.id = 'edu-teacher-grading';
        return el;
      }
    });
    renderTeacherWriteTools = shared.renderTeacherWriteTools;

    const attSandbox = runInSandbox(teacherAttendanceSrc, {
      labelledControl: function(tag, id, labelText, className) {
        const wrap = attSandbox.el('div', 'edu-filter');
        const label = attSandbox.el('label', null, labelText);
        label.setAttribute('for', id);
        wrap.appendChild(label);
        const node = attSandbox.el(tag, className);
        node.id = id;
        wrap.appendChild(node);
        return { wrap: wrap, node: node, label: label };
      }
    });
    renderTeacherAttendance = attSandbox.renderTeacherAttendance;

    const gradSandbox = runInSandbox(teacherGradingSrc, {
      labelledControl: function(tag, id, labelText, className) {
        const wrap = gradSandbox.el('div', 'edu-filter');
        const label = gradSandbox.el('label', null, labelText);
        label.setAttribute('for', id);
        wrap.appendChild(label);
        const node = gradSandbox.el(tag, className);
        node.id = id;
        wrap.appendChild(node);
        return { wrap: wrap, node: node, label: label };
      }
    });
    renderTeacherGrading = gradSandbox.renderTeacherGrading;

    const failSandbox = runInSandbox(reportWriteFailureSrc, {});
    reportWriteFailure = failSandbox.reportWriteFailure;

    const labelSandbox = runInSandbox(labelledControlSrc, {});
    labelledControl = labelSandbox.labelledControl;
  });

  test('renderTeacherWriteTools exists and is callable', () => {
    expect(typeof renderTeacherWriteTools).toBe('function');
  });

  test('renderTeacherAttendance exists and is callable', () => {
    expect(typeof renderTeacherAttendance).toBe('function');
  });

  test('renderTeacherGrading exists and is callable', () => {
    expect(typeof renderTeacherGrading).toBe('function');
  });

  test('reportWriteFailure exists and is callable', () => {
    expect(typeof reportWriteFailure).toBe('function');
  });

  test('labelledControl exists and is callable', () => {
    expect(typeof labelledControl).toBe('function');
  });

  test('labelledControl creates a label with for attribute and a control with matching id', () => {
    const result = labelledControl('select', 'test-id', 'Test Label', 'test-class');
    expect(result.label.getAttribute('for')).toBe('test-id');
    expect(result.node.id).toBe('test-id');
  });

  test('renderTeacherWriteTools renders attendance and grading cards for authorized teacher', () => {
    const host = createMockDocument().createElement('div');
    const classes = [{ id: 'cls-1', name: 'Class 1', classCode: 'C1' }];
    const rows = [
      { id: 'enr-1', classId: 'cls-1', studentId: 'stu-1', status: 'active' },
      { id: 'enr-2', classId: 'cls-1', studentId: 'stu-2', status: 'active' }
    ];
    renderTeacherWriteTools(host, 'teacher-1', classes, rows);
    expect(host.querySelector('#edu-teacher-attendance')).not.toBeNull();
    expect(host.querySelector('#edu-teacher-grading')).not.toBeNull();
  });

  test('renderTeacherWriteTools shows empty state when no classes assigned', () => {
    const host = createMockDocument().createElement('div');
    renderTeacherWriteTools(host, 'teacher-1', [], []);
    expect(host.textContent).toContain('You have no classes assigned yet');
  });

  test('renderTeacherWriteTools shows empty state when no enrollments in classes', () => {
    const host = createMockDocument().createElement('div');
    const classes = [{ id: 'cls-1', name: 'Class 1' }];
    renderTeacherWriteTools(host, 'teacher-1', classes, []);
    expect(host.textContent).toContain('No student is enrolled in your classes yet');
  });

  test('renderTeacherAttendance returns a card element with class selector and date picker', () => {
    const classes = [{ id: 'cls-1', name: 'Class 1', classCode: 'C1' }];
    const rows = [
      { id: 'enr-1', classId: 'cls-1', studentId: 'stu-1', status: 'active' }
    ];
    const card = renderTeacherAttendance(classes, rows);
    expect(card).not.toBeNull();
    expect(card.id).toBe('edu-teacher-attendance');
    expect(card.querySelector('#edu-teacher-att-class')).not.toBeNull();
    expect(card.querySelector('#edu-teacher-att-date')).not.toBeNull();
    expect(card.querySelector('#edu-teacher-att-rows')).not.toBeNull();
  });

  test('renderTeacherAttendance date picker is capped to today', () => {
    const classes = [{ id: 'cls-1', name: 'Class 1' }];
    const rows = [{ id: 'enr-1', classId: 'cls-1', studentId: 'stu-1', status: 'active' }];
    const card = renderTeacherAttendance(classes, rows);
    const dateInput = card.querySelector('#edu-teacher-att-date');
    expect(dateInput).not.toBeNull();
    expect(dateInput.type).toBe('date');
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput.value).toBe(today);
  });

  test('renderTeacherAttendance status dropdown is present', () => {
    const classes = [{ id: 'cls-1', name: 'Class 1' }];
    const rows = [{ id: 'enr-1', classId: 'cls-1', studentId: 'stu-1', status: 'active' }];
    const card = renderTeacherAttendance(classes, rows);
    const select = card.querySelector('#edu-att-status-enr-1');
    expect(select).not.toBeNull();
  });

  test('renderTeacherGrading returns a card element with class selector, student rows, and grade inputs', () => {
    const classes = [{ id: 'cls-1', name: 'Class 1' }];
    const rows = [
      { id: 'enr-1', classId: 'cls-1', studentId: 'stu-1', status: 'active' }
    ];
    const card = renderTeacherGrading(classes, rows);
    expect(card).not.toBeNull();
    expect(card.id).toBe('edu-teacher-grading');
    expect(card.querySelector('#edu-teacher-grade-class')).not.toBeNull();
    expect(card.querySelector('#edu-teacher-grade-rows')).not.toBeNull();
    expect(card.querySelector('#edu-grade-value-enr-1')).not.toBeNull();
  });

  test('renderTeacherGrading grade input is text with maxlength and LTR direction', () => {
    const classes = [{ id: 'cls-1', name: 'Class 1' }];
    const rows = [{ id: 'enr-1', classId: 'cls-1', studentId: 'stu-1', status: 'active' }];
    const card = renderTeacherGrading(classes, rows);
    const input = card.querySelector('#edu-grade-value-enr-1');
    expect(input).not.toBeNull();
    expect(input.type).toBe('text');
    expect(input.maxLength).toBe(32);
    expect(input.dir).toBe('ltr');
  });

  test('reportWriteFailure returns honest 401 message pointing to re-login', () => {
    const err = { status: 401 };
    const msg = reportWriteFailure(err, 'Attendance could not be saved.');
    expect(msg).toContain('انتهت الجلسة');
    expect(msg).toContain('تسجيل الدخول');
  });

  test('reportWriteFailure returns honest 403 message without bypass language', () => {
    const err = { status: 403 };
    const msg = reportWriteFailure(err, 'The grade could not be saved.');
    expect(msg).toContain('ليست لديك صلاحية');
    expect(msg).not.toContain('bypass');
    expect(msg).not.toContain('override');
  });

  test('reportWriteFailure falls back to explain(err) for non-auth errors', () => {
    const err = { status: 500, message: 'Server error' };
    const msg = reportWriteFailure(err, 'Operation failed.');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  test('Teacher G2 UI does not reference tenantId, teacherActor, or actorId in write payloads', () => {
    const source = EDUCATION_JS;
    const g2Start = source.indexOf('// TEACHER WRITE TOOLS');
    const g2End = source.indexOf('function renderStudentWorkspace');
    const g2Section = source.slice(g2Start, g2End);
    const codeLines = g2Section.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(codeLines).not.toMatch(/tenantId\s*[:=]/);
    expect(codeLines).not.toMatch(/teacherActor\s*[:=]/);
    expect(codeLines).not.toMatch(/actorId\s*[:=]/);
    expect(codeLines).not.toMatch(/X-Tenant-Id/);
  });

  test('Teacher G2 attendance save uses POST /attendance/bulk without tenant/actor fields', () => {
    const source = EDUCATION_JS;
    const g2Start = source.indexOf('// TEACHER WRITE TOOLS');
    const g2End = source.indexOf('function renderStudentWorkspace');
    const g2Section = source.slice(g2Start, g2End);
    expect(g2Section).toContain("api('POST', '/attendance/bulk'");
    expect(g2Section).not.toMatch(/attendanceDate.*tenantId/);
    expect(g2Section).not.toMatch(/entries.*tenantId/);
  });

  test('Teacher G2 grading save uses POST /grading without tenant/actor fields', () => {
    const source = EDUCATION_JS;
    const g2Start = source.indexOf('// TEACHER WRITE TOOLS');
    const g2End = source.indexOf('function renderStudentWorkspace');
    const g2Section = source.slice(g2Start, g2End);
    expect(g2Section).toContain("api('POST', '/grading'");
    expect(g2Section).not.toMatch(/enrollmentId.*tenantId/);
    expect(g2Section).not.toMatch(/grade.*tenantId/);
  });
});
