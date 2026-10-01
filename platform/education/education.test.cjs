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
  const end = RUNTIME.indexOf('\n    },', start);
  return RUNTIME.slice(start, end < 0 ? RUNTIME.length : end);
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
    'centers', 'programs', 'courses', 'enrollments', 'attendance', 'grading',
    'teacher', 'student'
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

console.log('\neducation.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
