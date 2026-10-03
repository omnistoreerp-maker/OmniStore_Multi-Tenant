'use strict';

// P2 Bookings — regression suite (Teacher portal, Device 2).
//
// Proves, against the REAL middleware chain (authMiddleware -> tenantCarry ->
// attachTeacherActor -> requireAuth -> scopedWriteRoleGuard ->
// requirePermission -> controller -> service) and the REAL server.js mount:
//
//   A. Authentication — every booking route and /teachers/me refuse an
//      anonymous caller.
//   B. Authorization — strict gate does not degrade under AUTH_REQUIRED=false;
//      unregistered permissions fail closed; an UNLINKED permission-holding
//      Viewer is still refused writes by the global role gate (the identity
//      exception is for LINKED teachers only).
//   C. Lifecycle — requested -> confirmed -> completed / cancelled, one
//      direction only; illegal edges are 409 BOOKING_TRANSITION_INVALID with
//      from/to details; terminal states stay terminal.
//   D. Ownership — a linked teacher sees ONLY their own rows (list is force-
//      scoped server-side), cannot read/edit/create/complete anyone's booking
//      (403 OWNERSHIP_DENIED), and can confirm/cancel ONLY their own. The
//      refusal never depends on holding education.bookings.edit.
//   E. Operator access — an unlinked Owner manages every booking and every
//      transition, including completed.
//   F. Conflicts — overlapping pending bookings for the same teacher on one
//      day are 409 BOOKING_CONFLICT (half-open: touching endpoints allowed);
//      completed/cancelled release the slot; class sessions hold the slot.
//   G. Tenant isolation — every read/write is scoped to the trusted tenant;
//      cross-tenant ids answer 404, never 403; cross-tenant references are
//      400 with no existence leak.
//   H. No payment surface — status/amount/payment/fee/invoice are refused in
//      the body (400); status moves ONLY through the transition route.
//   I. Account link — Owner/Admin only, one account per teacher and one
//      teacher per account, idempotent re-link, unlink deletes the key;
//      /teachers/me is link-based (401 anonymous, 404 TEACHER_NOT_LINKED when
//      unlinked, no permission grant required).
//   J. Audit — every booking mutation lands in the tamper-evident audit log
//      with actor, path and body.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const DAY = '2026-06-15';
const NEXT_DAY = '2026-06-16';

const companies = [
  { id: 'bk-a', name: 'Booking Tenant A', code: 'BKA', active: true },
  { id: 'bk-b', name: 'Booking Tenant B', code: 'BKB', active: true }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'bkOwner', password, role: 'Owner', fullName: 'Booking Owner',
      tenantIds: ['bk-a', 'bk-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Linked-teacher account: normal (Viewer) role, holds the registered
      // bookings permissions explicitly. Proves a teacher never needs an
      // Owner/Admin/Manager role to confirm or cancel their own bookings.
      id: 'u-actor', username: 'bkActor', password, role: 'Viewer', fullName: 'Teacher Actor',
      permissions: ['education.bookings.view', 'education.bookings.edit'],
      tenantIds: ['bk-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // The account linked to the SECOND teacher: proves cross-teacher 403s.
      id: 'u-actor2', username: 'bkActor2', password, role: 'Viewer', fullName: 'Teacher Actor Two',
      permissions: ['education.bookings.view', 'education.bookings.edit'],
      tenantIds: ['bk-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Holds an UNREGISTERED booking permission: must fail closed.
      id: 'u-stranger', username: 'bkStranger', password, role: 'Viewer', fullName: 'Booking Stranger',
      permissions: ['education.bookings.export'],
      tenantIds: ['bk-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'bkManager', password, role: 'Manager', fullName: 'Booking Manager',
      tenantIds: ['bk-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

const teachers = [
  { id: 'tch-1', tenantId: 'bk-a', teacherCode: 'BT1', firstName: 'Ann', lastName: 'Teacher', displayName: 'Ann Teacher', status: 'active', employmentType: 'full_time', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tch-2', tenantId: 'bk-a', teacherCode: 'BT2', firstName: 'Bob', lastName: 'Teacher', displayName: 'Bob Teacher', status: 'active', employmentType: 'full_time', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tch-old', tenantId: 'bk-a', teacherCode: 'BT3', firstName: 'Old', lastName: 'Teacher', displayName: 'Old Teacher', status: 'archived', employmentType: 'part_time', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tch-b1', tenantId: 'bk-b', teacherCode: 'BTB', firstName: 'Ben', lastName: 'Teacher', displayName: 'Ben Teacher', status: 'active', employmentType: 'full_time', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

const students = [
  { id: 'stu-1', tenantId: 'bk-a', studentCode: 'BS1', firstName: 'Sara', lastName: 'Student', displayName: 'Sara Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'stu-2', tenantId: 'bk-a', studentCode: 'BS2', firstName: 'Sam', lastName: 'Student', displayName: 'Sam Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'stu-old', tenantId: 'bk-a', studentCode: 'BS3', firstName: 'Old', lastName: 'Student', displayName: 'Old Student', status: 'archived', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'stu-b1', tenantId: 'bk-b', studentCode: 'BSB', firstName: 'Bea', lastName: 'Student', displayName: 'Bea Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

const classes = [
  { id: 'cls-1', tenantId: 'bk-a', courseId: 'crs-1', teacherId: 'tch-1', classCode: 'C1', name: 'Algebra', displayName: 'Algebra', description: '', status: 'active', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'cls-2', tenantId: 'bk-a', courseId: 'crs-1', teacherId: 'tch-2', classCode: 'C2', name: 'Geometry', displayName: 'Geometry', description: '', status: 'active', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

const sessions = [
  // cls-1 (tch-1) on DAY, 10:00-11:00 — the slot a session-linked booking derives.
  { id: 'ses-1', tenantId: 'bk-a', classId: 'cls-1', scheduledDate: DAY, startTime: '10:00', endTime: '11:00', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  // cls-2 (tch-2) on DAY, 13:00-14:00 — another teacher's session.
  { id: 'ses-2', tenantId: 'bk-a', classId: 'cls-2', scheduledDate: DAY, startTime: '13:00', endTime: '14:00', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationScheduling', { sessions });
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, refs, conflicts, lifecycle, isolation
// ---------------------------------------------------------------------------
describe('P2 booking.service — trusted tenant, lifecycle and conflicts', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('bkg-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    seedAll(dir);
    service = require('../services/booking.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'bk-a' };
  const B = { tenantId: 'bk-b' };
  const base = { teacherId: 'tch-1', studentId: 'stu-1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listBookings(null)).toThrow('Tenant context is required');
    expect(() => service.listBookings({})).toThrow('Tenant context is required');
    expect(() => service.getBooking(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createBooking(null, base)).toThrow('Tenant context is required');
    expect(() => service.updateBooking(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.transitionBooking(null, 'x', 'confirmed')).toThrow('Tenant context is required');
  });

  test('create stamps the trusted tenant and starts at requested', () => {
    const created = service.createBooking(A, { ...base });
    expect(created.tenantId).toBe('bk-a');
    expect(created.status).toBe('requested');
    expect(created.classId).toBe('');
    expect(created.sessionId).toBe('');
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.id).toMatch(/^bkg-/);
  });

  test('create requires teacher, student and a complete slot', () => {
    try {
      service.createBooking(A, { scheduledDate: DAY });
      throw new Error('should have thrown');
    } catch (err) {
      expect(Array.isArray(err.validation)).toBe(true);
      expect(err.validation).toEqual(expect.arrayContaining([
        'teacherId is required', 'studentId is required',
        'startTime is required', 'endTime is required'
      ]));
    }
  });

  test('unknown and cross-tenant parents are the same 400 — no existence leak', () => {
    const unknown = 'teacherId does not reference a Teacher in this tenant';
    expect(() => service.createBooking(A, { ...base, teacherId: 'nope' }))
      .toThrow(unknown);
    // Tenant B cannot reference tenant A's teacher, and gets the identical error.
    expect(() => service.createBooking(B, { ...base, teacherId: 'tch-1', studentId: 'stu-b1' }))
      .toThrow(unknown);
    expect(() => service.createBooking(A, { ...base, studentId: 'stu-b1' }))
      .toThrow('studentId does not reference a Student in this tenant');
  });

  test('archived parents are refused on create', () => {
    expect(() => service.createBooking(A, { ...base, teacherId: 'tch-old' }))
      .toThrow('non-archived Teacher');
    expect(() => service.createBooking(A, { ...base, studentId: 'stu-old' }))
      .toThrow('non-archived Student');
  });

  test('classId must reference a Class taught by the booking teacher', () => {
    expect(() => service.createBooking(A, { ...base, classId: 'cls-2' }))
      .toThrow('classId must reference a Class taught by teacherId');
    expect(() => service.createBooking(A, { ...base, classId: 'nope' }))
      .toThrow('classId does not reference a Class in this tenant');
    const ok = service.createBooking(A, { ...base, classId: 'cls-1' });
    expect(ok.classId).toBe('cls-1');
  });

  test('a linked session owns the slot and must belong to the same teacher', () => {
    const derived = service.createBooking(A, {
      teacherId: 'tch-1', studentId: 'stu-1', sessionId: 'ses-1', classId: 'cls-1'
    });
    expect(derived.scheduledDate).toBe(DAY);
    expect(derived.startTime).toBe('10:00');
    expect(derived.endTime).toBe('11:00');
    expect(derived.sessionId).toBe('ses-1');
    expect(derived.classId).toBe('cls-1');

    // Client values that disagree with the session are refused, not merged.
    expect(() => service.createBooking(A, {
      teacherId: 'tch-1', studentId: 'stu-1', sessionId: 'ses-1', startTime: '12:00',
      endTime: '13:00', scheduledDate: DAY
    })).toThrow('startTime must match the referenced session');
    expect(() => service.createBooking(A, {
      teacherId: 'tch-1', studentId: 'stu-1', sessionId: 'ses-1', scheduledDate: NEXT_DAY
    })).toThrow('scheduledDate must match the referenced session');

    // Another teacher's session is refused.
    expect(() => service.createBooking(A, {
      teacherId: 'tch-1', studentId: 'stu-1', sessionId: 'ses-2'
    })).toThrow('sessionId must reference a Session of a Class taught by teacherId');

    // Unknown session.
    expect(() => service.createBooking(A, {
      teacherId: 'tch-1', studentId: 'stu-1', sessionId: 'nope'
    })).toThrow('sessionId does not reference a Session in this tenant');
  });

  test('slot validation: strict formats, real dates, end after start', () => {
    expect(() => service.createBooking(A, { ...base, scheduledDate: '2026-02-30' }))
      .toThrow('real calendar date');
    expect(() => service.createBooking(A, { ...base, scheduledDate: '15/06/2026' }))
      .toThrow('YYYY-MM-DD');
    expect(() => service.createBooking(A, { ...base, startTime: '9am' }))
      .toThrow('HH:mm');
    expect(() => service.createBooking(A, { ...base, startTime: '09:00', endTime: '09:00' }))
      .toThrow('endTime must be later than startTime');
    expect(() => service.createBooking(A, { ...base, startTime: 123 }))
      .toThrow('startTime must be a string');
  });

  test('overlap: pending bookings block, half-open endpoints do not, terminal releases', () => {
    // tch-2 (its only session is 13:00-14:00) so the half-open adjacency below
    // is decided purely against BOOKINGS; the session rule has its own test.
    const t2 = { ...base, teacherId: 'tch-2' };
    const first = service.createBooking(A, t2); // 09:00-10:00 pending

    // Overlapping is refused with the typed conflict.
    try {
      service.createBooking(A, { ...t2, studentId: 'stu-2', startTime: '09:30', endTime: '10:30' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('BOOKING_CONFLICT');
      expect(err.conflictKind).toBe('teacher');
      expect(err.scheduledDate).toBe(DAY);
      expect(err.conflictingId).toBe(first.id);
    }

    // Back-to-back (touching endpoint) is allowed.
    const back = service.createBooking(A, { ...t2, studentId: 'stu-2', startTime: '10:00', endTime: '11:00' });
    expect(back.status).toBe('requested');

    // Different day never collides with the same wall clock.
    const otherDay = service.createBooking(A, { ...t2, studentId: 'stu-2', scheduledDate: NEXT_DAY });
    expect(otherDay.status).toBe('requested');

    // A terminal booking releases its slot.
    service.transitionBooking(A, first.id, 'cancelled');
    const reused = service.createBooking(A, { ...t2, studentId: 'stu-2', startTime: '09:15', endTime: '09:45' });
    expect(reused.status).toBe('requested');
  });

  test('overlap with a class session is refused unless it IS the linked session', () => {
    // ses-1 holds tch-1 10:00-11:00 on DAY.
    try {
      service.createBooking(A, { ...base, startTime: '10:30', endTime: '11:30' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('BOOKING_CONFLICT');
      expect(err.conflictKind).toBe('session');
      expect(err.conflictingId).toBe('ses-1');
    }

    // Booking INTO that very session is the point of the link — allowed.
    const linked = service.createBooking(A, { teacherId: 'tch-1', studentId: 'stu-1', sessionId: 'ses-1' });
    expect(linked.startTime).toBe('10:00');
  });

  test('lifecycle: only the declared edges exist, terminal stays terminal', () => {
    const b = service.createBooking(A, { ...base });
    expect(service.transitionBooking(A, b.id, 'confirmed').status).toBe('confirmed');
    expect(service.transitionBooking(A, b.id, 'completed').status).toBe('completed');

    const terminal = (from, to) => {
      try {
        service.transitionBooking(A, b.id, to);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.code).toBe('BOOKING_TRANSITION_INVALID');
        expect(err.from).toBe(from);
        expect(err.to).toBe(to);
      }
    };
    terminal('completed', 'confirmed');
    terminal('completed', 'cancelled');
    terminal('completed', 'requested');

    const c = service.createBooking(A, { ...base, studentId: 'stu-2', startTime: '14:00', endTime: '15:00' });
    service.transitionBooking(A, c.id, 'cancelled');
    try {
      service.transitionBooking(A, c.id, 'confirmed');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('BOOKING_TRANSITION_INVALID');
      expect(err.from).toBe('cancelled');
    }

    expect(() => service.transitionBooking(A, b.id, 'archived')).toThrow('status must be one of');
    expect(service.transitionBooking(A, 'missing', 'confirmed')).toBeNull();
    // Cross-tenant: same answer as missing.
    expect(service.transitionBooking(B, b.id, 'confirmed')).toBeNull();
  });

  test('status is not a body field: refused on create and update, unknown fields dropped', () => {
    expect(() => service.createBooking(A, { ...base, status: 'confirmed' }))
      .toThrow('status is not writable');
    const b = service.createBooking(A, { ...base });
    expect(() => service.updateBooking(A, b.id, { status: 'confirmed' }))
      .toThrow('status is not writable');

    // An unlisted key never reaches the record.
    const updated = service.updateBooking(A, b.id, { notes: 'ring the bell', sneaky: 'x' });
    expect(updated.notes).toBe('ring the bell');
    expect(updated.sneaky).toBeUndefined();
    expect(updated.status).toBe('requested');
  });

  test('links and slot are immutable after create; only notes is correctable', () => {
    const b = service.createBooking(A, { ...base, classId: 'cls-1' });
    for (const key of ['teacherId', 'studentId', 'classId', 'sessionId', 'scheduledDate', 'startTime', 'endTime']) {
      expect(() => service.updateBooking(A, b.id, { [key]: 'x' }))
        .toThrow(key + ' cannot be changed');
    }
    // The stored slot is untouched by a refused correction.
    const stored = service.getBooking(A, b.id);
    expect(stored.scheduledDate).toBe(DAY);
    expect(stored.startTime).toBe('09:00');
    expect(stored.endTime).toBe('10:00');
  });

  test('no money: payment and finance words are refused in the body', () => {
    for (const field of ['payment', 'amount', 'price', 'fee', 'invoice', 'transaction', 'refund', 'salary', 'payroll']) {
      expect(() => service.createBooking(A, { ...base, [field]: 'x' }))
        .toThrow(field + ' is not writable');
    }
    for (const field of ['id', 'tenantId', 'userId', 'createdBy']) {
      expect(() => service.createBooking(A, { ...base, [field]: 'x' }))
        .toThrow(field + ' is not writable');
    }
    // The persisted record carries none of them either.
    const b = service.createBooking(A, { ...base });
    for (const key of ['amount', 'price', 'fee', 'payment', 'invoice', 'salary', 'payroll']) {
      expect(Object.prototype.hasOwnProperty.call(b, key)).toBe(false);
    }
  });

  test('tenant isolation: every method answers from its own tenant only', () => {
    const a1 = service.createBooking(A, { ...base });
    expect(service.listBookings(B)).toEqual([]);
    expect(service.getBooking(B, a1.id)).toBeNull();
    expect(service.updateBooking(B, a1.id, { notes: 'x' })).toBeNull();
    expect(service.transitionBooking(B, a1.id, 'confirmed')).toBeNull();
    // Tenant B's own booking is invisible to A.
    const b1 = service.createBooking(B, { teacherId: 'tch-b1', studentId: 'stu-b1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00' });
    expect(service.listBookings(A).map(x => x.id)).not.toContain(b1.id);
    expect(service.listBookings(B).map(x => x.id)).toEqual([b1.id]);
  });

  test('list filters and deterministic day-sheet ordering', () => {
    const early = service.createBooking(A, { ...base, startTime: '08:00', endTime: '09:00' });
    const mid = service.createBooking(A, { ...base, studentId: 'stu-2', startTime: '12:00', endTime: '13:00' });
    const later = service.createBooking(A, { ...base, studentId: 'stu-2', scheduledDate: NEXT_DAY, startTime: '08:00', endTime: '09:00' });

    const all = service.listBookings(A);
    expect(all.map(x => x.id)).toEqual([early.id, mid.id, later.id]);

    expect(service.listBookings(A, { teacherId: 'tch-2' })).toEqual([]);
    expect(service.listBookings(A, { studentId: 'stu-2' }).map(x => x.id)).toEqual([mid.id, later.id]);
    expect(service.listBookings(A, { status: 'requested' })).toHaveLength(3);
    service.transitionBooking(A, early.id, 'confirmed');
    expect(service.listBookings(A, { status: 'confirmed' }).map(x => x.id)).toEqual([early.id]);
    expect(service.listBookings(A, { scheduledDate: DAY })).toHaveLength(2);
    expect(service.listBookings(A, { dateFrom: NEXT_DAY }).map(x => x.id)).toEqual([later.id]);
    expect(service.listBookings(A, { dateTo: DAY })).toHaveLength(2);
  });

  test('the export surface carries no payment member', () => {
    expect(service.WRITABLE_FIELDS).toEqual({
      teacherId: 'string', studentId: 'string', classId: 'string', sessionId: 'string',
      scheduledDate: 'string', startTime: 'string', endTime: 'string', notes: 'string'
    });
    expect(service.STATUS_VALUES).toEqual(['requested', 'confirmed', 'completed', 'cancelled']);
    expect(service.INITIAL_STATUS).toBe('requested');
    expect(service.TRANSITIONS.requested).toEqual(['confirmed', 'cancelled']);
    expect(service.TRANSITIONS.confirmed).toEqual(['completed', 'cancelled']);
    expect(service.TRANSITIONS.completed).toEqual([]);
    expect(service.TRANSITIONS.cancelled).toEqual([]);
    expect(service.PENDING_STATUSES).toEqual(['requested', 'confirmed']);
    for (const member of Object.keys(service.WRITABLE_FIELDS)) {
      expect(member).not.toMatch(/price|amount|fee|pay|invoice|billing|currency|salary/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — authn, authz, ownership, operator access, isolation, link, audit
// ---------------------------------------------------------------------------
describe('P2 booking routes — authorization, ownership and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('bkg-http');
    seedAll(dir);
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
  });

  const token = (id, username, role, tenantId) =>
    jwt.signAccessToken({ id, username, role, tenantId });

  const ownerA = () => token('u-owner', 'bkOwner', 'Owner', 'bk-a');
  const ownerB = () => token('u-owner', 'bkOwner', 'Owner', 'bk-b');
  const actorA = () => token('u-actor', 'bkActor', 'Viewer', 'bk-a');
  const actor2A = () => token('u-actor2', 'bkActor2', 'Viewer', 'bk-a');
  const strangerA = () => token('u-stranger', 'bkStranger', 'Viewer', 'bk-a');
  const managerA = () => token('u-manager', 'bkManager', 'Manager', 'bk-a');

  const post = (path, tok, body) =>
    request(app).post(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const put = (path, tok, body) =>
    request(app).put(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const patch = (path, tok, body) =>
    request(app).patch(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const get = (path, tok) =>
    request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);

  const operatorBooking = (teacherId = 'tch-1', studentId = 'stu-1', slot = {}) =>
    post('/bookings', ownerA(), {
      teacherId, studentId, scheduledDate: DAY, startTime: '09:00', endTime: '10:00', ...slot
    });

  const link = (teacherId, userId) =>
    post(`/teachers/${teacherId}/link-user`, ownerA(), { userId });

  test('A. unauthenticated access is refused on every booking route and /teachers/me', async () => {
    expect((await request(app).get(`${BASE}/bookings`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/bookings/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/bookings`).send({})).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/bookings/anything`).send({})).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/bookings/anything/status`).send({})).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/teachers/me`)).statusCode).toBe(401);
  });

  test('B. the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('bkg-lenient');
    seedAll(lenientDir);
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/bookings`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/bookings`).send({})).statusCode).toBe(401);
      expect((await request(lenientApp).get(`${BASE}/teachers/me`)).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('B. an unregistered booking permission fails closed for reads and writes', async () => {
    const read = await get('/bookings', strangerA());
    expect(read.statusCode).toBe(403);
    expect(read.body.details.code).toBe('PERMISSION_DENIED');

    const write = await post('/bookings', strangerA(), {
      teacherId: 'tch-1', studentId: 'stu-1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00'
    });
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationBookings')).toBeNull();
  });

  test('B. an UNLINKED Viewer with the bookings grant is still refused writes by the role gate', async () => {
    // The identity exception exists only for LINKED teachers: this account
    // holds education.bookings.edit explicitly, yet without a teacher link the
    // global Owner/Admin/Manager write restriction still answers.
    const res = await post('/bookings', actorA(), {
      teacherId: 'tch-1', studentId: 'stu-1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00'
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe('Insufficient role');
    expect(readStore(dir, 'educationBookings')).toBeNull();
  });

  test('B. a registered view grant is honoured for an unlinked Viewer', async () => {
    expect((await get('/bookings', actorA())).statusCode).toBe(200);
  });

  test('E. an operator performs the full lifecycle with audit entries', async () => {
    const created = await operatorBooking();
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.status).toBe('requested');

    expect((await get('/bookings', ownerA())).body.data).toHaveLength(1);
    expect((await get(`/bookings/${id}`, ownerA())).statusCode).toBe(200);

    const noted = await put(`/bookings/${id}`, ownerA(), { notes: 'bring slides' });
    expect(noted.statusCode).toBe(200);
    expect(noted.body.data.notes).toBe('bring slides');

    expect((await patch(`/bookings/${id}/status`, ownerA(), { status: 'confirmed' })).body.data.status).toBe('confirmed');
    expect((await patch(`/bookings/${id}/status`, ownerA(), { status: 'completed' })).body.data.status).toBe('completed');

    // Terminal: every further move is a typed 409 with from/to details.
    const terminal = await patch(`/bookings/${id}/status`, ownerA(), { status: 'confirmed' });
    expect(terminal.statusCode).toBe(409);
    expect(terminal.body.details.code).toBe('BOOKING_TRANSITION_INVALID');
    expect(terminal.body.details.details).toEqual({ from: 'completed', to: 'confirmed' });

    // The mutation trail is real: create + two transitions, with actor and path.
    await new Promise(resolve => setTimeout(resolve, 50));
    const entries = (readStore(dir, 'auditLog') || { entries: [] }).entries;
    const bookingEntries = entries.filter(e => String(e.path || '').includes('/education/bookings'));
    expect(bookingEntries.length).toBeGreaterThanOrEqual(3);
    const createEntry = bookingEntries.find(e => e.method === 'POST' && e.statusCode === 201);
    expect(createEntry).toBeTruthy();
    expect(createEntry.userId).toBe('u-owner');
    const transitionEntry = bookingEntries.find(e => String(e.path || '').endsWith('/status') && e.statusCode === 200);
    expect(transitionEntry).toBeTruthy();
    expect(transitionEntry.userId).toBe('u-owner');
    expect(transitionEntry.action).toBe('update');
  });

  test('F. overlapping pending bookings answer 409 BOOKING_CONFLICT for an operator', async () => {
    // Afternoon slots keep this test purely about the BOOKING-vs-BOOKING rule
    // (tch-1's only session sits at 10:00-11:00; the session rule is proved in
    // the service block).
    expect((await operatorBooking('tch-1', 'stu-1', { startTime: '15:00', endTime: '16:00' })).statusCode).toBe(201);
    const clash = await operatorBooking('tch-1', 'stu-2', { startTime: '15:30', endTime: '16:30' });
    expect(clash.statusCode).toBe(409);
    expect(clash.body.details.code).toBe('BOOKING_CONFLICT');
    expect(clash.body.details.details.conflictKind).toBe('teacher');

    // Half-open: back-to-back is fine.
    expect((await operatorBooking('tch-1', 'stu-2', { startTime: '16:00', endTime: '17:00' })).statusCode).toBe(201);
  });

  test('H. status cannot ride the create or edit body, and money fields are refused', async () => {
    const viaCreate = await post('/bookings', ownerA(), {
      teacherId: 'tch-1', studentId: 'stu-1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00',
      status: 'confirmed'
    });
    expect(viaCreate.statusCode).toBe(400);
    expect(viaCreate.body.details.details).toEqual(expect.arrayContaining(['status is not writable']));

    const money = await post('/bookings', ownerA(), {
      teacherId: 'tch-1', studentId: 'stu-1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00',
      amount: 100
    });
    expect(money.statusCode).toBe(400);
    expect(money.body.details.details).toEqual(expect.arrayContaining(['amount is not writable']));

    const id = (await operatorBooking()).body.data.id;
    const viaPut = await put(`/bookings/${id}`, ownerA(), { status: 'completed', payment: 'card' });
    expect(viaPut.statusCode).toBe(400);
    expect(viaPut.body.details.details).toEqual(expect.arrayContaining([
      'status is not writable', 'payment is not writable'
    ]));
  });

  test('G. a linked teacher sees only their own bookings, whatever the query asks', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    expect((await link('tch-2', 'u-actor2')).statusCode).toBe(200);

    const mine = await operatorBooking('tch-1');       // tch-1
    const theirs = await operatorBooking('tch-2', 'stu-2'); // tch-2
    const mineId = mine.body.data.id;
    const theirsId = theirs.body.data.id;

    // Force-scoped list: the other teacher's booking never appears, even when
    // the query explicitly asks for it.
    const list = await get('/bookings?teacherId=tch-2', actorA());
    expect(list.statusCode).toBe(200);
    expect(list.body.data.map(b => b.id)).toEqual([mineId]);

    const plain = await get('/bookings', actorA());
    expect(plain.body.data.map(b => b.id)).toEqual([mineId]);

    expect((await get(`/bookings/${mineId}`, actorA())).statusCode).toBe(200);

    const otherRead = await get(`/bookings/${theirsId}`, actorA());
    expect(otherRead.statusCode).toBe(403);
    expect(otherRead.body.details.code).toBe('OWNERSHIP_DENIED');
  });

  test('G. a linked teacher cannot create or edit bookings, even with the edit grant', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    const mine = await operatorBooking('tch-1');
    const mineId = mine.body.data.id;

    const create = await post('/bookings', actorA(), {
      teacherId: 'tch-1', studentId: 'stu-2', scheduledDate: DAY, startTime: '11:00', endTime: '12:00'
    });
    expect(create.statusCode).toBe(403);
    expect(create.body.details.code).toBe('OWNERSHIP_DENIED');

    const edit = await put(`/bookings/${mineId}`, actorA(), { notes: 'x' });
    expect(edit.statusCode).toBe(403);
    expect(edit.body.details.code).toBe('OWNERSHIP_DENIED');

    // Nothing was written by either refusal.
    expect((await get(`/bookings/${mineId}`, ownerA())).body.data.notes).toBe('');
  });

  test('G. a linked teacher confirms and cancels OWN bookings only', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    expect((await link('tch-2', 'u-actor2')).statusCode).toBe(200);
    const mine = await operatorBooking('tch-1');
    const theirs = await operatorBooking('tch-2', 'stu-2');
    const mineId = mine.body.data.id;
    const theirsId = theirs.body.data.id;

    // Confirm own — the portal's core verb, without an Owner/Admin/Manager role.
    const confirm = await patch(`/bookings/${mineId}/status`, actorA(), { status: 'confirmed' });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body.data.status).toBe('confirmed');

    // Cancel own.
    const cancel = await patch(`/bookings/${theirsId}/status`, actor2A(), { status: 'cancelled' });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.body.data.status).toBe('cancelled');

    // Completing is an operator action: refused on their own row too.
    const complete = await patch(`/bookings/${mineId}/status`, actorA(), { status: 'completed' });
    expect(complete.statusCode).toBe(403);
    expect(complete.body.details.code).toBe('OWNERSHIP_DENIED');

    // Another teacher's booking: refused before anything is consulted.
    const other = await patch(`/bookings/${theirsId}/status`, actorA(), { status: 'confirmed' });
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    // The operator completes what the teacher could not.
    const done = await patch(`/bookings/${mineId}/status`, ownerA(), { status: 'completed' });
    expect(done.statusCode).toBe(200);
    expect(done.body.data.status).toBe('completed');
  });

  test('I. /teachers/me is link-based identity, not a permission grant', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);

    const me = await get('/teachers/me', actorA());
    expect(me.statusCode).toBe(200);
    expect(me.body.data.id).toBe('tch-1');
    expect(me.body.data.userId).toBe('u-actor');

    // Anonymous: 401.
    expect((await request(app).get(`${BASE}/teachers/me`)).statusCode).toBe(401);

    // Authenticated but unlinked: an honest 404, not a lie and not a 403.
    const notLinked = await get('/teachers/me', ownerA());
    expect(notLinked.statusCode).toBe(404);
    expect(notLinked.body.details.code).toBe('TEACHER_NOT_LINKED');

    // After unlink the portal disappears for that account.
    expect((await request(app).delete(`${BASE}/teachers/tch-1/link-user`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await get('/teachers/me', actorA())).statusCode).toBe(404);
    expect((await get('/teachers/me', actorA())).body.details.code).toBe('TEACHER_NOT_LINKED');

    // And with the link gone the write-gate exception is gone with it.
    const write = await post('/bookings', actorA(), {
      teacherId: 'tch-1', studentId: 'stu-1', scheduledDate: DAY, startTime: '15:00', endTime: '16:00'
    });
    expect(write.statusCode).toBe(403);
    expect(write.body.message).toBe('Insufficient role');
  });

  test('I. the account link is Owner/Admin only and enforces one-to-one binding', async () => {
    // A linked teacher (or any Viewer) may not create links.
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    const asTeacher = await post('/teachers/tch-2/link-user', actorA(), { userId: 'u-actor2' });
    expect(asTeacher.statusCode).toBe(403);

    // Manager is not Owner/Admin either.
    const asManager = await post('/teachers/tch-2/link-user', managerA(), { userId: 'u-actor2' });
    expect(asManager.statusCode).toBe(403);

    // Idempotent re-link of the same pair.
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);

    // Teacher already linked to a different account: 409.
    const takenTeacher = await link('tch-1', 'u-actor2');
    expect(takenTeacher.statusCode).toBe(409);
    expect(takenTeacher.body.details.code).toBe('TEACHER_ALREADY_LINKED');

    // Account already linked to another teacher: 409.
    const takenUser = await link('tch-2', 'u-actor');
    expect(takenUser.statusCode).toBe(409);
    expect(takenUser.body.details.code).toBe('USER_ALREADY_LINKED');

    // Unknown user, missing userId, unknown teacher: honest 400/404.
    const unknownUser = await link('tch-2', 'nobody');
    expect(unknownUser.statusCode).toBe(400);
    const missing = await post('/teachers/tch-2/link-user', ownerA(), {});
    expect(missing.statusCode).toBe(400);
    const unknownTeacher = await link('nope', 'u-actor2');
    expect(unknownTeacher.statusCode).toBe(404);

    // The stored shape: userId present only where linked, no credentials.
    const store = readStore(dir, 'educationTeachers');
    const linked = store.teachers.find(t => t.id === 'tch-1');
    expect(linked.userId).toBe('u-actor');
    const unlinked = store.teachers.find(t => t.id === 'tch-old');
    expect(Object.prototype.hasOwnProperty.call(unlinked, 'userId')).toBe(false);
  });

  test('G. tenant isolation: cross-tenant ids answer 404 and references answer 400', async () => {
    const mine = await operatorBooking('tch-1');
    const id = mine.body.data.id;

    // Tenant B sees its own empty world and cannot read A's row.
    expect((await get('/bookings', ownerB())).body.data).toEqual([]);
    expect((await get(`/bookings/${id}`, ownerB())).statusCode).toBe(404);

    // Tenant B cannot transition A's row.
    expect((await patch(`/bookings/${id}/status`, ownerB(), { status: 'confirmed' })).statusCode).toBe(404);

    // Tenant B cannot reference tenant A's teacher/student — identical 400,
    // so existence is not leaked across the boundary.
    const ref = await post('/bookings', ownerB(), {
      teacherId: 'tch-1', studentId: 'stu-b1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00'
    });
    expect(ref.statusCode).toBe(400);
    expect(ref.body.details.details).toEqual([
      'teacherId does not reference a Teacher in this tenant'
    ]);

    // Tenant B's own booking works and never collides with A's same-slot row.
    const bOwn = await post('/bookings', ownerB(), {
      teacherId: 'tch-b1', studentId: 'stu-b1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00'
    });
    expect(bOwn.statusCode).toBe(201);
    expect(bOwn.body.data.tenantId).toBe('bk-b');
    expect((await get('/bookings', ownerA())).body.data.map(b => b.id)).toEqual([id]);
  });

  test('G. the linked-teacher identity itself is tenant-scoped', async () => {
    // The link lives in tenant A. The same account acting inside tenant B is a
    // plain operator there: no actor, no scoping, no exception.
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    const writeB = await post('/bookings', ownerB(), {
      teacherId: 'tch-b1', studentId: 'stu-b1', scheduledDate: DAY, startTime: '11:00', endTime: '12:00'
    });
    expect(writeB.statusCode).toBe(201);

    const meB = await get('/teachers/me', token('u-actor', 'bkActor', 'Viewer', 'bk-b'));
    expect(meB.statusCode).toBe(404);
    expect(meB.body.details.code).toBe('TEACHER_NOT_LINKED');
  });
});
