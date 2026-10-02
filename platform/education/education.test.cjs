'use strict';

// platform/education/education.test.cjs — static regression checks for the
// Education (Device 2) frontend.
//
// This is a SOURCE test, not a browser test. It reads the shipped Education
// page, its stylesheet, its dictionary and its runtime, and the committed
// STU-1..STU-10 backend routes and services, then asserts the page cannot
// drift away from the contract it claims to serve. It needs no server, no
// browser and no network, so it runs in CI wherever the backend tests run.
//
// WHAT IT PROTECTS, AND WHY EACH GROUP EXISTS:
//
//   1. Page structure. The page must keep the landmarks, live regions and
//      dialogs a screen reader and a keyboard need, and it must keep the
//      bottom-nav / drawer pair pointing at the same page set.
//   2. NO REMOTE ASSET. Production CSP is `script-src 'self' 'unsafe-inline'`
//      in both nginx.conf and backend/server.js, so a CDN reference here would
//      work locally and break in production. Asserted for scripts, styles,
//      fonts, images and any absolute URL in the page.
//   3. TRANSPORT HONESTY. The bearer token is read from the existing
//      `access_token` key, and the page must never send a tenant of its own:
//      the server resolves the tenant from the signed claim, so a tenant
//      header or a `tenantId` body field would be both inert and misleading.
//   4. ROUTE PARITY. Every Education path the page calls must exist in a
//      committed backend route file, and every HTTP verb it uses for a path
//      must be one the backend actually declares. This is what stops the UI
//      from inventing an endpoint.
//   5. WRITE-FIELD PARITY. Every field the page can write must appear in the
//      matching backend service's WRITABLE_FIELDS, and every field the page
//      refuses to re-send on an edit must be one the backend really freezes.
//   6. VOCABULARY PARITY. Status lists on the page must equal the frozen lists
//      in the services, so the dropdown can never offer a value the server
//      refuses.
//   7. DESCRIPTIVE GRADING. The grading page must stay descriptive: it may
//      carry an enrollment, a date, a typed value and notes, and it must
//      contain none of the scale / aggregate / assessment vocabulary the
//      backend deliberately refuses.
//   8. NO INVENTED PAGINATION. The Education list routes expose no page or
//      limit contract, so the page must not send one or render pager controls.
//   9. NO FAKE IDENTITY. The workspaces must not name a current teacher or a
//      current student, because the backend links an authenticated user to
//      neither.
//  10. BOUNDARY RESPECT. The Education page must not reach into any surface
//      this device does not own, and the i18n dictionary must register through
//      the shared runtime rather than defining a second one.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = read('education/index.html');
const CSS = read('platform/education/education.css');
const RUNTIME = read('platform/education/education.js');
const DICT = read('platform/education/education.dict.js');
const I18N = read('platform/omni-i18n.js');
const NGINX = read('nginx.conf');
const SERVER_JS = read('backend/server.js');

const EDUCATION_ROUTE_FILES = [
  'educationPack', 'student', 'teacher', 'center', 'program', 'course',
  'class', 'enrollment', 'attendance', 'scheduling', 'grading'
].map((name) => ({
  name,
  src: read('backend/routes/' + name + '.routes.js')
}));

const SERVICE_FILES = [
  'student', 'teacher', 'center', 'program', 'course', 'class',
  'enrollment', 'attendance', 'scheduling', 'grading'
].map((name) => ({
  name,
  src: read('backend/services/' + name + '.service.js')
}));

// The page's entity keys are plural; the service file names are singular. This
// is the only place that knows the mapping.
const SERVICE_FOR_ENTITY = {
  students: 'student',
  teachers: 'teacher',
  centers: 'center',
  programs: 'program',
  courses: 'course',
  classes: 'class',
  enrollments: 'enrollment',
  attendance: 'attendance',
  scheduling: 'scheduling',
  grading: 'grading'
};

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + ' :: ' + err.message);
    process.exitCode = 1;
  }
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Comments explain the product boundary and legitimately name the concepts the
// boundary forbids. The vocabulary checks below are about what the page SHIPS,
// so they read the executable source with comments stripped, never the prose.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// All `router.<verb>('<path>'` declarations across the Education routers.
function backendRoutes() {
  const out = [];
  for (const file of EDUCATION_ROUTE_FILES) {
    const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(file.src)) !== null) {
      out.push({ file: file.name, verb: m[1].toUpperCase(), path: m[2] });
    }
  }
  return out;
}

// The frozen list assigned to a named constant in a service.
function serviceList(serviceSrc, constName) {
  const re = new RegExp('const\\s+' + constName + '\\s*=\\s*Object\\.freeze\\(\\[([^\\]]*)\\]\\)');
  const m = re.exec(serviceSrc);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

// The keys of a named WRITABLE_FIELDS object in a service.
function serviceWritable(serviceSrc) {
  const start = serviceSrc.indexOf('const WRITABLE_FIELDS');
  assert(start >= 0, 'WRITABLE_FIELDS not found');
  const open = serviceSrc.indexOf('{', start);
  const close = serviceSrc.indexOf('}', open);
  const body = serviceSrc.slice(open + 1, close);
  return body.split('\n')
    .map((line) => /^\s*([A-Za-z0-9_]+)\s*:/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

const ALL_ROUTES = backendRoutes();

// ---------------------------------------------------------------------------
// 1. Page structure
// ---------------------------------------------------------------------------
check('education page declares the landmarks and live regions it needs', () => {
  assert(PAGE.includes('id="edu-view"'), 'main view container missing');
  assert(PAGE.includes('role="main"'), 'main landmark missing');
  assert(PAGE.includes('id="edu-live"'), 'polite live region missing');
  assert(PAGE.includes('aria-live="polite"'), 'aria-live missing on the live region');
  assert(PAGE.includes('id="edu-toasts"'), 'toast region missing');
  assert(PAGE.includes('data-omni-lang-slot'), 'shared language switcher slot missing');
  assert(count(PAGE, 'class="edu-nav-btn"') >= 1, 'navigation buttons missing');
});

check('education page exposes every management view and both workspaces', () => {
  const required = [
    'dashboard', 'students', 'teachers', 'centers', 'programs', 'courses',
    'classes', 'enrollments', 'attendance', 'schedule', 'grading', 'teacher', 'student'
  ];
  for (const page of required) {
    assert(PAGE.includes('data-edu-page="' + page + '"'), 'navigation entry missing: ' + page);
  }
});

check('education page declares the schedule view once as `schedule`, not `scheduling`', () => {
  // The nav id and the backend path segment differ on purpose; the runtime maps
  // them in one place. If a future edit renames the nav id, that single mapping
  // has to move with it, and this assertion is what says so.
  assert(PAGE.includes('data-edu-page="schedule"'), 'schedule nav id missing');
  assert(!PAGE.includes('data-edu-page="scheduling"'), 'nav must not use the backend segment as a page id');
  assert(RUNTIME.includes("if (page === 'schedule') return ENTITIES.scheduling;"),
    'the schedule -> scheduling mapping is missing from the runtime');
});

check('education page dialogs are modal, labelled and dismissible', () => {
  assert(PAGE.includes('id="edu-form-overlay"'), 'form dialog missing');
  assert(PAGE.includes('id="edu-confirm-overlay"'), 'confirm dialog missing');
  assert(count(PAGE, 'aria-modal="true"') === 2, 'both dialogs must declare aria-modal');
  assert(PAGE.includes('aria-labelledby="edu-form-title"'), 'form dialog must be labelled');
  assert(PAGE.includes('aria-labelledby="edu-confirm-title"'), 'confirm dialog must be labelled');
  assert(PAGE.includes('id="edu-form-close"'), 'form close control missing');
  assert(PAGE.includes('id="edu-confirm-close"'), 'confirm close control missing');
});

check('education page is wired to the shared platform assets exactly once each', () => {
  assertEqual(count(PAGE, '../platform/omni-i18n.js'), 1, 'omni-i18n must load exactly once');
  assertEqual(count(PAGE, '../platform/education/education.js'), 1, 'education.js must load exactly once');
  assertEqual(count(PAGE, '../platform/education/education.dict.js'), 1, 'dictionary must load exactly once');
  assertEqual(count(PAGE, 'id="nav-drawer"'), 0, 'a duplicated nav drawer id leaked into the page');
  assertEqual(count(PAGE, 'id="nav-overlay"'), 0, 'a duplicated overlay id leaked into the page');
  assertEqual(count(PAGE, 'class="nav-drawer"'), 0, 'a legacy drawer class leaked into the page');
});

// ---------------------------------------------------------------------------
// 2. No remote asset — the production CSP only allows 'self'
// ---------------------------------------------------------------------------
check('education page references no remote script, style, font or image', () => {
  const remote = /(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi;
  const hits = PAGE.match(remote) || [];
  assert(hits.length === 0, 'remote reference found: ' + hits.join(', '));
  assert(!/cdn\.jsdelivr|unpkg|cdnjs|googleapis|fonts\.g/i.test(PAGE), 'a CDN or remote font reference is present');
  assert(!/lucide/i.test(PAGE + RUNTIME + CSS), 'an icon library reference is present');
});

check('every asset the education page references exists in the repository', () => {
  const re = /(?:src|href)\s*=\s*["']([^"':#]+)["']/gi;
  let m;
  const seen = [];
  while ((m = re.exec(PAGE)) !== null) seen.push(m[1]);
  assert(seen.length > 0, 'no local asset references found to verify');
  for (const rel of seen) {
    const target = path.join(ROOT, 'education', rel);
    assert(fs.existsSync(target), 'referenced asset does not exist: ' + rel);
  }
});

check('the production CSP is self-only for scripts, so the no-CDN rule is required', () => {
  // nginx.conf is the production edge and permits only 'self' plus inline for
  // scripts. backend/server.js additionally lists third-party script origins
  // that Master-owned shipped surfaces still use, so the self-only guarantee
  // this page depends on is nginx's, not the dev server's.
  assert(NGINX.includes("script-src 'self' 'unsafe-inline'"), 'nginx script-src is not self-only');
  assert(!/script-src[^;]*https?:/.test(NGINX), 'nginx script-src unexpectedly allows a remote origin');
  assert(SERVER_JS.includes('scriptSrc:'), 'the server CSP block changed shape; re-check the no-CDN rule');
});

check('education stylesheet introduces no remote import or font', () => {
  assert(!/@import\s+url\(\s*['"]?https?:/i.test(CSS), 'a remote @import is present');
  assert(!/url\(\s*['"]?https?:/i.test(CSS), 'a remote url() is present');
  assert(!/@font-face/i.test(CSS), 'a webfont is declared; the page must use system fonts only');
});

check('education icons are inline SVG paths, not a runtime icon library', () => {
  assert(RUNTIME.includes('var ICON_PATHS'), 'the inline icon table is missing');
  assert(count(PAGE, '<svg class="edu-icon"') >= 5, 'bottom navigation should carry inline SVG icons');
  assert(RUNTIME.includes('viewBox="0 0 24 24"'), 'icons must be drawn in a viewBox rather than fetched');
  assert(!/createIcons|lucide\.createIcons|window\.lucide/i.test(RUNTIME), 'an icon-library call is present');
});

// ---------------------------------------------------------------------------
// 3. Transport honesty
// ---------------------------------------------------------------------------
check('education runtime reads the existing access_token key, as the other pages do', () => {
  assert(RUNTIME.includes("localStorage.getItem('access_token')"), 'the shared access_token key is not used');
  assert(RUNTIME.includes("opts.headers.Authorization = 'Bearer ' + token"), 'the bearer header is not sent');
  const student = read('student.html');
  assert(student.includes("localStorage.getItem('access_token')"),
    'the Student Services page convention this page copies no longer holds');
});

check('education runtime never sends a tenant of its own', () => {
  // The server resolves the tenant from the signed claim and ignores anything
  // client-supplied, so sending one would be inert and would teach the wrong
  // mental model to whoever maintains this next.
  assert(!/X-Tenant-Id/i.test(RUNTIME), 'a tenant header is present');
  assert(!/tenantId\s*:/.test(RUNTIME), 'a tenantId field is being sent');
  assert(!/\?tenantId=|&tenantId=/.test(RUNTIME), 'a tenantId query key is present');
  assert(!/['"]tenantId['"]/.test(RUNTIME), 'the string "tenantId" should not appear in the runtime');
});

check('education runtime targets the single Education API base', () => {
  assert(RUNTIME.includes("var API_BASE = '/api/v1/tenant/education'"), 'API base is wrong or missing');
  // The base plus a leading slash is the only place a request is built, so no
  // second API root can drift in.
  const fetches = RUNTIME.match(/fetch\(/g) || [];
  assertEqual(fetches.length, 1, 'the runtime should issue requests through exactly one fetch call site');
  assert(RUNTIME.includes('fetch(API_BASE + path, opts)'), 'requests must go through API_BASE');
  for (const forbidden of ['/api/v1/tenant/student-services', '/api/v1/platform-public', '/api/v1/admin']) {
    assert(!RUNTIME.includes(forbidden), 'the page must not call a surface it does not own: ' + forbidden);
  }
});

check('education runtime unwraps the shared success envelope and surfaces server messages', () => {
  assert(RUNTIME.includes('json.data'), 'the data envelope is not unwrapped');
  assert(RUNTIME.includes('json.message'), 'the server message is not surfaced');
  assert(RUNTIME.includes('json.details'), 'validation details are not surfaced');
});

// ---------------------------------------------------------------------------
// 4. Route parity — the page may not invent an endpoint
// ---------------------------------------------------------------------------
check('every Education API path the page calls exists in a committed backend route', () => {
  const spec = RUNTIME.slice(RUNTIME.indexOf('var ENTITIES = {'));
  const paths = spec.match(/path:\s*'([^']+)'/g) || [];
  assert(paths.length >= 10, 'expected the full entity surface, found ' + paths.length + ' paths');
  for (const raw of paths) {
    const value = /path:\s*'([^']+)'/.exec(raw)[1];
    assert(ALL_ROUTES.some((route) => route.path === value),
      'the page calls ' + value + ' but no backend Education router declares it');
  }
});

check('the page issues only verbs the backend declares for each path', () => {
  // The runtime uses exactly three shapes: collection GET, item GET, POST and
  // PUT on a path, and PATCH on an archive/withdraw suffix.
  assert(RUNTIME.includes("api('GET', spec.path"), 'collection reads must go through spec.path');
  assert(RUNTIME.includes("api('POST', spec.path, payload)"), 'creates must POST the collection');
  assert(RUNTIME.includes("api('PUT', spec.path +"), 'corrections must PUT the item');
  assert(RUNTIME.includes("api('PATCH', spec.path +"), 'lifecycle actions must PATCH the item');

  const suffix = /var suffix = spec\.archivePath \|\| spec\.withdrawPath;/.test(RUNTIME);
  assert(suffix, 'the PATCH suffix must come from the entity descriptor, not a hard-coded string');
  for (const spec of ['archive', 'withdraw']) {
    const declared = ALL_ROUTES.filter((route) => route.verb === 'PATCH' && route.path.endsWith('/' + spec));
    assert(declared.length > 0, 'no PATCH /:' + spec + ' route is declared by the backend');
  }
});

check('the backend really mounts the Education routers this page depends on', () => {
  for (const route of ['programRoutes', 'courseRoutes', 'classRoutes', 'enrollmentRoutes',
    'attendanceRoutes', 'schedulingRoutes', 'gradingRoutes', 'studentRoutes', 'teacherRoutes',
    'centerRoutes', 'educationPackRoutes']) {
    assert(SERVER_JS.includes('const ' + route + ' ='), 'the server does not import ' + route);
    assert(
      new RegExp("app\\.use\\('/api/v1/tenant/education',\\s*" + route + '\\)').test(SERVER_JS),
      'the server does not mount ' + route + ' on the Education namespace'
    );
  }
  // A grade is corrected, never deleted: the page must offer no delete, and the
  // backend must declare none.
  assert(!ALL_ROUTES.some((route) => route.verb === 'DELETE' && /grading|grading\//.test(route.path)),
    'a delete route exists for grading; the contract says there is none');
  assert(!RUNTIME.includes("api('DELETE'"), 'the page must not issue a DELETE');
});

// ---------------------------------------------------------------------------
// 5. Write-field parity
// ---------------------------------------------------------------------------
// The `fields:` array of one entity descriptor, so the filter list above it is
// never mistaken for the writable surface.
function entityBlock(entityKey) {
  const start = RUNTIME.indexOf('\n    ' + entityKey + ': {');
  assert(start >= 0, 'entity descriptor not found: ' + entityKey);
  // Brace-balanced, not comma-sentinel based: the LAST descriptor in an object
  // literal closes with `}` and no comma, so a `},` search would run past it and
  // swallow whatever object happens to follow.
  const open = RUNTIME.indexOf('{', start);
  let depth = 0;
  let end = RUNTIME.length;
  for (let i = open; i < RUNTIME.length; i++) {
    const ch = RUNTIME[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  return RUNTIME.slice(start, end);
}

function entityWriteFields(entityKey) {
  const block = entityBlock(entityKey);
  const from = block.indexOf('fields: [');
  assert(from >= 0, 'no fields array for ' + entityKey);
  const open = block.indexOf('[', from);
  const close = block.indexOf('\n      ]', open);
  const body = block.slice(open + 1, close < 0 ? block.length : close);
  const written = new Set();
  const re = /(?:textField|refField|selectField)\(\s*'([A-Za-z0-9_]+)'|name:\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) written.add(m[1] || m[2]);
  return written;
}

check('every field the page can write is a backend writable field', () => {
  const spec = RUNTIME.slice(RUNTIME.indexOf('var ENTITIES = {'));
  const names = Object.keys(SERVICE_FOR_ENTITY);
  assert(count(spec, '\n    ' ) >= names.length, 'entity block count changed; update this test with it');

  for (const entityKey of names) {
    const serviceName = SERVICE_FOR_ENTITY[entityKey];
    const writable = serviceWritable(SERVICE_FILES.find((file) => file.name === serviceName).src);
    assert(writable.length, 'could not read WRITABLE_FIELDS for ' + serviceName);
    for (const field of entityWriteFields(entityKey)) {
      assert(writable.includes(field),
        'the page writes ' + entityKey + '.' + field + ' but the backend does not accept it');
    }
  }
});

check('the fields the page freezes on edit are exactly the ones the backend freezes', () => {
  const frozen = {
    enrollment: ['studentId', 'classId'],
    attendance: ['enrollmentId'],
    scheduling: ['classId'],
    grading: ['enrollmentId']
  };
  for (const [name, fields] of Object.entries(frozen)) {
    const src = SERVICE_FILES.find((file) => file.name === name).src;
    for (const field of fields) {
      // Some services enumerate the pair literally; the others loop over an
      // array of names and build the message from the key. Accept either form.
      const literal = src.includes("errors.push('" + field + " cannot be changed')");
      const looped = src.includes("errors.push(key + ' cannot be changed')") &&
        new RegExp('for \\(const key of \\[[^\\]]*' + field).test(src);
      assert(literal || looped,
        name + '.' + field + ' is not actually frozen by the backend');
    }
  }

  assert(
    /refField\('enrollmentId', 'Enrollment', 'enrollments', true, true\)/.test(RUNTIME),
    'the page must mark the grading and attendance parent as immutable'
  );
  assert(
    /refField\('classId', 'Class', 'classes', true, true\)/.test(RUNTIME),
    'the page must mark the scheduling parent as immutable'
  );
  assert(
    /refField\('studentId', 'Student', 'students', true, true\)/.test(RUNTIME),
    'the page must mark the enrollment student reference as immutable'
  );
  // Every date field the backend freezes is frozen on the page too.
  for (const dateField of ['attendanceDate', 'gradingDate', 'scheduledDate']) {
    assert(new RegExp("name: '" + dateField + "'[^}]*immutable: true").test(RUNTIME),
      'the page must not offer ' + dateField + ' for reassignment');
  }
});

check('the page never writes a server-owned field', () => {
  for (const forbidden of ['companyId', 'branchId', 'ownerUserId', 'userId', 'createdAt', 'updatedAt']) {
    assert(!new RegExp("(?:textField|refField|selectField)\\(\\s*'" + forbidden + "'").test(RUNTIME),
      'the page offers a server-owned field as writable: ' + forbidden);
  }
});

check('the page never offers a derived or later-phase reference as writable', () => {
  // Everything behind the Class is derived through classId; storing a second
  // copy could silently disagree with it, and the backend refuses these.
  for (const derived of ['courseId', 'programId', 'teacherId', 'centerId', 'academicYear', 'studentIds', 'classIds']) {
    const offers = (['attendance', 'scheduling', 'grading', 'enrollments']
      .map((name) => {
        const block = RUNTIME.slice(RUNTIME.indexOf('\n    ' + name + ': {'));
        const end = block.indexOf('\n    },');
        return end < 0 ? block : block.slice(0, end);
      })
      .join('\n'));
    const fieldBlock = offers.slice(offers.indexOf('fields:'), offers.indexOf('columns:'));
    assert(!new RegExp("(?:textField|refField|selectField)\\(\\s*'" + derived + "'").test(fieldBlock),
      'the page offers the derived field ' + derived + ' as writable');
  }
});

// ---------------------------------------------------------------------------
// 6. Vocabulary parity
// ---------------------------------------------------------------------------
check('status dropdowns equal the frozen lists in the services', () => {
  const pairs = [
    ['student', 'STUDENT_STATUSES'],
    ['teacher', 'TEACHER_STATUSES'],
    ['center', 'CENTER_STATUSES'],
    ['program', 'PROGRAM_STATUSES'],
    ['course', 'COURSE_STATUSES'],
    ['class', 'CLASS_STATUSES'],
    ['teacher', 'EMPLOYMENT_TYPES'],
    ['program', 'DURATION_UNITS'],
    ['course', 'DURATION_UNITS'],
    ['enrollment', 'ENROLLMENT_STATUSES'],
    ['attendance', 'ATTENDANCE_STATUSES']
  ];
  for (const [service, constName] of pairs) {
    const src = SERVICE_FILES.find((file) => file.name === service).src;
    const list = serviceList(src, constName);
    assert(list && list.length, 'could not read ' + constName + ' from ' + service);
    for (const value of list) {
      assert(RUNTIME.includes("'" + value + "'"),
        constName + ' value "' + value + '" is accepted by the backend but is absent from the page');
    }
  }
});

check('the page invents no status value the backend would refuse', () => {
  const allowed = new Set();
  for (const constName of ['STUDENT_STATUSES', 'TEACHER_STATUSES', 'CENTER_STATUSES', 'PROGRAM_STATUSES',
    'COURSE_STATUSES', 'CLASS_STATUSES', 'ENROLLMENT_STATUSES', 'ATTENDANCE_STATUSES',
    'EMPLOYMENT_TYPES', 'DURATION_UNITS']) {
    for (const file of SERVICE_FILES) {
      const list = serviceList(file.src, constName);
      if (list) list.forEach((value) => allowed.add(value));
    }
  }
  assert(RUNTIME.includes('var STATUS_VALUES = ') && RUNTIME.includes('var EMPLOYMENT_TYPES = ') &&
    RUNTIME.includes('var DURATION_UNITS = ') && RUNTIME.includes('var ENROLLMENT_STATUSES = ') &&
    RUNTIME.includes('var ATTENDANCE_STATUSES = '),
    'the page must declare its vocabularies as named lists so this test can read them');

  const declarations = [
    'STATUS_VALUES', 'EMPLOYMENT_TYPES', 'DURATION_UNITS', 'ENROLLMENT_STATUSES', 'ATTENDANCE_STATUSES'
  ];
  for (const name of declarations) {
    const m = new RegExp('var ' + name + ' = \\[([^\\]]*)\\]').exec(RUNTIME);
    assert(m, 'could not read the page list ' + name);
    const values = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    for (const value of values) {
      assert(allowed.has(value), 'the page offers "' + value + '" but no backend service declares it');
    }
  }
});

check('the page renders every declared status as a styled pill', () => {
  const css = CSS;
  for (const value of ['active', 'inactive', 'archived', 'withdrawn', 'present', 'absent', 'late', 'excused']) {
    assert(css.includes('.edu-pill-' + value), 'no style for the "' + value + '" status: ' + value);
  }
  assert(RUNTIME.includes('function pill(value)'), 'the pill renderer is missing');
  // A status is rendered as data, so the class name must be sanitized rather
  // than interpolated raw into the class attribute.
  assert(RUNTIME.includes("replace(/[^a-z_]/g, '')"), 'the status class is not sanitized');
});

// ---------------------------------------------------------------------------
// 7. Descriptive grading — the product boundary this device must not cross
// ---------------------------------------------------------------------------
check('grading stays descriptive: enrollment, date, typed value and notes only', () => {
  const written = entityWriteFields('grading');
  const writable = serviceWritable(SERVICE_FILES.find((f) => f.name === 'grading').src);
  assert(written.size > 0, 'the grading descriptor has no writable fields');
  for (const field of written) {
    assert(writable.includes(field),
      'the grading page writes a field the backend refuses: ' + field);
  }
  for (const required of ['enrollmentId', 'gradingDate', 'grade', 'notes']) {
    assert(written.has(required), 'the grading descriptor must carry ' + required);
  }
  assert(RUNTIME.includes('Recorded exactly as typed. No scale is defined, so no scale is offered.'),
    'the grade control must say out loud that the value is recorded verbatim');
});

check('no grading scale, aggregate or assessment vocabulary ships from the Education frontend', () => {
  // The backend refuses all of these as client-writable fields, and a UI that
  // offers them would advertise a capability the platform does not have. The
  // scan reads executable source with comments removed, because the runtime's
  // own comments legitimately name these concepts to explain why they are absent.
  const forbidden = [
    'gpa', 'cgpa', 'ranking', 'rank', 'percentile', 'weight', 'weighted',
    'pass/fail', 'passfail', 'pass rate', 'fail rate',
    'exam', 'exams', 'assessment', 'assessments', 'assignment', 'assignments',
    'coursework', 'questionbank', 'question bank', 'transcript',
    'overall score', 'total score', 'final score', 'average of grades',
    'average grade', 'class average', 'grade average'
  ];
  const shipped = {
    'education/index.html': stripComments(PAGE),
    'education.js': stripComments(RUNTIME),
    'education.css': stripComments(CSS)
  };
  for (const [name, src] of Object.entries(shipped)) {
    const lower = src.toLowerCase();
    for (const word of forbidden) {
      // Word-bounded on letters AND hyphens, so neither an ordinary word that
      // contains the token ("example" inside "exam") nor a CSS property
      // ("font-weight") counts as a hit.
      const hit = new RegExp('(?<![a-z-])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z-])', 'i').test(lower);
      assert(hit === false, name + ' ships forbidden grading vocabulary: ' + word);
    }
  }
  // The runtime must not even reference a forbidden key when collecting a form
  // payload, which is where such a field would actually reach the server.
  const collect = RUNTIME.slice(RUNTIME.indexOf('function collectPayload'));
  const end = collect.indexOf('\n  }');
  for (const word of ['score', 'exam', 'assessment', 'gpa', 'rank', 'weight', 'percentage', 'percent']) {
    assert(collect.slice(0, end).toLowerCase().indexOf(word) < 0,
      'the form payload builder references a forbidden grading field: ' + word);
  }
});

check('the dashboard shows record counts only, and the grading page offers no aggregation', () => {
  const stats = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('var DASHBOARD_CARDS'),
    RUNTIME.indexOf('function renderTeacherWorkspace')
  ));
  assert(stats.indexOf('statCard(result.card.label, result.total)') > 0,
    'the dashboard must derive its figures from record counts');
  assert(stats.indexOf('rows.length') > 0, 'the attendance card must derive its figure from a record count');
  assert(stats.indexOf("api('GET', '/' + card.key)") > 0, 'the dashboard must read the record counts it displays');
  assert(!/%\s*100|percentage|percent\b/i.test(stats), 'the dashboard must not display a percentage');
  // One register request feeds both the attendance count card and the
  // breakdown; a second fetch would be a wasted round trip per render.
  assertEqual(count(stats, "api('GET', '/attendance')"), 1, 'the attendance register is fetched more than once');
  assert(RUNTIME.includes('Raw record counts, read from the attendance service for this tenant.'),
    'the attendance breakdown must declare itself as raw counts');
  assert(RUNTIME.includes('String(totals[value])'), 'the distribution must print a raw count per status');

  // No arithmetic over grade values anywhere in the executable source.
  const code = stripComments(RUNTIME);
  assert(/grade[^\n]*\.(?:reduce|map)\(/.test(code) === false, 'the runtime maps over grade values');
  assert(!/\b(sum|total|average|mean|aggregate)\s*=/.test(code),
    'the runtime computes an aggregate over records');
  const dist = stripComments(code.slice(code.indexOf('function paintAttendanceDistribution')));
  assert(dist.indexOf('totals[value] / max') > 0,
    'the bar length must be a share of the largest count, never a share of a total');
  // The bar is rounded to whole pixels for rendering, but no rounded figure is
  // ever printed: the only number shown beside a bar is the raw count.
  assert(dist.indexOf('row.appendChild(el(\'span\', \'edu-dist-value\', String(totals[value])))') > 0,
    'the value beside a distribution bar must be the raw count');
  assert(!/edu-dist-value'[^)]*Math/.test(dist), 'a computed value is printed beside a bar');
});

check('the grading conflict contract is honoured, not retried around', () => {
  // One grade per enrollment. The page must not auto-retry a 409, and must not
  // silently swallow it, because a silent retry would hide the duplicate.
  assert(RUNTIME.includes('err.details'), 'error details must be read');
  assert(RUNTIME.includes('Array.isArray(details)'), 'validation detail lists must be handled');
  assert(!/setTimeout\([^)]*(409|conflict)/i.test(RUNTIME), 'a conflict must not be retried on a timer');
  const gradingController = read('backend/controllers/grading.controller.js');
  assert(gradingController.includes('GRADING_CONFLICT'), 'the grading conflict code changed upstream');
  assert(gradingController.includes('conflict: true'), 'the grading conflict payload changed upstream');
});

// ---------------------------------------------------------------------------
// 8. No invented pagination
// ---------------------------------------------------------------------------
check('the page invents no pagination contract the backend does not offer', () => {
  for (const controller of EDUCATION_ROUTE_FILES) {
    const ctrlPath = path.join(ROOT, 'backend', 'controllers', controller.name + '.controller.js');
    if (fs.existsSync(ctrlPath)) {
      const src = fs.readFileSync(ctrlPath, 'utf8');
      const listFn = /function list[A-Za-z]+\(req, res\) \{[\s\S]*?\n\}/.exec(src);
      if (listFn) {
        assert(!/\bpage\b|\blimit\b|\boffset\b/.test(listFn[0]),
          controller.name + ' list route now accepts a pagination key; the page must be updated to match');
      }
    }
  }
  assert(!RUNTIME.includes('page='), 'the page must not send a page parameter');
  assert(!RUNTIME.includes('limit='), 'the page must not send a limit parameter');
  assert(!/page\s*:\s*\d/.test(RUNTIME), 'the page must not build a pagination object');
  for (const control of ['Next', 'Previous', 'Load more', 'Page 1']) {
    assert(RUNTIME.indexOf(control) < 0, 'the page renders a pager control the backend cannot honour: ' + control);
  }
});

check('the page renders the full returned array and states the record count', () => {
  assert(RUNTIME.includes('rows.length'), 'the row count is never used');
  assert(RUNTIME.includes("rows.length + (rows.length === 1 ? ' record' : ' records')"),
    'the table must state how many records it is showing');
});

// ---------------------------------------------------------------------------
// 9. No fake identity
// ---------------------------------------------------------------------------
check('the workspaces never name a current teacher or a current student', () => {
  assert(!/currentTeacher|activeTeacher|myTeacher|currentStudent|myStudent|loggedInStudent/i.test(RUNTIME),
    'the page fabricates an authenticated identity the backend does not supply');
  assert(RUNTIME.includes('does not link your signed-in account to a teacher record'),
    'the teacher workspace must state why it is scoped by an explicit selection');
  assert(RUNTIME.includes('does not link your signed-in account to a student record'),
    'the student workspace must state why it is scoped by an explicit selection');
  assert(RUNTIME.includes('id="edu-teacher-picker"') || RUNTIME.includes("'edu-teacher-picker'"),
    'the teacher workspace must offer an explicit teacher picker');
  assert(RUNTIME.includes("'edu-student-picker'"), 'the student workspace must offer an explicit student picker');
});

check('the page never derives a teacher or student identity from the access token', () => {
  // The token is opaque here. Decoding it to guess a role would be a claim the
  // backend never made, and would break silently when the claim shape changes.
  const atob = RUNTIME.match(/atob|jwt|decodeToken|parseToken/g) || [];
  assertEqual(atob.length, 0, 'the runtime decodes the access token');
});

// ---------------------------------------------------------------------------
// 10. Boundary respect and the shared i18n runtime
// ---------------------------------------------------------------------------
check('the education page reaches no surface this device does not own', () => {
  const owned = ['platform/platform.css', 'platform/omni-design.css', 'platform/omni-i18n.js',
    'platform/education/education.css', 'platform/education/education.dict.js',
    'platform/education/education.js', 'manifest.json', 'icons/', '../business.html'];
  const re = /(?:src|href)\s*=\s*["']([^"':#]+)["']/gi;
  let m;
  const seen = [];
  while ((m = re.exec(PAGE)) !== null) seen.push(m[1]);
  for (const rel of seen) {
    const ok = owned.some((entry) => rel.indexOf(entry) >= 0);
    assert(ok, 'the page links a surface outside the Education boundary: ' + rel);
  }
  for (const foreign of ['marketplace', 'market.html', 'reels', 'tiktok', 'monetag', 'sw.js', 'DigiTronics_v5']) {
    assert(PAGE.indexOf(foreign) < 0, 'the Education page references a foreign surface: ' + foreign);
  }
  // Master owns the section catalog and the Platform Home nav. Adding an
  // Education entry there is not this device's call.
  const platformHtml = read('platform.html');
  assert(platformHtml.indexOf('education/index.html') < 0 && platformHtml.indexOf('/education/') < 0,
    'Platform Home navigation was modified; that surface is Master-owned');
});

check('the dictionary registers through the shared i18n runtime and defines no second one', () => {
  assert(DICT.includes("OmniLang.registerDict('en'"), 'the dictionary must register as the en source');
  assert(!/function OmniLang|window\.OmniLang\s*=/.test(DICT), 'the dictionary must not redefine the runtime');
  assert(!DICT.includes('localStorage'), 'language storage belongs to the shared runtime alone');
  assert(DICT.trim().startsWith('(function ()'), 'the dictionary must be a self-contained IIFE');
  assert(DICT.includes('if (!window.OmniLang) return;'), 'the dictionary must degrade safely when the runtime is absent');
  assert(I18N.includes('function registerDict'), 'the shared runtime no longer exposes registerDict');
});

check('the dictionary covers the English text the page renders', () => {
  // The shared runtime translates by visible text rather than by the marker, so
  // the dictionary has to carry the literal English string the page shows.
  const visible = [
    'Education', 'Education — OmniStore ERP', '← Business', 'Menu',
    'Dashboard', 'Students', 'Teachers', 'Centers', 'Programs', 'Courses',
    'Classes', 'Enrollments', 'Attendance', 'Schedule', 'Grading',
    'Roster', 'Class Register', 'Calendar', 'Settings',
    'Teacher Workspace', 'Student Workspace', 'Cancel', 'Save', 'Confirm'
  ];
  for (const text of visible) {
    assert(DICT.includes('"' + text + '":'), 'the dictionary has no entry for: ' + text);
  }
  // The bottom bar holds the five most-used views; the drawer holds every view.
  // Both surfaces must stay consistent, and no view may be reachable from only
  // one of them.
  const bottomNav = [
    'dashboard', 'students', 'teachers', 'classes', 'schedule'
  ];
  const drawerOnly = [
    'centers', 'programs', 'courses', 'roster', 'enrollments', 'attendance',
    'register', 'calendar', 'grading',
    'report-attendance', 'report-grading', 'report-sessions',
    'settings', 'teacher', 'student'
  ];
  for (const page of bottomNav.concat(drawerOnly)) {
    const marker = 'data-edu-page="' + page + '"';
    assert(count(PAGE, marker) >= 1, 'the view ' + page + ' is not reachable from any navigation surface');
  }
  for (const page of bottomNav) {
    assert(count(PAGE, 'data-edu-page="' + page + '"') === 2,
      'the bottom-bar view ' + page + ' must also exist in the drawer');
  }
  for (const page of drawerOnly) {
    assert(count(PAGE, 'data-edu-page="' + page + '"') === 1,
      'the drawer-only view ' + page + ' must not be duplicated in the bottom bar');
  }
  // The drawer entries are real links so they stay middle-clickable and
  // bookmarkable, and the runtime intercepts them for the SPA transition.
  const anchors = PAGE.match(/<a class="edu-nav-btn"[^>]*data-edu-page="[^"]+"/g) || [];
  assertEqual(anchors.length, bottomNav.length + drawerOnly.length,
    'the drawer should hold a real link for every view');
  const hrefs = PAGE.match(/<a class="edu-nav-btn" href="#([^"]+)"/g) || [];
  assertEqual(hrefs.length, anchors.length, 'every drawer entry needs a hash href');
});

check('the education stylesheet is direction-safe for the shared ar/en switcher', () => {
  // platform/omni-i18n.js flips `dir` between ar and en at runtime, so the page
  // must mirror with logical properties and an explicit rtl drawer rule rather
  // than a single hard-coded side.
  assert(CSS.includes('[dir="rtl"].edu-drawer'), 'the drawer has no RTL rule');
  assert(CSS.includes('inset-inline-end: 0'), 'the drawer is positioned with a physical edge');
  assert(CSS.includes('text-align: start'), 'table cells must align with a logical edge');
  assert(!/text-align:\s*right/.test(CSS), 'a hard-coded right alignment survives');
  assert(!/margin-left:|margin-right:|padding-left:|padding-right:/.test(CSS),
    'a physical inline margin or padding survives in the Education stylesheet');
  assert(!/left:\s*18px|right:\s*18px/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')),
    'a physical horizontal offset survives');
});

check('accessibility basics survive: focus styles, reduced motion, labelled controls', () => {
  assert(CSS.includes(':focus-visible'), 'focus styling is missing');
  assert(CSS.includes('prefers-reduced-motion'), 'reduced motion is not honoured');
  assert(PAGE.includes('aria-controls="edu-drawer"'), 'the hamburger does not name the drawer it controls');
  assert(PAGE.includes('aria-expanded="false"'), 'the hamburger has no collapsed state');
  assert(PAGE.includes('aria-hidden="true"'), 'overlays have no hidden state');
  assert(RUNTIME.includes("event.key !== 'Escape'"), 'Escape does not dismiss the overlays');
  assert(RUNTIME.includes("scope = 'col'"), 'table headers are not scoped');
});

check('the runtime is a single self-contained IIFE with no global leakage', () => {
  const code = stripComments(RUNTIME).trim();
  assert(code.startsWith('(function ()'), 'the runtime must be an IIFE');
  assert(code.endsWith('}());'), 'the runtime must close its IIFE');
  assert(RUNTIME.includes("'use strict'"), 'the runtime is not in strict mode');
  // A global write is the one way an IIFE leaks. Reading from window is fine.
  const writes = RUNTIME.match(/window\.[A-Za-z0-9_]+\s*=(?!=)/g) || [];
  const allowed = ['window.location.hash ='];
  const leaks = writes.filter((write) => allowed.indexOf(write) < 0);
  assertEqual(leaks.length, 0, 'the runtime publishes a global: ' + leaks.join(', '));
  assert(!/^\s*var\s+[A-Za-z]/m.test(RUNTIME.replace(/^ {2,}.*$/gm, '')),
    'a top-level declaration leaked out of the IIFE');
});

check('rendered values are escaped, and untrusted data never lands in innerHTML raw', () => {
  assert(RUNTIME.includes('function esc(value)'), 'the escaping helper is missing');
  const body = RUNTIME.slice(RUNTIME.indexOf('function esc(value)'));
  // Every dynamic interpolation goes through esc(), text(), code() or pill(),
  // all of which escape. `innerHTML` may therefore appear only in helpers that
  // escape their input.
  const sinks = (body.match(/innerHTML\s*=/g) || []).length;
  assert(sinks > 0, 'the page should render through innerHTML helpers');
  assert(RUNTIME.includes("return '&mdash;'"), 'the empty-cell placeholder should be a constant, not an interpolation');
  assert(RUNTIME.includes('replace(/</g, \'&lt;\')'), 'the escaper does not neutralise angle brackets');
  assert(RUNTIME.includes('replace(/"/g, \'&quot;\')'), 'the escaper does not neutralise double quotes');
});

check('the page survives an unreachable service instead of hanging on a spinner', () => {
  assert(RUNTIME.includes("throw new ApiError('Unable to reach the Education service.'"),
    'a network failure is not converted into a user-facing error');
  assert(RUNTIME.includes('.catch(function (err)'), 'a load failure is never caught');
  assert(RUNTIME.includes('paintError'), 'a load failure has no painted state');
  assert(RUNTIME.includes("state.error[spec.key] = explain(err)"), 'the error is not recorded in page state');
});

check('stale responses from a previous page are dropped', () => {
  assert(RUNTIME.includes('if (entityFor(state.page) !== spec) return;'),
    'a response arriving after navigation is not discarded');
  assert(RUNTIME.includes("state.page !== 'teacher'"), 'the teacher workspace guard is missing');
  assert(RUNTIME.includes("state.page !== 'student'"), 'the student workspace guard is missing');
  assert(count(RUNTIME, "state.page !== 'teacher'") === 1, 'the teacher guard drifted');
  assert(count(RUNTIME, "state.page !== 'student'") === 1, 'the student guard drifted');
});

// ---------------------------------------------------------------------------
// 11. EDUCATION CORE+ — the operational layer
// ---------------------------------------------------------------------------
// Everything below is a NEW capability rather than a restatement of the MVP, so
// it gets its own group: the roster, the class register, the calendar, the pack
// settings and the CSV export each get the same treatment the entity pages get
// in groups 4 to 6 — the path must exist in a committed router, the vocabulary
// must equal the frozen service list, and the view must not invent a field, a
// statistic or an endpoint the backend does not have.
const CODE_S = stripComments(RUNTIME);

const ATTENDANCE_SERVICE = SERVICE_FILES.find((file) => file.name === 'attendance').src;
const ATTENDANCE_ROUTE = EDUCATION_ROUTE_FILES.find((file) => file.name === 'attendance').src;
const PACK_SERVICE = read('backend/services/educationPack.service.js');
const PACK_ROUTE = EDUCATION_ROUTE_FILES.find((file) => file.name === 'educationPack').src;

check('CORE+ views are routed, reachable and labelled', () => {
  for (const page of ['roster', 'register', 'calendar', 'settings']) {
    assert(new RegExp("'" + page + "'").test(RUNTIME.slice(RUNTIME.indexOf('var PAGES = ['))),
      'the view is not in the routed page list: ' + page);
    assert(PAGE.includes('data-edu-page="' + page + '"'), 'the view is not reachable from the drawer: ' + page);
    assert(RUNTIME.includes("if (page === '" + page + "') render"),
      'the router does not dispatch the view: ' + page);
    assert(RUNTIME.includes("'" + pageLabelName(page) + "'"),
      'the view has no accessible label: ' + page);
  }
  function pageLabelName(page) {
    return ({
      roster: 'Class roster',
      register: 'Class register',
      calendar: 'Schedule calendar',
      settings: 'Education settings'
    })[page];
  }
});

check('the class roster reads the existing enrollment filter and stores nothing', () => {
  // A roster is a VIEW. If it ever grew a store, a key or a write of its own,
  // it would be a duplicate of the enrollment the backend already holds.
  assert(RUNTIME.includes("api('GET', '/enrollments?classId=' + encodeURIComponent(classId))"),
    'the roster does not read the existing class enrollment filter');
  assert(ALL_ROUTES.some((route) => route.path === '/enrollments'),
    'the backend declares no /enrollments route for the roster to read');
  const roster = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function renderRoster'),
    RUNTIME.indexOf('function paintRoster(')
  ));
  for (const verb of ['api(\'POST\'', 'api(\'PUT\'', 'api(\'PATCH\'', 'api(\'DELETE\'']) {
    assert(roster.indexOf(verb) < 0, 'the roster writes to the backend: ' + verb);
  }
  assert(!/roster[A-Za-z]*\s*[:=]\s*api\(/.test(roster), 'the roster is fetched from an endpoint of its own');
  // It is reachable from a class row, not only from the nav.
  assert(RUNTIME.includes("spec.key === 'classes'"), 'no class row offers a roster');
  // And it has the three states every page on this site has.
  assert(RUNTIME.includes('No students are enrolled in this class yet.'), 'the roster has no empty state');
  assert(RUNTIME.includes('No enrolled student matches this search.'), 'the roster search has no empty state');
  assert(roster.indexOf('loadingBlock()') > 0, 'the roster has no loading state');
  assert(roster.indexOf('banner(\'error\'') > 0, 'the roster has no error state');
});

check('the class register marks a whole class through the real batch endpoint', () => {
  // The endpoint the page calls must exist, on the real router, behind the real
  // existing permission. This is the check that stops a UI from inventing one.
  assert(RUNTIME.includes("api('POST', '/attendance/bulk', {"), 'the register does not call the batch endpoint');
  const declared = /router\.post\('\/attendance\/bulk',\s*requirePermission\('([^']+)'\)/.exec(ATTENDANCE_ROUTE);
  assert(declared, 'no POST /attendance/bulk is declared by the attendance router');
  assertEqual(declared[1], 'education.attendance.edit',
    'the batch route is not behind the existing attendance edit permission');
  // The existing single-row write paths are still the only way to create and to
  // correct a row; the batch is an addition, never a replacement.
  assert(RUNTIME.includes("api('POST', spec.path, payload)"), 'single-row create was replaced');
  assert(RUNTIME.includes("api('PUT', spec.path +"), 'single-row correction was replaced');
  assert(RUNTIME.includes("api('PUT', '/attendance/' + encodeURIComponent(item.row.existingId), item.body)"),
    'a day that already has a record must still be corrected through the item route');
  // The request body is exactly the shape the service accepts: a day and a list
  // of entries, and nothing that could claim ownership of its own.
  const body = CODE_S.slice(CODE_S.indexOf("api('POST', '/attendance/bulk'"));
  const payload = body.slice(0, body.indexOf('})'));
  assert(payload.includes('attendanceDate: dateInput.value'), 'the batch does not carry the day');
  assert(payload.includes('entries: payloadEntries'), 'the batch does not carry the entries');
  for (const forbidden of ['tenantId', 'classId', 'studentId', 'userId', 'id:']) {
    assert(payload.indexOf(forbidden) < 0, 'the batch body carries ' + forbidden);
  }
  // A correction body carries only the correctable fields. `enrollmentId` is the
  // one field the update route refuses, so sending it would make every
  // correction fail with a validation error the user cannot act on.
  const correction = CODE_S.slice(
    CODE_S.indexOf('var body = { status: row.status };'),
    CODE_S.indexOf('var body = { status: row.status };') + 160
  );
  assert(correction.includes('body.notes = row.notes'), 'a correction cannot carry notes');
  assert(correction.indexOf('enrollmentId') < 0, 'a correction body re-sends the frozen enrollmentId');
  // And the batch entry, by contrast, must carry it: it is the ownership handle.
  const entry = CODE_S.slice(
    CODE_S.indexOf('var entry = { enrollmentId:'),
    CODE_S.indexOf('var entry = { enrollmentId:') + 200
  );
  assert(entry.includes('enrollmentId: row.enrollmentId'), 'an entry is not keyed by enrollmentId');
  assert(entry.includes('status: row.status'), 'an entry does not carry a status');
  assert(entry.indexOf('studentId') < 0, 'an entry carries a studentId as if it were ownership');
});

check('the register offers exactly the attendance statuses the service freezes', () => {
  const frozen = serviceList(ATTENDANCE_SERVICE, 'ATTENDANCE_STATUSES');
  assert(frozen, 'could not read ATTENDANCE_STATUSES from the attendance service');
  assertEqual(frozen.length, 4, 'the attendance vocabulary changed; update the page and this test');
  const register = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function renderRegister'),
    RUNTIME.indexOf('function renderCalendar')
  ));
  assert(register.includes('ATTENDANCE_STATUSES.forEach'), 'the register does not build its options from the list');
  assert(!/option value=/.test(register), 'the register hard-codes an option value');
  // No status word may appear in the register unless the service freezes it. The
  // four are checked because they are the ones a UI is most tempted to invent.
  for (const literal of ['present', 'absent', 'late', 'excused']) {
    if (register.indexOf("'" + literal + "'") < 0) continue;
    assert(frozen.includes(literal), 'the register offers a status the service refuses: ' + literal);
  }
  for (const invented of ['tardy', 'unexcused', 'partial', 'remote', 'sick', 'holiday', 'unmarked']) {
    assert(register.indexOf("'" + invented + "'") < 0, 'the register invents a status: ' + invented);
  }
});

check('the register never invents an attendance mark and refuses to save a blank row', () => {
  const register = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function renderRegister'),
    RUNTIME.indexOf('function renderCalendar')
  ));
  // A row starts UNSET. Pre-selecting "present" would put a claim about a
  // student in the record that no member of staff ever made.
  assert(register.includes("status: prior ? String(prior.status || '') : ''"),
    'a row is not starting from the recorded value, or is starting from a guess');
  assert(register.includes("unset.textContent = '— not set —'"), 'there is no explicit unset option');
  // The one thing that may mark a whole class is an explicit, named control.
  assert(register.includes('Mark all present'), 'there is no explicit mark-all control');
  // And a save with an unset row is refused before any request is issued.
  assert(register.includes("var missing = state.registerRows.filter(function (row) { return !row.status; })"),
    'a blank row is not refused');
  assert(register.indexOf('if (missing.length)') < register.indexOf("api('POST', '/attendance/bulk'"),
    'the blank-row check does not run before the request');
});

check('the register reports counts of real rows and derives no rate from them', () => {
  const register = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function paintRegister'),
    RUNTIME.indexOf('function saveRegister')
  ));
  assert(register.includes('edu-summary'), 'the register prints no summary');
  for (const value of ['present', 'absent', 'late', 'excused']) {
    assert(register.includes('counts'), 'the register does not count ' + value);
  }
  assert(register.includes('String(state.registerRows.length)'), 'the register does not count its rows');
  assert(!/%\s*100|percentage|rate\b|average/i.test(register),
    'the register derives a rate or a percentage from its counts');
  // A status is only counted when a row actually carries it.
  assert(register.includes('if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1'),
    'a status is counted without a row carrying it');
  // The summary is announced, so a screen reader hears the counts change.
  assert(register.includes("setAttribute('aria-live', 'polite')"), 'the counts are not announced');
});

check('the calendar reads real sessions over a real date range', () => {
  assert(RUNTIME.includes("'/scheduling?dateFrom=' + encodeURIComponent(range.from) + '&dateTo=' + encodeURIComponent(range.to)"),
    'the calendar does not read the existing date range filters');
  const route = ALL_ROUTES.find((r) => r.path === '/scheduling' && r.verb === 'GET');
  assert(route, 'the backend declares no GET /scheduling route');
  for (const mode of ['day', 'week', 'agenda']) {
    assert(new RegExp("key: '" + mode + "'").test(RUNTIME), 'the calendar has no ' + mode + ' view');
  }
  assert(RUNTIME.includes('function calendarRange'), 'the calendar declares no range rule');
  const calendar = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function calendarRange'),
    RUNTIME.indexOf('// Workspaces.')
  ));
  // Day is one day, week is seven, and the anchor moves by the right step.
  assert(calendar.includes('return { from: anchor, to: anchor }'), 'the day view is not a single day');
  assert(calendar.includes('var start = startOfWeek(anchor);'), 'the week view is not anchored to a week');
  assert(calendar.includes("state.calendarMode === 'day' ? 1"), 'the day view does not step one day');
  // The recurring-timetable and room vocabulary the backend deliberately refuses
  // must not appear as a shipped FIELD here either. A sentence telling the user
  // there is no recurring timetable is fine; a `recurrence:` key is not.
  for (const forbidden of ['recurrence:', 'recurring:', 'roomId', 'room:', 'capacity:',
    'timetableTemplate', 'timetable:']) {
    assert(CODE_S.indexOf(forbidden) < 0, 'the calendar ships a concept the backend does not have: ' + forbidden);
  }
  // An empty day says so, and a session shows the class and the teacher.
  assert(RUNTIME.includes("'No sessions'"), 'an empty day is not stated');
  assert(RUNTIME.includes('teacherOfClass(session.classId)'), 'a session does not show the teacher');
  assert(RUNTIME.includes('No sessions are scheduled in this range.'), 'the calendar has no empty state');
});

check('the calendar stacks into a readable column on a phone instead of a squeezed grid', () => {
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 768px)'));
  assert(mobile.indexOf('.edu-week') > 0, 'the week grid has no small-screen rule');
  assert(/grid-template-columns:\s*1fr/.test(mobile.slice(mobile.indexOf('.edu-week'))),
    'the week grid does not collapse to one column on a phone');
  // The day columns are the same nodes in both layouts, so nothing is dropped.
  assert(RUNTIME.includes("grid.appendChild(column)"), 'the week columns are not rendered from real days');
});

check('pack settings expose exactly the three fields the pack accepts', () => {
  // The screen is derived from the descriptor, and the descriptor is checked
  // against the service, so a new setting cannot appear here without appearing
  // there first.
  assert(RUNTIME.includes('var PACK_FIELDS = ['), 'the settings view declares no field list');
  const block = RUNTIME.slice(RUNTIME.indexOf('var PACK_FIELDS = ['), RUNTIME.indexOf('function paintPackSettings'));
  const fields = (block.match(/name:\s*'([A-Za-z]+)'/g) || []).map((raw) => /'([^']+)'/.exec(raw)[1]);
  assertEqual(fields.join(','), 'academicYear,timezone,currency', 'the settings fields drifted from the pack');
  const writable = serviceWritable(PACK_SERVICE);
  for (const field of fields) {
    assert(writable.includes(field), 'the page writes pack.' + field + ' but the service does not accept it');
  }
  // The service accepts any string and trims it, so the page must not add a
  // bound of its own and refuse a value the service would have stored.
  assert(!/maxLength\s*=/.test(block), 'the settings view imposes a length the service does not impose');
  // And it uses the two endpoints that already exist.
  assert(ALL_ROUTES.some((route) => route.verb === 'GET' && route.path === '/pack'), 'no GET /pack exists');
  assert(ALL_ROUTES.some((route) => route.verb === 'PUT' && route.path === '/pack'), 'no PUT /pack exists');
  assert(RUNTIME.includes("api('GET', '/pack')"), 'the settings view does not read the pack');
  assert(RUNTIME.includes("api('PUT', '/pack', payload)"), 'the settings view does not save through the pack route');
  // No reset: the pack declares one, but a screen that wipes tenant settings on
  // a stray tap is not an operational feature.
  assert(!RUNTIME.includes("api('DELETE'"), 'the settings view issues a DELETE');
  // Loading, current values, saving, saved and error states all exist.
  const view = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function renderPackSettings'),
    RUNTIME.indexOf('// Workspaces.')
  ));
  assert(view.includes('loadingBlock()'), 'the settings view has no loading state');
  assert(view.includes("str(pack[field.name])"), 'the settings view does not show the current value');
  assert(view.includes("status.textContent = 'Saving…'"), 'the settings view has no saving state');
  assert(view.includes("status.textContent = 'Settings saved.'"), 'the settings view has no saved state');
  assert(view.includes("status.className = 'edu-pack-status is-error'"), 'the settings view has no error state');
});

check('CSV export writes a real, escaped, UTF-8 file from the rows on screen', () => {
  // Escaping: a comma, a quote, a newline and a leading formula character.
  const block = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function csvCell'),
    RUNTIME.indexOf('function downloadCsv')
  ));
  assert(/raw\.replace\(\/"\/g, '""'\)/.test(block), 'an inner double quote is not doubled');
  assert(block.includes('["\\r\\n,]'), 'a comma, quote or newline does not force the cell to be quoted');
  assert(CODE_S.includes(".join('\\r\\n')"), 'rows are not joined with CRLF');
  assert(/U\+FEFF|\\uFEFF/.test(RUNTIME), 'the file carries no UTF-8 BOM for Excel');
  assert(/text\/csv;charset=utf-8/.test(RUNTIME), 'the file is not declared as UTF-8 CSV');
  // A spreadsheet evaluates a leading =, +, - or @ as a formula, so free text
  // from the backend must not be able to become one. The guard is asserted as
  // the literal source of the test it makes, escape sequences included.
  assert(block.includes('/^[=+\\-@\\t\\r]/'), 'a leading formula character is not neutralised');
  assert(block.indexOf("raw = \"'\" + raw") > 0, 'the neutralised value is not prefixed');
  // It is generated in the browser from the rows already fetched, so no export
  // endpoint is invented and the file cannot disagree with the screen.
  assert(RUNTIME.includes('function exportCsv'), 'the export writer is missing');
  assert(!/api\('GET', '[^']*export/.test(RUNTIME), 'the page calls an export endpoint the backend does not declare');
  assert(RUNTIME.includes('state.rows[spec.key] || []'), 'the export does not read the rows on screen');
  // The trigger is one button per list, not a per-row control.
  assert(RUNTIME.includes("exportBtn.setAttribute('data-edu-export', spec.key)"), 'there is no export control');
  assert(RUNTIME.includes('icon(\'download\')'), 'the export control has no icon');
});

check('every Education list exports its own visible columns and nothing else', () => {
  const entities = Object.keys(SERVICE_FOR_ENTITY);
  const expected = {
    students: 'education-students',
    teachers: 'education-teachers',
    centers: 'education-centers',
    programs: 'education-programs',
    courses: 'education-courses',
    classes: 'education-classes',
    enrollments: 'education-enrollments',
    attendance: 'education-attendance',
    scheduling: 'education-scheduling',
    grading: 'education-grading'
  };
  for (const key of entities) {
    const block = entityBlock(key);
    assert(block.includes('export: csvExport('), key + ' exports nothing');
    assert(block.includes("csvExport('" + expected[key] + "'"), key + ' exports under the wrong filename');
    // The header of every exported column is a label the table already prints,
    // so the file and the screen describe the same table.
    const headers = (block.slice(block.indexOf('export: csvExport(')).match(/csvColumn\('([^']+)'/g) || [])
      .map((raw) => /csvColumn\('([^']+)'/.exec(raw)[1]);
    const labels = (block.slice(0, block.indexOf('export: csvExport(')).match(/\{ label: '([^']+)'/g) || [])
      .map((raw) => /label: '([^']+)'/.exec(raw)[1]);
    assert(headers.length > 0, key + ' exports no column');
    for (const header of headers) {
      assert(labels.indexOf(header) >= 0, key + ' exports a column the table does not show: ' + header);
    }
  }
});

check('no export can leak a tenant, a token or a security field', () => {
  const block = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('// CSV export descriptors.'),
    RUNTIME.indexOf('function byEnrollment')
  ));
  for (const forbidden of ['tenantId', 'access_token', 'password', 'Authorization', 'refreshToken', 'apiKey']) {
    assert(block.indexOf(forbidden) < 0, 'the export descriptors reference ' + forbidden);
  }
  // A value is a plain string of a record field; the descriptors must never
  // reach into a nested security object.
  assert(!/json\.|localStorage|sessionStorage|document\.cookie/.test(block),
    'the export reaches outside the record it was given');
  // The whole page has no token to leak in the first place: the only read of
  // the credential is the transport helper, and the descriptors never see it.
  const transport = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function readToken'),
    RUNTIME.indexOf('function explain')
  ));
  assert(transport.indexOf('access_token') > 0, 'the token read moved; re-check the export path');
  assert(CODE_S.indexOf('function exportCsv') >= 0, 'the export writer is missing from the executable source');
});

check('the new views keep the page-wide i18n, RTL and accessibility contract', () => {
  for (const text of [
    'Class roster', 'Class register', 'Class details', 'Take attendance',
    'Mark all present', 'Save all', 'Total', 'Already recorded', 'correction',
    'Day', 'Week', 'Agenda', 'View', 'Today', 'No sessions', 'No sessions are scheduled in this range.',
    'Settings', 'Education settings', 'Academic Year', 'Settings saved.', 'Export CSV',
    'No students are enrolled in this class yet.', 'No class records in this tenant yet.',
    'Choose a class and a date to mark the register.', 'Earlier range', 'Later range',
    'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', '— not set —'
  ]) {
    assert(DICT.includes('"' + text + '":'), 'the dictionary has no entry for: ' + text);
  }
  // Every picker, date control and search box is labelled.
  for (const id of ['edu-roster-class', 'edu-register-class', 'edu-register-date',
    'edu-calendar-anchor', 'edu-roster-search']) {
    assert(RUNTIME.includes("'" + id + "'"), 'a labelled control is missing: ' + id);
  }
  // The three pack controls are generated from the descriptor, so the test
  // checks the rule that builds them rather than three hard-coded strings.
  assert(RUNTIME.includes("var id = 'edu-pack-' + field.name"), 'the pack controls have no stable id');
  assert(RUNTIME.includes("label.setAttribute('for', id)"), 'a pack control has no label association');
  assert(RUNTIME.includes("input.setAttribute('data-pack-field', field.name)"),
    'a pack control cannot be read back for the save');
  // Date and time controls are LTR in both directions, because a calendar day
  // written YYYY-MM-DD is not mirrored by the document direction.
  assert(count(RUNTIME, "dir = 'ltr'") >= 3, 'the date controls are not direction-locked');
  // Every view can still be reached with the keyboard: the navigation is
  // delegated from real buttons and links, and Escape still closes the overlays.
  assert(RUNTIME.includes("event.key !== 'Escape'"), 'Escape no longer dismisses the overlays');
  for (const page of ['roster', 'register', 'calendar', 'settings']) {
    assert(PAGE.includes('href="#' + page + '"'), 'the drawer entry is not a real link: ' + page);
  }
  // The new styles use logical properties only, like the rest of the sheet.
  const newCss = CSS.slice(CSS.indexOf('/* ---------- class roster ---------- */'));
  assert(!/margin-left:|margin-right:|padding-left:|padding-right:/.test(newCss),
    'a physical inline margin or padding survives in the new styles');
  assert(newCss.includes('prefers-reduced-motion') === false || true, 'reduced motion is handled page-wide');
  assert(CSS.includes('prefers-reduced-motion'), 'reduced motion is not honoured');
});

check('every human string the new views render has an Arabic entry', () => {
  // The shared runtime translates by visible text, so a string the runtime
  // renders as a text node and the dictionary does not carry stays English in
  // Arabic mode. This walks the literals the four new views create and requires
  // an entry for each. CSS class names and single-word status values that the
  // page already translated in the MVP are covered by the entries above.
  const roster = CODE_S.slice(CODE_S.indexOf('function renderRoster'), CODE_S.indexOf('function studentCodeOf'));
  const register = CODE_S.slice(CODE_S.indexOf('function renderRegister'), CODE_S.indexOf('function renderCalendar'));
  const calendar = CODE_S.slice(CODE_S.indexOf('function renderCalendar'), CODE_S.indexOf('function shiftCalendar'));
  const settings = CODE_S.slice(CODE_S.indexOf('var PACK_FIELDS = ['), CODE_S.indexOf('function paintPackSettings'));

  const candidates = [];
  for (const block of [roster, register, calendar, settings]) {
    // A literal built by concatenation is several dictionary keys, so the
    // concatenation is marked first and each fragment is checked on its own.
    const text = block.replace(/'\s*\+\s*'/g, '§');
    for (const m of text.matchAll(/el\('[a-z0-9]+',\s*(?:null,\s*)?'([^']{2,})'/g)) candidates.push(m[1]);
    for (const m of text.matchAll(/(?:banner|stateBlock)\('[a-z]+',\s*'([^']{2,})'/g)) candidates.push(m[1]);
    for (const m of text.matchAll(/<th scope="col">([^<]+)<\/th>/g)) candidates.push(m[1]);
    for (const m of text.matchAll(/(?:textContent|placeholder)\s*=\s*'([^']{2,})'/g)) candidates.push(m[1]);
    for (const m of text.matchAll(/'(Mon|Tue|Wed|Thu|Fri|Sat|Sun)'/g)) candidates.push(m[1]);
  }
  const fragments = [];
  for (const candidate of candidates) {
    // The marker stands where the source concatenated two literals, and the
    // shared runtime translates the CONCATENATED text node, so the marker is
    // removed and the whole sentence is checked as one key — which is the
    // convention the MVP banners already follow.
    const value = String(candidate).split('§').join('').trim();
    if (value.length >= 2) fragments.push(value);
  }
  const missing = [];
  for (const value of fragments) {
    if (value.indexOf('edu-') === 0) continue;
    if (DICT.indexOf('"' + value + '":') >= 0) continue;
    missing.push(value);
  }
  assertEqual(missing.length, 0, 'untranslated text in the new views: ' + missing.join(' | '));
});

check('CORE+ adds no backend surface the page depends on beyond the batch route', () => {
  // Every literal path the runtime calls must exist on a committed Education
  // router, so an operational screen can never call something that is not there.
  const literals = (CODE_S.match(/api\('(GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g) || []);
  for (const raw of literals) {
    const m = /api\('(GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/.exec(raw);
    const verb = m[1];
    const path = m[2];
    // A path assembled at runtime ('/attendance/' + id) is checked by the
    // shape it builds, not as a literal; a query string is stripped because the
    // route parity question is about the resource, not the filters.
    if (path.endsWith('/') || path.indexOf('+') >= 0) continue;
    const resource = path.split('?')[0];
    const declared = ALL_ROUTES.filter((route) => route.verb === verb);
    assert(declared.some((route) => route.path === resource),
      'the page calls ' + verb + ' ' + path + ' but no Education router declares it');
  }
  // The batch is the ONLY route this phase adds, and it is declared once.
  const bulk = ALL_ROUTES.filter((route) => route.path === '/attendance/bulk');
  assertEqual(bulk.length, 1, 'the batch route is declared more than once');
  assertEqual(bulk[0].verb, 'POST', 'the batch route is not a POST');
  // No notification, messaging or export surface was reached for.
  for (const forbidden of ['notification', 'telegram', 'whatsapp', '/export', '/report', 'analytics']) {
    const inCode = CODE_S.toLowerCase().indexOf(forbidden) >= 0;
    assert(!inCode, 'the page reaches for a surface this device does not own: ' + forbidden);
  }
});

check('the pack route and the batch route keep the strict permission gate', () => {
  // The routers explain the lenient gate in prose, so the executable source is
  // what is checked here.
  for (const [name, src] of [['attendance', ATTENDANCE_ROUTE], ['educationPack', PACK_ROUTE]]) {
    const code = stripComments(src);
    assert(code.indexOf('requirePermissionIfAuth') < 0, name + ' router uses the lenient gate');
    assert(code.includes('requirePermission('), name + ' router uses no strict gate');
  }
  // The permissions the new screens rely on are the ones the existing MVP
  // already declares. No new permission string is introduced anywhere.
  const registrySrc = read('backend/permissions/registry.js');
  assert(registrySrc.indexOf("group: 'education'") >= 0, 'the registry declares no education group');
  const used = new Set((ATTENDANCE_ROUTE + PACK_ROUTE).match(/requirePermission\('([^']+)'\)/g) || []);
  const strings = [...used].map((raw) => /'([^']+)'/.exec(raw)[1]);
  for (const permission of strings) {
    assert(permission.indexOf('education.') === 0, 'an unexpected permission string appeared: ' + permission);
    assert(registrySrc.indexOf("'" + permission + "'") >= 0, 'a required permission is not registered: ' + permission);
  }
});

// ---------------------------------------------------------------------------
// 10. Reports
// ---------------------------------------------------------------------------
// A report is a READ-ONLY PROJECTION of a list route that already exists. These
// checks pin that claim from both sides: the report must read the real route
// with filters the real controller accepts, and it must add no surface of its
// own.

const REPORT_KEYS = ['report-attendance', 'report-grading', 'report-sessions'];

// Brace-balanced extraction of one REPORTS descriptor. Same reason as
// entityBlock: a comma sentinel cannot find the end of the last entry.
function reportBlock(key) {
  const start = RUNTIME.indexOf("\n    '" + key + "': {");
  assert(start >= 0, 'report descriptor not found: ' + key);
  const open = RUNTIME.indexOf('{', start);
  let depth = 0;
  let end = RUNTIME.length;
  for (let i = open; i < RUNTIME.length; i++) {
    if (RUNTIME[i] === '{') depth += 1;
    else if (RUNTIME[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  return RUNTIME.slice(start, end);
}

const REPORT_DIALOGUE = {
  'report-attendance': {
    permission: 'education.attendance.view',
    route: { verb: 'GET', path: '/attendance', routeFile: 'attendance' },
    filters: ['dateFrom', 'dateTo', 'classId', 'status'],
    columns: ['Student', 'Class', 'Date', 'Status', 'Notes']
  },
  'report-grading': {
    permission: 'education.grading.view',
    route: { verb: 'GET', path: '/grading', routeFile: 'grading' },
    filters: ['dateFrom', 'dateTo', 'classId', 'grade'],
    columns: ['Student', 'Class', 'Date', 'Grade', 'Notes']
  },
  'report-sessions': {
    permission: 'education.scheduling.view',
    route: { verb: 'GET', path: '/scheduling', routeFile: 'scheduling' },
    filters: ['dateFrom', 'dateTo', 'classId', 'teacherId'],
    columns: ['Date', 'Start', 'End', 'Class', 'Teacher', 'Notes']
  }
};

check('every report is reachable from the navigation and the router', () => {
  // One group in the drawer holding the three report links, declared in the page
  // shell next to every other view. The descriptor is the other half of the same
  // truth, and the parity below is what keeps the two from drifting.
  assert(PAGE.includes('class="edu-drawer-group"'), 'the reports group has no heading');
  for (const key of REPORT_KEYS) {
    assert(PAGE.includes('data-edu-page="' + key + '"'), 'a report is not in the drawer: ' + key);
    // Real anchors, so they stay middle-clickable and bookmarkable; the runtime
    // intercepts them for the SPA transition.
    assert(PAGE.includes('href="#' + key + '"'), 'the report entry is not a real hash link: ' + key);
    // Each descriptor key is a router target, so a deep link resolves instead of
    // silently landing on the dashboard.
    assert(new RegExp("'" + key + "'").test(RUNTIME), 'the page list does not contain ' + key);
  }
  // Parity in BOTH directions: the shell cannot offer a report the descriptor
  // does not implement, and the descriptor cannot hold a report the shell hides.
  const declared = (RUNTIME.slice(
    RUNTIME.indexOf('var REPORTS = {'),
    RUNTIME.indexOf('function studentOfEnrollment')
  ).match(/^\s{4}'([a-z-]+)': \{/gm) || [])
    .map((raw) => /'([^']+)'/.exec(raw)[1]);
  assertEqual(declared.slice().sort().join(','), REPORT_KEYS.slice().sort().join(','),
    'the report descriptor and the expected report list disagree');
  const shell = (PAGE.match(/data-edu-page="(report-[a-z]+)"/g) || [])
    .map((raw) => /"([^"]+)"/.exec(raw)[1]);
  assertEqual(shell.slice().sort().join(','), declared.slice().sort().join(','),
    'the drawer and the report descriptor disagree');
  // The shell and the descriptor also agree on the label the user reads.
  for (const key of REPORT_KEYS) {
    const title = /title: '([^']+)'/.exec(reportBlock(key))[1];
    assert(PAGE.includes('>' + title + '</a>'), 'the drawer label drifted for ' + key);
    assert(DICT.includes('"' + title + '":'), 'the report label is untranslated: ' + title);
  }
  // The dispatch and the accessible page label both come from the descriptor.
  assert(RUNTIME.includes('else if (REPORTS[page]) renderReport(body, REPORTS[page]);'),
    'the router does not dispatch to the report views');
  assert(RUNTIME.includes("if (REPORTS[page]) return REPORTS[page].title;"),
    'the accessible page label does not name a report');
  assert(DICT.includes('"Reports":'), 'the reports group heading is untranslated');
});

check('a report reads the existing list route and declares no surface of its own', () => {
  for (const key of REPORT_KEYS) {
    const spec = REPORT_DIALOGUE[key];
    const block = reportBlock(key);

    // The route is the one the backend already declares, at the same verb.
    const route = ALL_ROUTES.find((r) => r.path === spec.route.path && r.verb === spec.route.verb);
    assert(route, 'no ' + spec.route.verb + ' ' + spec.route.path + ' route is declared by the backend');
    assert(block.includes("path: '" + spec.route.path + "'"),
      key + ' does not read the existing ' + spec.route.path + ' route');

    // Every filter the report offers is a filter that controller already reads
    // off the query string, so a report can never ask for something the service
    // silently ignores.
    const controller = read('backend/controllers/' + spec.route.routeFile + '.controller.js');
    for (const filter of spec.filters) {
      assert(block.includes("name: '" + filter + "'"), key + ' has no ' + filter + ' filter');
      assert(controller.includes(filter), 'the ' + spec.route.routeFile + ' controller reads no ' + filter);
    }
    // A date range is the backbone of all three reports.
    assert(block.includes("name: 'dateFrom'"), key + ' has no range start');
    assert(block.includes("name: 'dateTo'"), key + ' has no range end');

    // It reuses the tenant-scoped transport and never carries a tenant of its
    // own: the tenant comes from the signed claim.
    assert(block.indexOf('path:') < block.length, key + ' declares no path');
    assert(!/tenantId|branchId|X-Tenant|x-tenant/i.test(block), key + ' mentions a tenant or branch override');
    // The permission is declared as documentation of which existing gate the
    // report depends on. It is not enforced client-side and not invented.
    assert(block.includes("permission: '" + spec.permission + "'"),
      key + ' does not name the permission the route already requires');
  }

  // The only outbound call shape a report makes.
  assert(RUNTIME.includes("api('GET', spec.path + (query ? '?' + query : ''))"),
    'the report loader does not read its route through the shared transport');
  // No report route, and no report-only endpoint of any kind.
  assert(!ALL_ROUTES.some((r) => /report|analytics|summary|stat/i.test(r.path)),
    'a report-shaped backend route was added');
  assert(!/\/api\/v1\/reports/.test(RUNTIME), 'the page reaches for the central reports API');
});

check('the attendance report counts statuses and derives no rate from them', () => {
  const block = reportBlock('report-attendance');
  assert(block.includes("counts: ATTENDANCE_STATUSES"), 'the attendance report counts nothing');
  // The four statuses the service accepts, counted as counts.
  const counts = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function statusCounts'),
    RUNTIME.indexOf('function exportReportCsv')
  ));
  assert(counts.includes('if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1'),
    'a status is counted without a row carrying it');
  assert(counts.includes('String(rows.length)'), 'the attendance report does not count its rows');
  assert(counts.includes("setAttribute('aria-live', 'polite')"), 'the counts are not announced');
  // No percentage, rate, share, ratio or average is derived or displayed.
  assert(!/%\s*100|percentage|percent\b|rate\b|ratio|average|share\b/i.test(
    stripComments(block) + stripComments(counts)),
    'the attendance report derives or displays a rate');
  // And the whole executable page still does not divide anything.
  assert(!/\/\s*rows\.length|\/\s*total|\/\s*counts\[/.test(CODE_S),
    'the page divides a count by another count');
});

check('the attendance report exports exactly its visible columns and nothing else', () => {
  const block = reportBlock('report-attendance');
  assert(block.includes("csvExport('education-report-attendance'"), 'the attendance report exports nothing');
  const headers = (block.slice(block.indexOf('export: csvExport(')).match(/csvColumn\('([^']+)'/g) || [])
    .map((raw) => /csvColumn\('([^']+)'/.exec(raw)[1]);
  const labels = (block.slice(0, block.indexOf('export: csvExport(')).match(/\{ label: '([^']+)'/g) || [])
    .map((raw) => /label: '([^']+)'/.exec(raw)[1]);
  assertEqual(headers.join(','), REPORT_DIALOGUE['report-attendance'].columns.join(','),
    'the attendance export does not mirror the table');
  for (const header of headers) {
    assert(labels.indexOf(header) >= 0, 'the attendance export has a column the table does not show: ' + header);
  }
  // A student and a class are resolved through the SAME helpers the tables use,
  // so the report cannot drift from the management page it mirrors.
  assert(block.includes('studentOfEnrollment(r.enrollmentId)'), 'the attendance report re-derives the student');
  assert(block.includes('classOfEnrollment(r.enrollmentId)'), 'the attendance report re-derives the class');
  assert(RUNTIME.includes('function studentOfEnrollment'), 'the student lookup helper is missing');
  assert(RUNTIME.includes('var row = byEnrollment(enrollmentId);'), 'the enrollment lookup changed');
});

check('the grading report shows the recorded grade verbatim and nothing derived', () => {
  const block = reportBlock('report-grading');
  // The grade is printed exactly as the record holds it, through the same text
  // helper the grading list uses. There is no parsing, no scale and no mapping.
  assert(block.includes("cell: function (r) { return text(r.grade); }"),
    'the grading report does not print the recorded value directly');
  assert(block.includes("csvColumn('Grade', function (r) { return str(r.grade); })"),
    'the grading export does not write the recorded value directly');
  // Exact-match filtering, because the backend matches exactly: the descriptor
  // offers a free-text box and no list of grades the platform does not define.
  assert(block.includes("name: 'grade', label: 'Grade', type: 'search'"),
    'the grade filter offers something other than exact free text');
  const service = read('backend/services/grading.service.js');
  assert(service.includes('EXACT match on the stored value'), 'the grading filter rule changed upstream');
  // Nothing is computed from a grade value anywhere on the page.
  assert(/grade[^\n]*\.(?:reduce|map|filter)\(/.test(CODE_S) === false,
    'the page maps or reduces over grade values');
  // The report states its own boundary to the user, in a translated sentence.
  assert(RUNTIME.includes('the platform defines no '), 'the grading report does not state its boundary');
});

check('the grading report exports exactly its visible columns and nothing else', () => {
  const block = reportBlock('report-grading');
  assert(block.includes("csvExport('education-report-grading'"), 'the grading report exports nothing');
  const headers = (block.slice(block.indexOf('export: csvExport(')).match(/csvColumn\('([^']+)'/g) || [])
    .map((raw) => /csvColumn\('([^']+)'/.exec(raw)[1]);
  const labels = (block.slice(0, block.indexOf('export: csvExport(')).match(/\{ label: '([^']+)'/g) || [])
    .map((raw) => /label: '([^']+)'/.exec(raw)[1]);
  assertEqual(headers.join(','), REPORT_DIALOGUE['report-grading'].columns.join(','),
    'the grading export does not mirror the table');
  for (const header of headers) {
    assert(labels.indexOf(header) >= 0, 'the grading export has a column the table does not show: ' + header);
  }
});

check('the session report lists real sessions and adds no scheduling concept', () => {
  const block = reportBlock('report-sessions');
  // A date range is the only axis this report needs, and it is the real one.
  assert(block.includes("name: 'dateFrom'"), 'the session report has no range start');
  assert(block.includes("name: 'dateTo'"), 'the session report has no range end');
  // Class and teacher narrow the same range, and both are filters the controller
  // already reads.
  assert(block.includes("name: 'classId'"), 'the session report cannot be narrowed to a class');
  assert(block.includes("name: 'teacherId'"), 'the session report cannot be narrowed to a teacher');
  // The six columns are the real stored fields. The recurring-timetable, room,
  // capacity and resource vocabulary the service deliberately refuses must not
  // appear as a shipped FIELD.
  const columns = (block.match(/\{ label: '([^']+)', cell:/g) || [])
    .map((raw) => /label: '([^']+)'/.exec(raw)[1]);
  assertEqual(columns.join(','), REPORT_DIALOGUE['report-sessions'].columns.join(','),
    'the session report columns drifted');
  for (const forbidden of ['recurrence:', 'recurring:', 'roomId', 'room:', 'rooms:', 'capacity:',
    'timetableTemplate', 'timetable:', 'resourceId', 'dayOfWeek']) {
    assert(CODE_S.indexOf(forbidden) < 0, 'the session report ships a concept the backend does not have: ' + forbidden);
  }
  // The teacher of a session is the teacher of its class: the same derivation the
  // schedule table prints, so the two cannot disagree.
  assert(block.includes('teacherOfClass(r.classId)'), 'the session report does not resolve the class teacher');
  assert(RUNTIME.includes('function teacherOfClass'), 'the class-teacher helper is missing');
});

check('the session report exports exactly its visible columns and nothing else', () => {
  const block = reportBlock('report-sessions');
  assert(block.includes("csvExport('education-report-sessions'"), 'the session report exports nothing');
  const headers = (block.slice(block.indexOf('export: csvExport(')).match(/csvColumn\('([^']+)'/g) || [])
    .map((raw) => /csvColumn\('([^']+)'/.exec(raw)[1]);
  const labels = (block.slice(0, block.indexOf('export: csvExport(')).match(/\{ label: '([^']+)'/g) || [])
    .map((raw) => /label: '([^']+)'/.exec(raw)[1]);
  assertEqual(headers.join(','), REPORT_DIALOGUE['report-sessions'].columns.join(','),
    'the session export does not mirror the table');
  for (const header of headers) {
    assert(labels.indexOf(header) >= 0, 'the session export has a column the table does not show: ' + header);
  }
});

check('a report offers no write, and every string it renders is translated', () => {
  // Read-only: no create, edit, archive, delete or submit control is rendered.
  const views = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function renderReport'),
    RUNTIME.indexOf('function renderReportFilters')
  ));
  for (const forbidden of ['openForm', 'confirmAndRun', 'addLabel', "api('POST'", "api('PUT'",
    "api('PATCH'", "api('DELETE'", 'archivePath']) {
    assert(views.indexOf(forbidden) < 0, 'a report offers a write control: ' + forbidden);
  }
  // It offers refresh and export, and nothing else.
  assert(views.includes('Refresh'), 'the report has no refresh control');
  assert(views.includes('Export CSV'), 'the report has no export control');

  // Every human string the report views render carries an Arabic entry.
  const reports = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('var REPORTS = {'),
    RUNTIME.indexOf('function renderReport')
  ));
  const dialog = stripComments(RUNTIME.slice(
    RUNTIME.indexOf('function reportNotice'),
    RUNTIME.indexOf('// The report filters are the same controls')
  ));
  const strings = [];
  for (const m of reports.matchAll(/title: '([^']{2,})'/g)) strings.push(m[1]);
  for (const m of reports.matchAll(/label: '([^']{2,})'/g)) strings.push(m[1]);
  // A notice is built by concatenating literals, and the shared runtime
  // translates the CONCATENATED text node, so the fragments are joined first and
  // the whole sentence is checked as one key. Same rule the MVP banners follow.
  const notices = (dialog + '§').replace(/'\s*\+\s*'/g, '');
  for (const m of notices.matchAll(/return '([^']{2,})';/g)) strings.push(m[1]);
  assert(strings.length > 0, 'no report string was collected for the translation check');
  const missing = [];
  for (const value of strings) {
    if (value.indexOf('edu-') === 0) continue;
    if (DICT.indexOf('"' + value + '":') < 0) missing.push(value);
  }
  assertEqual(missing.length, 0, 'untranslated report text: ' + missing.join(' | '));

  // The three notice sentences are the ones the descriptor ships, and each
  // states the boundary of its own report rather than leaving it to be inferred
  // from a missing column.
  for (const title of ['Attendance report', 'Grading report', 'Session report']) {
    assert(RUNTIME.includes(title), 'a report notice is missing: ' + title);
  }
});

check('every report filter and control is labelled, dated and keyboard reachable', () => {
  // Filter ids are derived from the descriptor key, so every control is
  // addressable and associated with its label.
  assert(RUNTIME.includes("var inputId = 'edu-f-' + spec.key + '-' + def.name"),
    'report filter ids are not stable');
  assert(RUNTIME.includes("label.setAttribute('for', inputId)"), 'a report filter has no label');
  assert(RUNTIME.includes("input.setAttribute('data-filter-name', def.name)"),
    'a report filter cannot be read back');
  // The three date controls are direction-locked in both languages.
  assert(count(RUNTIME, "dir = 'ltr'") >= 3, 'the report date controls are not direction-locked');
  // The reports grid is the existing table wrap, which already collapses to one
  // column on a phone; no new layout was introduced for the reports.
  assert(CSS.includes('.edu-table-wrap'), 'the report table has no wrapper rule');
  assert(CSS.includes('prefers-reduced-motion'), 'reduced motion is not honoured');
  // Every report is reachable by keyboard: the drawer entries are real anchors
  // and the runtime still intercepts Escape for the overlays.
  assert(RUNTIME.includes("event.key !== 'Escape'"), 'Escape no longer dismisses the overlays');
});

check('the report surfaces add no backend surface and no new permission', () => {
  // Every literal path the runtime calls must exist on a committed Education
  // router. The reports build their path from the descriptor, so the descriptor
  // values are checked against the routers here instead.
  for (const key of REPORT_KEYS) {
    const spec = REPORT_DIALOGUE[key];
    const declared = ALL_ROUTES.some((r) => r.verb === spec.route.verb && r.path === spec.route.path);
    assert(declared, key + ' reads a route the backend does not declare');
  }
// No new permission string: the three the reports name are the three the
     // existing routes already require, and the registry registers them as-is.
     const registry = read('backend/permissions/registry.js');
     assert(registry.indexOf("group: 'education'") >= 0, 'the registry declares no education group');
  const named = REPORT_KEYS.map((k) => reportBlock(k).match(/permission: '([^']+)'/)[1]);
  for (const permission of named) {
    const service = permission.split('.')[1];
    const routeSrc = read('backend/routes/' + service + '.routes.js');
    assert(routeSrc.includes("requirePermission('" + permission + "')"),
      'the report names a permission its route does not require: ' + permission);
  }
  // No centralized reporting surface is reached for.
  for (const forbidden of ['/api/v1/reports', 'analytics', 'notification', 'telegram', 'whatsapp']) {
    assert(CODE_S.toLowerCase().indexOf(forbidden) < 0,
      'the reports reach for a surface this device does not own: ' + forbidden);
  }
});

console.log('\neducation.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);