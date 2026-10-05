'use strict';

// Education module hygiene — regression guard for two defects found in the
// platform-completion audit:
//
// 1. `educationCore` was a SECOND, parallel Education implementation that was
//    never mounted in server.js, yet it carried 40+ live-looking routes behind
//    `requirePermissionIfAuth('settings.view')`. That middleware returns
//    `next()` unconditionally when `config.authRequired` is false, and
//    AUTH_REQUIRED defaults to false. Mounting it would have exposed every
//    entity — including `DELETE /:id` on each — with NO identity requirement.
//    The files are deleted; this suite makes sure they cannot come back and
//    that the real, strongly-gated routers remain the only Education surface.
//
// 2. `educationBookings.json` and `educationRatings.json` were written by the
//    mounted booking/rating routers but were missing from .gitignore, so tenant
//    bookings and free-text performance feedback would have been committed on
//    first write.
//
// Neither check mutates runtime data: it reads source, .gitignore and the
// in-memory Express app only.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const SERVER_JS = read('backend/server.js');
const GITIGNORE = read('.gitignore');
const AUTHORIZE_JS = read('backend/middleware/authorize.js');

let app;
let dataDir;
registerCleanup(() => [], () => [dataDir]);

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
});

describe('the dead educationCore module stays gone', () => {
  const REMOVED = [
    'backend/routes/educationCore.routes.js',
    'backend/controllers/educationCore.controller.js',
    'backend/services/educationCore.service.js',
    'backend/tests/educationCore.authz.test.js',
    'backend/tests/educationCore.routes.test.js',
    'backend/tests/educationCore.service.test.js',
    'backend/tests/educationCore.tenantIsolation.test.js'
  ];

  test.each(REMOVED)('%s is not in the tree', (rel) => {
    expect(exists(rel)).toBe(false);
  });

  test('server.js does not require or mount educationCore', () => {
    expect(SERVER_JS).not.toMatch(/educationCore/);
  });

  test('no live source file still references the educationCore store', () => {
    expect(read('backend/services/booking.service.js')).not.toMatch(/educationCore/);
    expect(read('backend/services/rating.service.js')).not.toMatch(/educationCore/);
  });

  // If someone reintroduces the weak gate, this is the failure they must not
  // be able to mount behind it.
  test('requirePermissionIfAuth really is a no-op when AUTH_REQUIRED is off', () => {
    expect(AUTHORIZE_JS).toMatch(
      /function requirePermissionIfAuth\(permission\)[\s\S]*?if \(!config\.authRequired\) return next\(\);/
    );
  });

  test('the real Education routers are the only mounted Education surface', () => {
    const all = [...SERVER_JS.matchAll(/app\.use\('\/api\/v1\/tenant\/education',\s*(\w+)\)/g)].map(
      (m) => m[1]
    );
    // One of the mounts is the attachTeacherActor middleware, not a router.
    const mounted = all.filter((n) => n.endsWith('Routes'));
    expect(all).toContain('attachTeacherActor');
    expect(mounted.length).toBe(13); // pack + 10 entities + booking + rating
    for (const name of mounted) expect(name).not.toMatch(/educationCore/i);
    for (const required of ['educationPackRoutes', 'studentRoutes', 'teacherRoutes',
      'centerRoutes', 'programRoutes', 'courseRoutes', 'classRoutes',
      'enrollmentRoutes', 'attendanceRoutes', 'schedulingRoutes', 'gradingRoutes',
      'bookingRoutes', 'ratingRoutes']) {
      expect(mounted).toContain(required);
    }
  });
});

// The legacy Education Center surface was a SECOND frontend bound to the
// educationCore routes. `education.html` was reachable from the business.html
// Education card, and `platform/education.js` called six routes that only
// educationCore served: GET /dashboard, GET /courses/:courseId/lessons,
// PATCH /lessons/:id, PATCH /enrollments/:id/status,
// GET /enrollments/:id/progress and POST /progress/lesson. Every one of those
// is now 404, so the page was a dead end. Both files are deleted and the card
// routes to the canonical entry instead.
describe('the legacy Education Center surface stays gone', () => {
  test('education.html is not in the tree', () => {
    expect(exists('education.html')).toBe(false);
  });

  test('platform/education.js is not in the tree', () => {
    expect(exists('platform/education.js')).toBe(false);
  });

  test('the canonical Education surface is intact', () => {
    for (const rel of ['education/index.html', 'platform/education/education.js',
      'platform/education/education.css', 'platform/education/education.dict.js']) {
      expect(exists(rel)).toBe(true);
    }
    expect(read('education/index.html')).toContain('../platform/education/education.js');
  });

  test('the business.html Education card routes to the canonical entry', () => {
    const business = read('business.html');
    expect(business).toMatch(/window\.location\.href='\/education\/index\.html'/);
    expect(business).not.toMatch(/location\.href='education\.html'/);
  });

  test('no html page loads the removed client', () => {
    for (const f of ['business.html', 'platform.html', 'index.html']) {
      expect(read(f)).not.toMatch(/platform\/education\.js/);
    }
  });

  test('no live frontend calls a route only educationCore served', () => {
    // Every shipped frontend runtime, scanned for the deleted route shapes.
    const runtimes = ['platform/education/education.js', 'education/index.html'];
    const ONLY_EDUCATIONCORE = [
      /api(?:Call)?\(\s*'GET',\s*'\/dashboard'/,
      /api(?:Call)?\(\s*'GET',\s*'\/courses\/'\s*\+/,          // /courses/:id/lessons
      /api(?:Call)?\(\s*'(?:PATCH|DELETE)'\s*,\s*'\/lessons\//,
      /api(?:Call)?\(\s*'PATCH'\s*,\s*'\/enrollments\/'\s*\+[^+]*\/status/,
      /api(?:Call)?\(\s*'POST'\s*,\s*'\/progress\/lesson'/
    ];
    for (const rel of runtimes) {
      const src = read(rel);
      for (const re of ONLY_EDUCATIONCORE) expect(src).not.toMatch(re);
    }
  });

  test('the student workspace reads progress from the canonical student route', () => {
    // The Student workspace used to ask GET /enrollments/:id/progress with a
    // .catch() wrapper that swallowed the 404, so the Progress card could never
    // render. The canonical endpoint is GET /students/:id/progress: the page
    // reads it once and surfaces a failure as a banner instead of hiding the
    // card, and no /enrollments/:id/progress call may return.
    const src = read('platform/education/education.js');
    expect(src).toMatch(/api\('GET',\s*'\/students\/'\s*\+\s*encodeURIComponent\(studentId\)\s*\+\s*'\/progress'\)/);
    expect(src).not.toMatch(/enrollments\/'\s*\+\s*encodeURIComponent\([^)]*\)\s*\+\s*'\/progress'/);
  });

  test('no lesson entity is fabricated by the progress endpoint', () => {
    expect(read('backend/controllers/student.controller.js')).toMatch(/lessons:\s*\{\s*\/\/[\s\S]*?total:\s*0/);
  });
});

describe('every live Education runtime store is gitignored', () => {
  // Each entry is (store file, service that writes it). The service must be
  // reachable from a mounted router, otherwise the store is dead weight.
  const LIVE_STORES = [
    ['educationPack.json', 'educationPack.service.js'],
    ['educationStudents.json', 'student.service.js'],
    ['educationTeachers.json', 'teacher.service.js'],
    ['educationCenters.json', 'center.service.js'],
    ['educationPrograms.json', 'program.service.js'],
    ['educationCourses.json', 'course.service.js'],
    ['educationClasses.json', 'class.service.js'],
    ['educationEnrollments.json', 'enrollment.service.js'],
    ['educationAttendance.json', 'attendance.service.js'],
    ['educationScheduling.json', 'scheduling.service.js'],
    ['educationGrading.json', 'grading.service.js'],
    ['educationBookings.json', 'booking.service.js'],
    ['educationRatings.json', 'rating.service.js']
  ];

  test.each(LIVE_STORES)('%s is ignored by git', (file) => {
    expect(GITIGNORE.split(/\r?\n/).map((l) => l.trim())).toContain('backend/data/' + file);
  });

  test.each(LIVE_STORES)('%s is the store %s actually writes', (file, service) => {
    const key = read('backend/services/' + service).match(/STORE_KEY\s*=\s*'([^']+)'/);
    expect(key).toBeTruthy();
    expect(key[1] + '.json').toBe(file);
  });

  test('no Education store key is missing from .gitignore', () => {
    const keys = new Set();
    for (const [, service] of LIVE_STORES) {
      const m = read('backend/services/' + service).match(/STORE_KEY\s*=\s*'([^']+)'/);
      if (m) keys.add(m[1] + '.json');
    }
    const ignored = new Set(
      GITIGNORE.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('backend/data/education'))
        .map((l) => l.slice('backend/data/'.length))
    );
    for (const k of keys) expect(ignored.has(k)).toBe(true);
  });
});

describe('the surviving Education surface still authorizes reads', () => {
  beforeAll(() => {
    dataDir = makeTempDataDir('education-hygiene');
    ({ app } = startServer(dataDir, { AUTH_REQUIRED: 'true' }));
  });

  test('an unauthenticated Education read is rejected, not served', async () => {
    // Confirms the mounted routers gate reads. educationCore never did this
    // when AUTH_REQUIRED was false, which is why it had to go.
    const res = await request(app).get('/api/v1/tenant/education/students');
    expect([401, 403]).toContain(res.statusCode);
  });

  test('no unauthenticated caller reaches an Education entity', async () => {
    for (const p of ['/centers', '/teachers', '/classes', '/enrollments',
      '/attendance', '/scheduling', '/grading', '/programs', '/courses',
      '/bookings', '/ratings']) {
      const res = await request(app).get('/api/v1/tenant/education' + p);
      expect([401, 403]).toContain(res.statusCode);
    }
  });
});