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
      appendChild: function(child) {
        this.children.push(child);
        if (typeof child === 'string') {
          this.textContent += child;
        } else if (child && child.textContent) {
          this.textContent += child.textContent;
        }
        return child;
      },
      setAttribute: function(name, value) {
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
        if (name === 'aria-hidden') this.attributes['aria-hidden'] = value;
      },
      getAttribute: function(name) {
        return this.attributes[name] || null;
      },
      addEventListener: function(event, handler) {
        this.eventListeners[event] = this.eventListeners[event] || [];
        this.eventListeners[event].push(handler);
      },
      dispatchEvent: function(event) {
        var handlers = this.eventListeners[event.type] || [];
        handlers.forEach(function(h) { h(event); });
      },
      removeChild: function(child) {
        var idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        return child;
      },
      querySelector: function(selector) {
        function findIn(node) {
          if (typeof node === 'string') return null;
          // Tag name selector (e.g. 'button')
          if (/^[a-zA-Z]+$/.test(selector) || !!/^[a-zA-Z][\w-]*$/.test(selector)) {
            if (node.tagName === selector.toUpperCase()) return node;
          } else if (selector.charAt(0) === '#') {
            if (node.id === selector.slice(1)) return node;
          } else if (selector.charAt(0) === '.' && node.attributes && node.attributes.class) {
            var classes = selector.slice(1).split('.');
            var nodeClasses = (node.attributes.class || '').split(' ');
            if (classes.every(function(c) { return nodeClasses.indexOf(c) >= 0; })) return node;
          }
          if (node.children) {
            for (var i = 0; i < node.children.length; i++) {
              var found = findIn(node.children[i]);
              if (found) return found;
            }
          }
          return null;
        }
        return findIn(this);
      },
      querySelectorAll: function(selector) {
        var results = [];
        function walk(node) {
          if (typeof node === 'string') return;
          // Tag name selector
          if (/^[a-zA-Z]+$/.test(selector) || !!/^[a-zA-Z][\w-]*$/.test(selector)) {
            if (node.tagName === selector.toUpperCase()) results.push(node);
          } else if (selector.charAt(0) === '#') {
            if (node.id === selector.slice(1)) results.push(node);
          } else if (selector.charAt(0) === '.' && node.attributes && node.attributes.class) {
            var classes = selector.slice(1).split('.');
            var nodeClasses = (node.attributes.class || '').split(' ');
            if (classes.every(function(c) { return nodeClasses.indexOf(c) >= 0; })) results.push(node);
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
    createElement: createElement,
    createTextNode: createTextNode,
    nodes: nodes,
    getElementById: function(id) {
      return nodes.find(function(n) { return n.id === id; }) || null;
    }
  };
}

// Full mock document + vm context matching the Teacher G2 test pattern.
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
  function refLabel(source, id) { return String(id || ''); }
  function refName(source, obj) {
    if (!obj) return '';
    return [obj.firstName, obj.lastName].filter(Boolean).join(' ') ||
      obj.name || obj.displayName || String(obj.id || '');
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
    div.textContent = 'Loading\u2026';
    return div;
  }
  function pill(status) { return '<span class="edu-pill">' + esc(status) + '</span>'; }
  function code(value) { return '<code>' + esc(value) + '</code>'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function icon() { return '<svg></svg>'; }
  function labelledControl(tag, id, labelText, className) {
    const wrap = el('div', 'edu-filter');
    const label = el('label', null, labelText);
    label.setAttribute('for', id);
    wrap.appendChild(label);
    const node = el(tag, className);
    node.id = id;
    wrap.appendChild(node);
    return { wrap: wrap, node: node, label: label };
  }
  var toastCalls = [];
  function reportWriteSuccess(message) { toastCalls.push({ message: message, isError: false }); }
  function reportWriteFailure(err, context) {
    var status = err && err.status;
    var message;
    if (status === 401) {
      message = 'Session expired or not logged in. ' + (context || 'Please sign in again.') +
        ' You can use the login button on the home page.';
    } else if (status === 403) {
      message = 'You lack permission for this action. ' + (context || 'This action is limited to your assigned scope.');
    } else {
      message = explain(err);
    }
    toastCalls.push({ message: message, isError: true });
    return message;
  }
  function invalidateRef() {}

  const context = Object.assign({
    console: console,
    document: doc,
    window: { document: doc },
    location: { hash: '' },
    toast: function(msg, isError) { toastCalls.push({ message: msg, isError: isError }); },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    parseInt: parseInt,
    Math: Math,
    String: String,
    Array: Array,
    Object: Object,
    RegExp: RegExp,
    Error: Error,
    JSON: JSON,
    el: el,
    explain: explain,
    esc: esc,
    text: text,
    refLabel: refLabel,
    refName: refName,
    stateBlock: stateBlock,
    banner: banner,
    loadingBlock: loadingBlock,
    pill: pill,
    code: code,
    today: today,
    icon: icon,
    labelledControl: labelledControl,
    reportWriteSuccess: reportWriteSuccess,
    reportWriteFailure: reportWriteFailure,
    invalidateRef: invalidateRef,
    ATTENDANCE_STATUSES: ['present', 'absent', 'late', 'excused'],
    MAX_STRING_LEN: 160,
    STATUS_VALUES: ['active', 'inactive', 'archived'],
    api: function() { return Promise.resolve({}); },
    loadRef: function() { return Promise.resolve([]); }
  }, sandbox);
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fnSource, context, { filename: 'education.js-sandbox.js' });
  context._doc = doc;
  context._toastCalls = toastCalls;
  return context;
}

const ENTITIES = {
  students: {
    key: 'students',
    path: '/students',
    title: 'Students',
    addLabel: 'Add Student',
    archivePath: '/archive',
    archiveLabel: 'Archive',
    statuses: ['active', 'inactive', 'archived'],
    filters: [],
    fields: [
      { name: 'studentCode', label: 'Student Code', type: 'text' },
      { name: 'firstName', label: 'First Name', type: 'text', required: true },
      { name: 'lastName', label: 'Last Name', type: 'text', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
      { name: 'gender', label: 'Gender', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Address', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', values: ['active', 'inactive', 'archived'] },
      { name: 'notes', label: 'Notes', type: 'textarea', maxLength: 160 }
    ]
  },
  teachers: {
    key: 'teachers',
    path: '/teachers',
    title: 'Teachers',
    addLabel: 'Add Teacher',
    archivePath: '/archive',
    archiveLabel: 'Archive',
    statuses: ['active', 'inactive', 'archived'],
    filters: [],
    fields: [
      { name: 'teacherCode', label: 'Teacher Code', type: 'text' },
      { name: 'firstName', label: 'First Name', type: 'text', required: true },
      { name: 'lastName', label: 'Last Name', type: 'text', required: true },
      { name: 'displayName', label: 'Display Name', type: 'text' },
      { name: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
      { name: 'gender', label: 'Gender', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Address', type: 'text' },
      { name: 'specialization', label: 'Specialization', type: 'text' },
      { name: 'qualification', label: 'Qualification', type: 'text' },
      { name: 'employmentType', label: 'Employment Type', type: 'select', values: ['full_time', 'part_time', 'contract'] },
      { name: 'status', label: 'Status', type: 'select', values: ['active', 'inactive', 'archived'] },
      { name: 'notes', label: 'Notes', type: 'textarea', maxLength: 160 }
    ]
  },
  classes: {
    key: 'classes',
    path: '/classes',
    title: 'Classes',
    addLabel: 'Add Class',
    archivePath: '/archive',
    archiveLabel: 'Archive',
    statuses: ['active', 'inactive', 'archived'],
    filters: [],
    fields: [
      { name: 'courseId', label: 'Course', type: 'ref', source: 'courses' },
      { name: 'teacherId', label: 'Teacher', type: 'ref', source: 'teachers' },
      { name: 'classCode', label: 'Class Code', type: 'text' },
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'displayName', label: 'Display Name', type: 'text' },
      { name: 'description', label: 'Description', type: 'textarea', maxLength: 160 },
      { name: 'fee', label: 'Fee', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', values: ['active', 'inactive', 'archived'] }
    ]
  },
  enrollments: {
    key: 'enrollments',
    path: '/enrollments',
    title: 'Enrollments',
    addLabel: 'Add Enrollment',
    withdrawPath: '/withdraw',
    withdrawLabel: 'Withdraw',
    statuses: ['active', 'withdrawn'],
    filters: [],
    fields: [
      { name: 'studentId', label: 'Student', type: 'ref', source: 'students' },
      { name: 'classId', label: 'Class', type: 'ref', source: 'classes' },
      { name: 'notes', label: 'Notes', type: 'textarea', maxLength: 160 }
    ]
  }
};

describe('Center G1 - write tools for Students, Teachers, Classes, Enrollments (frontend contract)', function() {
  var shared;

  beforeAll(function() {
    var centerWriteToolsSrc = extractFunction('renderCenterWriteTools');
    var centerCreateFormSrc = extractFunction('renderCenterCreateForm');
    var populateRefOptionsSrc = extractFunction('populateRefOptions');
    var reportWriteSuccessSrc = extractFunction('reportWriteSuccess');

    shared = runInSandbox(
      centerWriteToolsSrc + '\n' +
      centerCreateFormSrc + '\n' +
      populateRefOptionsSrc + '\n' +
      reportWriteSuccessSrc,
      {
        ENTITIES: ENTITIES,
        CENTER_WRITE_SPECS: [ENTITIES.students, ENTITIES.teachers, ENTITIES.classes, ENTITIES.enrollments],
        REF: {},
        state: { page: 'center', rows: {}, filters: {}, lookups: {}, error: {}, loading: {} }
      }
    );
  });

  test('renderCenterWriteTools exists and is callable', function() {
    expect(typeof shared.renderCenterWriteTools).toBe('function');
  });

  test('renderCenterCreateForm exists and is callable', function() {
    expect(typeof shared.renderCenterCreateForm).toBe('function');
  });

  test('populateRefOptions exists and is callable', function() {
    expect(typeof shared.populateRefOptions).toBe('function');
  });

  test('renderCenterWriteTools creates a card for each entity', function() {
    var host = shared._doc.createElement('div');
    shared.renderCenterWriteTools(host);
    var cards = host.querySelectorAll('.edu-card');
    expect(cards.length).toBe(4);
  });

  test('renderCenterWriteTools creates Students card', function() {
    var host = shared._doc.createElement('div');
    shared.renderCenterWriteTools(host);
    expect(host.querySelector('#edu-center-create-students')).not.toBeNull();
  });

  test('renderCenterWriteTools creates Teachers card', function() {
    var host = shared._doc.createElement('div');
    shared.renderCenterWriteTools(host);
    expect(host.querySelector('#edu-center-create-teachers')).not.toBeNull();
  });

  test('renderCenterWriteTools creates Classes card', function() {
    var host = shared._doc.createElement('div');
    shared.renderCenterWriteTools(host);
    expect(host.querySelector('#edu-center-create-classes')).not.toBeNull();
  });

  test('renderCenterWriteTools creates Enrollments card', function() {
    var host = shared._doc.createElement('div');
    shared.renderCenterWriteTools(host);
    expect(host.querySelector('#edu-center-create-enrollments')).not.toBeNull();
  });

  test('renderCenterCreateForm renders form controls from entity fields', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    expect(card.querySelector('#edu-center-students-firstName')).not.toBeNull();
    expect(card.querySelector('#edu-center-students-lastName')).not.toBeNull();
    expect(card.querySelector('#edu-center-students-email')).not.toBeNull();
    expect(card.querySelector('#edu-center-students-status')).not.toBeNull();
  });

  test('renderCenterCreateForm renders save button', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.teachers);
    var buttons = card.querySelectorAll('button');
    var saveBtn = Array.prototype.filter.call(buttons, function(b) {
      return b.attributes.class && b.attributes.class.indexOf('edu-btn-primary') >= 0;
    });
    expect(saveBtn.length).toBe(1);
  });

  test('renderCenterCreateForm textarea field renders as textarea', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    var notesInput = card.querySelector('#edu-center-students-notes');
    expect(notesInput).not.toBeNull();
    expect(notesInput.tagName).toBe('TEXTAREA');
  });

  test('renderCenterCreateForm date field has LTR direction', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    var dateInput = card.querySelector('#edu-center-students-dateOfBirth');
    expect(dateInput).not.toBeNull();
    expect(dateInput.dir).toBe('ltr');
  });

  test('renderCenterCreateForm select field renders options including blank', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    var statusSelect = card.querySelector('#edu-center-students-status');
    expect(statusSelect).not.toBeNull();
    // blank option + 3 status values
    expect(statusSelect.children.length).toBe(4);
  });

  test('renderCenterCreateForm ref field renders select element', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.classes);
    var courseSelect = card.querySelector('#edu-center-classes-courseId');
    expect(courseSelect).not.toBeNull();
    expect(courseSelect.tagName).toBe('SELECT');
  });

  test('renderCenterCreateForm save button is disabled while submitting and re-enabled on success', function() {
    var postedPayload = null;
    var doc = shared._doc;
    shared.api = function(method, url, payload) {
      postedPayload = { method: method, url: url, payload: payload };
      return Promise.resolve({});
    };
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    var saveBtn = card.querySelector('button');
    card.querySelector('#edu-center-students-firstName').value = 'John';
    card.querySelector('#edu-center-students-lastName').value = 'Doe';

    saveBtn.dispatchEvent({ type: 'click' });
    expect(saveBtn.disabled).toBe(true);

    return Promise.resolve().then(function() {
      expect(saveBtn.disabled).toBe(false);
      expect(postedPayload).not.toBeNull();
    });
  });

  test('renderCenterCreateForm shows toast when required fields are missing', function() {
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    var saveBtn = card.querySelector('button');
    saveBtn.dispatchEvent({ type: 'click' });
    var lastToast = shared._toastCalls[shared._toastCalls.length - 1];
    expect(lastToast).toBeDefined();
    expect(lastToast.message).toMatch(/missing/i);
    expect(lastToast.isError).toBe(true);
  });

  test('renderCenterCreateForm collects only writable fields from ENTITY spec into POST payload', function() {
    var postedPayload = null;
    shared.api = function(method, url, payload) {
      postedPayload = { method: method, url: url, payload: payload };
      return Promise.resolve({});
    };
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    card.querySelector('#edu-center-students-firstName').value = 'Jane';
    card.querySelector('#edu-center-students-lastName').value = 'Smith';
    card.querySelector('#edu-center-students-email').value = 'jane@test.com';
    card.querySelector('#edu-center-students-status').value = 'active';

    var saveBtn = card.querySelector('button');
    saveBtn.dispatchEvent({ type: 'click' });

    return Promise.resolve().then(function() {
      expect(postedPayload).not.toBeNull();
      expect(postedPayload.method).toBe('POST');
      expect(postedPayload.url).toBe('/students');
      expect(postedPayload.payload.firstName).toBe('Jane');
      expect(postedPayload.payload.lastName).toBe('Smith');
      expect(postedPayload.payload.email).toBe('jane@test.com');
      expect(postedPayload.payload.status).toBe('active');
    });
  });

  test('renderCenterCreateForm students POST payload has no tenant/actor fields', function() {
    var postedPayload = null;
    shared.api = function(method, url, payload) {
      postedPayload = { method: method, url: url, payload: payload };
      return Promise.resolve({});
    };
    var card = shared.renderCenterCreateForm(ENTITIES.students);
    card.querySelector('#edu-center-students-firstName').value = 'Jane';
    card.querySelector('#edu-center-students-lastName').value = 'Smith';

    var saveBtn = card.querySelector('button');
    saveBtn.dispatchEvent({ type: 'click' });

    return Promise.resolve().then(function() {
      expect(postedPayload.payload.tenantId).toBeUndefined();
      expect(postedPayload.payload.teacherActor).toBeUndefined();
      expect(postedPayload.payload.actorId).toBeUndefined();
    });
  });

  test('renderCenterCreateForm teachers POST payload has no tenant/actor fields', function() {
    var postedPayload = null;
    shared.api = function(method, url, payload) {
      postedPayload = { method: method, url: url, payload: payload };
      return Promise.resolve({});
    };
    var card = shared.renderCenterCreateForm(ENTITIES.teachers);
    card.querySelector('#edu-center-teachers-firstName').value = 'Alice';
    card.querySelector('#edu-center-teachers-lastName').value = 'Brown';

    var saveBtn = card.querySelector('button');
    saveBtn.dispatchEvent({ type: 'click' });

    return Promise.resolve().then(function() {
      expect(postedPayload.url).toBe('/teachers');
      expect(postedPayload.payload.firstName).toBe('Alice');
      expect(postedPayload.payload.tenantId).toBeUndefined();
      expect(postedPayload.payload.teacherActor).toBeUndefined();
      expect(postedPayload.payload.actorId).toBeUndefined();
    });
  });

  test('renderCenterCreateForm classes POST payload has no tenant/actor fields', function() {
    var postedPayload = null;
    shared.api = function(method, url, payload) {
      postedPayload = { method: method, url: url, payload: payload };
      return Promise.resolve({});
    };
    var card = shared.renderCenterCreateForm(ENTITIES.classes);
    card.querySelector('#edu-center-classes-classCode').value = 'C101';
    card.querySelector('#edu-center-classes-name').value = 'Math 101';

    var saveBtn = card.querySelector('button');
    saveBtn.dispatchEvent({ type: 'click' });

    return Promise.resolve().then(function() {
      expect(postedPayload.url).toBe('/classes');
      expect(postedPayload.payload.classCode).toBe('C101');
      expect(postedPayload.payload.name).toBe('Math 101');
      expect(postedPayload.payload.tenantId).toBeUndefined();
      expect(postedPayload.payload.teacherActor).toBeUndefined();
      expect(postedPayload.payload.actorId).toBeUndefined();
    });
  });

  test('renderCenterCreateForm enrollments POST payload has no tenant/actor fields', function() {
    var postedPayload = null;
    shared.api = function(method, url, payload) {
      postedPayload = { method: method, url: url, payload: payload };
      return Promise.resolve({});
    };
    var card = shared.renderCenterCreateForm(ENTITIES.enrollments);
    var studentSelect = card.querySelector('#edu-center-enrollments-studentId');
    studentSelect.value = 'stu-1';
    var classSelect = card.querySelector('#edu-center-enrollments-classId');
    classSelect.value = 'cls-1';

    var saveBtn = card.querySelector('button');
    saveBtn.dispatchEvent({ type: 'click' });

    return Promise.resolve().then(function() {
      expect(postedPayload.url).toBe('/enrollments');
      expect(postedPayload.payload.studentId).toBe('stu-1');
      expect(postedPayload.payload.classId).toBe('cls-1');
      expect(postedPayload.payload.tenantId).toBeUndefined();
      expect(postedPayload.payload.teacherActor).toBeUndefined();
      expect(postedPayload.payload.actorId).toBeUndefined();
    });
  });

  test('populateRefOptions populates select with options from rows', function() {
    var doc = shared._doc;
    var select = doc.createElement('select');
    var rows = [
      { id: 't1', firstName: 'Alice', lastName: 'Smith' },
      { id: 't2', firstName: 'Bob', lastName: 'Jones' }
    ];
    shared.populateRefOptions(select, 'teachers', '', rows);
    // blank + 2 rows
    expect(select.children.length).toBe(3);
    expect(select.children[1].value).toBe('t1');
    expect(select.children[2].value).toBe('t2');
  });

  test('reportWriteSuccess exists and is callable', function() {
    expect(typeof shared.reportWriteSuccess).toBe('function');
  });

  test('Center G1 source section does not contain tenantId in payload assignments', function() {
    var source = EDUCATION_JS;
    var start = source.indexOf('CENTER WRITE TOOLS');
    var end = source.indexOf('TEACHER WRITE TOOLS');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(-1);
    var section = source.slice(start, end);
    var codeLines = section.split('\n').filter(function(line) {
      return !line.trim().startsWith('//');
    }).join('\n');
    expect(codeLines).not.toMatch(/tenantId\s*[:=]/);
    expect(codeLines).not.toMatch(/teacherActor\s*[:=]/);
    expect(codeLines).not.toMatch(/actorId\s*[:=]/);
    expect(codeLines).not.toMatch(/X-Tenant-Id/);
  });

  test('Center G1 renderCenterWriteTools is called from paintCenterWorkspace', function() {
    var source = EDUCATION_JS;
    var start = source.indexOf('function paintCenterWorkspace');
    var end = source.indexOf('function renderTeacherWriteTools');
    var section = source.slice(start, end);
    expect(section).toContain('renderCenterWriteTools');
  });

  test('Academic years page resolves to ENTITIES.academicYears (key mismatch fix)', function() {
    var source = EDUCATION_JS;
    // The PAGES array uses 'academic-years' (kebab-case) but the ENTITIES key
    // is 'academicYears' (camelCase). entityFor must bridge the gap.
    expect(source).toContain("'academic-years'");
    expect(source).toContain('academicYears:');
    // entityFor must have a mapping for academic-years -> academicYears
    var entityForMatch = source.match(/function entityFor\(page\)[\s\S]*?return ENTITIES\[page\] \|\| null;/);
    expect(entityForMatch).not.toBeNull();
    expect(entityForMatch[0]).toContain("page === 'academic-years'");
    expect(entityForMatch[0]).toContain('ENTITIES.academicYears');
  });
});
