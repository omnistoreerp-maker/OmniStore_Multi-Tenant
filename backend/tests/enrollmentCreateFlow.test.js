'use strict';

// enrollmentCreateFlow.test.js — Phase 2C enrollment create flow.
//
// The inline enrollment form must offer a class picker backed by authorized
// tenant data and submit only the references the backend create contract
// accepts ({ studentId, classId } plus optional notes). Static assertions pin
// the shipped index.html wiring; sandbox assertions execute the real UI
// functions (extracted verbatim, DOM stubs only) against fixture state; runtime
// assertions run the REAL server.js mount order against isolated stores with
// no mocked authorization layers.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFunction(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(HTML);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = HTML.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

function makeSelect(value) {
  const el = {
    value: value || '',
    disabled: false,
    _html: '',
    get options() {
      const out = [];
      const re = /<option value="([^"]*)"/g;
      let m;
      while ((m = re.exec(this._html))) out.push({ value: m[1] });
      return out;
    },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; }
  };
  return el;
}

function optionValues(select) {
  return select.options.map((o) => o.value).filter((v) => v !== '');
}

describe('enrollment create form wiring (static, shipped index.html)', () => {
  test('form offers a required class picker and no status control', () => {
    expect(HTML).toContain('id="eeClassId" required');
    expect(HTML).not.toContain('id="eeStatus"');
  });

  test('tenant class/course/program collections are loaded into state', () => {
    expect(HTML).toContain('getAllClasses');
    expect(HTML).toContain('getAllCourses');
    expect(HTML).toContain('getAllPrograms');
    expect(HTML).toContain('educationState.classes = Array.isArray');
    expect(HTML).toContain('educationState.courses = Array.isArray');
    expect(HTML).toContain('educationState.programs = Array.isArray');
  });

  test('teacher/student lists no longer filter on a record centerId that does not exist', () => {
    expect(HTML).not.toMatch(/filter\(t => t\.centerId ===/);
    expect(HTML).not.toMatch(/filter\(s => s\.centerId ===/);
  });

  test('picking a teacher re-filters the class picker', () => {
    expect(HTML).toContain('id="eeTeacherId" onchange="loadEnrollmentClasses()"');
  });

  test('create payload carries only references the backend accepts', () => {
    const fn = extractFunction('saveEducationEnrollment');
    expect(fn).toContain('studentId:');
    expect(fn).toContain('classId:');
    expect(fn).not.toMatch(/centerId:\s*document/);
    expect(fn).not.toMatch(/teacherId:\s*document/);
    expect(fn).not.toMatch(/status:\s*document/);
    expect(fn).not.toMatch(/tenantId/);
  });
});

describe('enrollment create wiring (sandboxed real UI functions)', () => {
  const STAMP = '2026-01-01T00:00:00.000Z';
  function fixtureState() {
    return {
      centers: [{ id: 'c1', name: 'Center 1' }],
      teachers: [
        { id: 'tch-1', firstName: 'Ann', lastName: 'One' },
        { id: 'tch-2', firstName: 'Bob', lastName: 'Two' }
      ],
      students: [{ id: 'stu-1', firstName: 'Sara', lastName: 'One' }],
      classes: [
        { id: 'cls-1', courseId: 'crs-1', teacherId: 'tch-1', name: 'Algebra' },
        { id: 'cls-2', courseId: 'crs-9', teacherId: 'tch-2', name: 'Orphan' }
      ],
      courses: [{ id: 'crs-1', programId: 'prg-1', name: 'Grammar' }],
      programs: [{ id: 'prg-1', centerId: 'c1', name: 'Track' }],
      enrollments: []
    };
  }

  function sandbox(selectValues, state) {
    const elements = {
      eeCenterId: makeSelect(selectValues.centerId),
      eeTeacherId: makeSelect(selectValues.teacherId),
      eeClassId: makeSelect(selectValues.classId),
      eeStudentId: makeSelect(selectValues.studentId),
      eeNotes: { value: selectValues.notes !== undefined ? selectValues.notes : '' },
      eeId: { value: selectValues.id !== undefined ? selectValues.id : '' }
    };
    const calls = { create: [], update: [], withdraw: [] };
    const toasts = [];
    const context = {
      console,
      educationState: state || fixtureState(),
      document: { getElementById: (id) => elements[id] || null },
      backendApi: { education: {
        createEnrollment: async (data) => { calls.create.push(data); return { success: true, data: { id: 'enr-new' } }; },
        updateEnrollment: async (id, data) => { calls.update.push([id, data]); return { success: true, data: {} }; },
        withdrawEnrollment: async (id) => { calls.withdraw.push(id); return { success: true, data: {} }; }
      } },
      showToast: (msg) => toasts.push(String(msg)),
      closeModal: () => {},
      openModal: () => {},
      populateCenterDropdown: () => {},
      loadEducationData: async () => {},
      renderEducationEnrollmentsPage: () => {},
      renderEducationPage: () => {},
      escapeHtml: null,
      confirm: () => true
    };
    context.globalThis = context;
    vm.createContext(context);
    const code = [
      extractFunction('escapeHtml'),
      extractFunction('educationCourseById'),
      extractFunction('educationProgramById'),
      extractFunction('educationClassCenterId'),
      extractFunction('educationChainAvailable'),
      extractFunction('loadEnrollmentTeachersAndStudents'),
      extractFunction('loadEnrollmentClasses'),
      extractFunction('saveEducationEnrollment')
    ].join('\n');
    vm.runInContext(code, context, { filename: 'index.html-enrollment-sandbox.js' });
    return { context, elements, calls, toasts };
  }

  test('center selection narrows teachers/classes through the chain; students stay tenant-wide', async () => {
    const sb = sandbox({ centerId: 'c1' });
    await sb.context.loadEnrollmentTeachersAndStudents();
    expect(optionValues(sb.elements.eeTeacherId)).toEqual(['tch-1']);
    expect(optionValues(sb.elements.eeClassId)).toEqual(['cls-1']);
    expect(optionValues(sb.elements.eeStudentId)).toEqual(['stu-1']);
  });

  test('picking a teacher narrows classes to that teacher', async () => {
    const sb = sandbox({ centerId: 'c1', teacherId: 'tch-1' });
    await sb.context.loadEnrollmentTeachersAndStudents();
    expect(optionValues(sb.elements.eeClassId)).toEqual(['cls-1']);
  });

  test('create submits exactly studentId/classId/notes', async () => {
    const sb = sandbox({ centerId: 'c1', teacherId: 'tch-1', classId: 'cls-1', studentId: 'stu-1', notes: 'hi', id: '' });
    await sb.context.saveEducationEnrollment({ preventDefault: () => {} });
    expect(sb.calls.create).toEqual([{ studentId: 'stu-1', classId: 'cls-1', notes: 'hi' }]);
    expect(sb.calls.update).toEqual([]);
  });

  test('create without notes omits the key; missing references block with an error', async () => {
    const sb = sandbox({ centerId: 'c1', teacherId: 'tch-1', classId: 'cls-1', studentId: 'stu-1', notes: '   ', id: '' });
    await sb.context.saveEducationEnrollment({ preventDefault: () => {} });
    expect(sb.calls.create).toEqual([{ studentId: 'stu-1', classId: 'cls-1' }]);
    const sb2 = sandbox({ centerId: 'c1', studentId: 'stu-1', id: '' });
    await sb2.context.saveEducationEnrollment({ preventDefault: () => {} });
    expect(sb2.calls.create).toEqual([]);
    expect(sb2.toasts.length).toBeGreaterThan(0);
  });

  test('edit mode sends notes only and never the create payload', async () => {
    const state = fixtureState();
    state.enrollments = [{ id: 'enr-1', notes: 'old' }];
    const sb = sandbox({ id: 'enr-1', notes: 'new' }, state);
    await sb.context.saveEducationEnrollment({ preventDefault: () => {} });
    expect(sb.calls.update).toEqual([['enr-1', { notes: 'new' }]]);
    expect(sb.calls.create).toEqual([]);
  });
});

describe('enrollment create contract (runtime, real server)', () => {
  const ORIGINAL_ENV = {
    CARRY: process.env.ENABLE_TENANT_CARRY,
    MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
    MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
    ROLES: process.env.ENABLE_TENANT_ROLES,
    AUTH: process.env.AUTH_REQUIRED,
    DATA: process.env.DIGITRONICS_DATA_DIR
  };
  const STAMP = '2026-01-01T00:00:00.000Z';
  const BASE = '/api/v1/tenant/education';
  const HASH = bcrypt.hashSync('Pass#123', 10);
  let app;
  let dir;

  beforeEach(() => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    dir = makeTempDataDir('enr-create');
    seed(dir, 'companies', [
      { id: 't1', name: 'Team One', active: true },
      { id: 't2', name: 'Team Two', active: true }
    ]);
    seed(dir, 'users', { users: [
      { id: 'u-a', username: 'ownerA', password: HASH, role: 'Owner', fullName: 'Owner A', tenantIds: ['t1'], createdAt: STAMP, updatedAt: STAMP },
      { id: 'u-b', username: 'ownerB', password: HASH, role: 'Owner', fullName: 'Owner B', tenantIds: ['t2'], createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationPrograms', { programs: [
      { id: 'prg-1', tenantId: 't1', name: 'Track 1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationCourses', { courses: [
      { id: 'crs-1', tenantId: 't1', programId: 'prg-1', name: 'Course 1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationTeachers', { teachers: [
      { id: 'tch-1', tenantId: 't1', teacherCode: 'T1', firstName: 'Ann', lastName: 'One', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationClasses', { classes: [
      { id: 'cls-1', tenantId: 't1', courseId: 'crs-1', teacherId: 'tch-1', classCode: 'C1', name: 'Class 1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationStudents', { students: [
      { id: 'stu-1', tenantId: 't1', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', createdAt: STAMP, updatedAt: STAMP },
      { id: 'stu-2', tenantId: 't1', studentCode: 'S2', firstName: 'Sam', lastName: 'Two', status: 'active', createdAt: STAMP, updatedAt: STAMP },
      { id: 'stu-b', tenantId: 't2', studentCode: 'SB', firstName: 'Bea', lastName: 'Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  afterAll(() => {
    if (ORIGINAL_ENV.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
    if (ORIGINAL_ENV.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_ENV.MC;
    if (ORIGINAL_ENV.MEM === undefined) delete process.env.ENABLE_TENANT_USER_MEMBERSHIP; else process.env.ENABLE_TENANT_USER_MEMBERSHIP = ORIGINAL_ENV.MEM;
    if (ORIGINAL_ENV.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_ENV.ROLES;
    if (ORIGINAL_ENV.AUTH === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
    if (ORIGINAL_ENV.DATA === undefined) delete process.env.DIGITRONICS_DATA_DIR; else process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
  });

  async function loginAs(username) {
    const company = username === 'ownerA' ? 't1' : 't2';
    const res = await request(app).post('/api/v1/auth/login').send({ username, password: 'Pass#123', company });
    expect(res.statusCode).toBe(200);
    return res.body.data.accessToken;
  }

  test('valid student/class selection creates a tenant-stamped enrollment', async () => {
    const token = await loginAs('ownerA');
    const created = await request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-2', classId: 'cls-1', notes: 'evening group' });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('t1');
    expect(created.body.data.studentId).toBe('stu-2');
    expect(created.body.data.classId).toBe('cls-1');
  });

  test('missing classId and cross-tenant references are rejected without writes', async () => {
    const token = await loginAs('ownerA');
    expect((await request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-2' })).statusCode).toBe(400);
    expect((await request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-b', classId: 'cls-1' })).statusCode).toBe(400);
    const list = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toEqual([]);
  });

  test('duplicate active pair conflicts and anonymous creation is denied', async () => {
    const token = await loginAs('ownerA');
    expect((await request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-1', classId: 'cls-1' })).statusCode).toBe(201);
    expect((await request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-1', classId: 'cls-1' })).statusCode).toBe(409);
    expect((await request(app).post(`${BASE}/enrollments`).send({ studentId: 'stu-2', classId: 'cls-1' })).statusCode).toBe(401);
  });
});
