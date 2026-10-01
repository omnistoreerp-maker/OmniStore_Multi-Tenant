/* education.js — Education (Device 2) page runtime.
 *
 * SCOPE. One static page over the committed STU-1..STU-10 Education backend
 * mounted at `/api/v1/tenant/education`. It reads and writes only the routes
 * that backend actually exposes; it invents no endpoint, no pagination and no
 * field.
 *
 * CONTRACT RULES ENFORCED HERE.
 *   1. AUTH. The bearer token comes from `localStorage.access_token`, exactly
 *      as the existing Student Services page does. Tenant identity is NEVER
 *      sent: the server resolves it from the signed claim, so this file must
 *      not add a tenant header, a `tenantId` body field or a tenant query key.
 *   2. THE BACKEND IS AUTHORITATIVE. Status vocabularies, required fields,
 *      string bounds and the immutable parent relationships are mirrored from
 *      the services, not invented here. The UI never invents a required field
 *      the server does not require, and it never lets a client write send a
 *      field the server refuses.
 *   3. GRADING IS DESCRIPTIVE. One record per enrollment carrying
 *      `enrollmentId`, `gradingDate`, `grade` and `notes`. `grade` is a bounded
 *      free-text value recorded verbatim. There is deliberately no scale, no
 *      aggregation, no ranking, no weighting and no assessment vocabulary
 *      anywhere on this page, because the repository defines none.
 *   4. NO PAGINATION. The Education list routes expose no page/limit contract,
 *      so this page renders the full returned array and never shows page
 *      controls that would lie about it.
 *   5. NO FAKE IDENTITY. The backend links an authenticated user to neither a
 *      Teacher nor a Student, so the workspaces are tenant-level views with an
 *      explicit picker, never a fabricated "current teacher" or "current
 *      student".
 *   6. NO CDN. Every icon is an inline SVG path defined below, so the page
 *      satisfies the production CSP (`script-src 'self' 'unsafe-inline'`).
 *
 * ERRORS. The server message is surfaced verbatim because these services
 * already return human-readable, leak-free messages. A 409 is reported as a
 * conflict and never retried automatically; a 400 `details` list is joined and
 * shown; a 401/403 explains the permission reality instead of pretending the
 * records do not exist.
 */
(function () {
  'use strict';

  var API_BASE = '/api/v1/tenant/education';
  var MAX_STRING_LEN = 160;

  var STATUS_VALUES = ['active', 'inactive', 'archived'];
  var EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract'];
  var DURATION_UNITS = ['days', 'weeks', 'months'];
  var ENROLLMENT_STATUSES = ['active', 'withdrawn'];
  var ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'];

  // ---------------------------------------------------------------------
  // Inline icon set (no remote asset, no icon font).
  // ---------------------------------------------------------------------

  var ICON_PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    school: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 7h1M14 7h1M9 12h1M14 12h1M10 17h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M8 7h8M8 11h8"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    award: '<circle cx="12" cy="9" r="5"/><path d="m8.5 13.5-1.5 8 5-3 5 3-1.5-8"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    graduation: '<path d="m12 4 10 5-10 5L2 9l10-5Z"/><path d="M6 11v5c0 1 3 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    grid: '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
  };

  function icon(name, extraClass) {
    var path = ICON_PATHS[name] || ICON_PATHS.info;
    return '<svg class="edu-icon ' + (extraClass || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + path + '</svg>';
  }

  // ---------------------------------------------------------------------
  // Small helpers.
  // ---------------------------------------------------------------------

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(value) {
    var raw = String(value === undefined || value === null ? '' : value).trim();
    return raw === '' ? '—' : esc(raw);
  }

  function today() {
    var now = new Date();
    var m = String(now.getMonth() + 1);
    var d = String(now.getDate());
    return now.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d);
  }

  // Plain text for a cell that has no value. Used by the CSV writer, which must
  // never emit markup and must never invent a dash where the record has nothing.
  function str(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  // ---------------------------------------------------------------------------
  // Calendar-day arithmetic. Every date in Education is an opaque `YYYY-MM-DD`
  // day compared as a string, so the helpers below parse and rebuild the parts
  // rather than shifting a timestamp: a UTC round-trip would move a day for
  // anyone east or west of Greenwich, and a register must not move with the
  // reader's clock.
  // ---------------------------------------------------------------------------

  function isDay(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function parseDay(day) {
    var parts = String(day || '').split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function dayKey(date) {
    var m = String(date.getMonth() + 1);
    var d = String(date.getDate());
    return date.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d);
  }

  function addDays(day, count) {
    var date = parseDay(day);
    date.setDate(date.getDate() + count);
    return dayKey(date);
  }

  // Monday-first week, which is how an academy week reads in both languages the
  // page ships. Only the day key is used downstream, so the weekday NUMBER never
  // reaches the screen in a locale-dependent form.
  function startOfWeek(day) {
    var date = parseDay(day);
    var offset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - offset);
    return dayKey(date);
  }

  // Short weekday headings, translated by the shared i18n dictionary exactly
  // like every other string on this page.
  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function weekdayOf(day) {
    return WEEKDAYS[(parseDay(day).getDay() + 6) % 7];
  }

  // ---------------------------------------------------------------------------
  // CSV export.
  //
  // The Education list routes have no page/limit contract, so a list is small
  // enough to serialise in the browser: no export endpoint is needed, and adding
  // one would be a new backend surface for no reason.
  //
  // The file is UTF-8 with a leading BOM, because Excel on Windows otherwise
  // opens Arabic text as mojibake. Cells are quoted when they contain a comma, a
  // quote, CR or LF, and inner quotes are doubled, so a note containing a comma
  // or a line break cannot shift a column.
  //
  // A value that begins `=`, `+`, `-`, `@`, TAB or CR is prefixed with a single
  // quote, because a spreadsheet treats those as the start of a FORMULA. A
  // student name is free text from the backend, and this is the one place that
  // text reaches a program that evaluates it.
  // ---------------------------------------------------------------------------

  function csvCell(value) {
    var raw = str(value);
    if (raw === '') return '';
    if (/^[=+\-@\t\r]/.test(raw)) raw = "'" + raw;
    if (/["\r\n,]/.test(raw)) return '"' + raw.replace(/"/g, '""') + '"';
    return raw;
  }

  function toCsv(headers, rows) {
    var lines = [(headers || []).map(csvCell).join(',')];
    (rows || []).forEach(function (row) {
      lines.push((row || []).map(csvCell).join(','));
    });
    // CRLF and a trailing newline: what every spreadsheet parser expects.
    return lines.join('\r\n') + '\r\n';
  }

  // U+FEFF written as an escape so the byte-order mark is visible in the source
  // instead of being an invisible character at the start of a string literal.
  var UTF8_BOM = '\uFEFF';

  function downloadCsv(filename, csv) {
    var blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename + '-' + today() + '.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Exports exactly the rows the table is showing, through the entity's own
  // `export` descriptor. Nothing is re-fetched, so the file can never disagree
  // with the screen, and no field outside the visible columns is emitted.
  function exportCsv(spec) {
    var rows = state.rows[spec.key] || [];
    if (!spec.export || !spec.export.columns || !spec.export.columns.length) return;
    if (!rows.length) {
      toast('There is nothing to export for the current filters.', true);
      return;
    }
    var headers = spec.export.columns.map(function (column) { return column.header; });
    var body = rows.map(function (row) {
      return spec.export.columns.map(function (column) { return str(column.value(row)); });
    });
    downloadCsv(spec.export.filename || spec.key, toCsv(headers, body));
    toast(rows.length + (rows.length === 1 ? ' record' : ' records') + ' exported.');
  }

  function qs(params) {
    var parts = [];
    var keys = Object.keys(params || {});
    for (var i = 0; i < keys.length; i++) {
      var value = params[keys[i]];
      if (value === undefined || value === null) continue;
      var raw = String(value).trim();
      if (raw === '') continue;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(raw));
    }
    return parts.join('&');
  }

  // ---------------------------------------------------------------------
  // Transport.
  // ---------------------------------------------------------------------

  function ApiError(message, status, details) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status;
    this.details = details;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function readToken() {
    try {
      return localStorage.getItem('access_token') || '';
    } catch (err) {
      return '';
    }
  }

  // The only outbound call shape on this page. Note what is ABSENT: no tenant
  // header, no tenant body field, no client-chosen tenant. The server resolves
  // the tenant from the signed claim and fails closed without one.
  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    };
    var token = readToken();
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body);

    return fetch(API_BASE + path, opts).then(function (res) {
      return res.text().then(function (raw) {
        var json = null;
        if (raw) {
          try { json = JSON.parse(raw); } catch (err) { json = null; }
        }
        if (!res.ok || (json && json.success === false)) {
          var message = (json && json.message) || ('Request failed (HTTP ' + res.status + ')');
          throw new ApiError(message, res.status, json ? json.details : null);
        }
        return json ? json.data : null;
      });
    }, function () {
      throw new ApiError('Unable to reach the Education service.', 0, null);
    });
  }

  // Turns any thrown value into one honest, user-facing sentence.
  function explain(err) {
    if (err instanceof ApiError) {
      var details = err.details;
      if (Array.isArray(details) && details.length) {
        return err.message + ' — ' + details.join('; ');
      }
      if (details && typeof details === 'object' && Array.isArray(details.details) && details.details.length) {
        return err.message + ' — ' + details.details.join('; ');
      }
      if (err.status === 401) {
        return 'Sign in to open the Education section. ' + err.message;
      }
      if (err.status === 403) {
        return 'This account is not permitted to use the Education section. ' + err.message;
      }
      return err.message;
    }
    return (err && err.message) || 'Something went wrong.';
  }

  // ---------------------------------------------------------------------
  // Lookup cache. The Education services denormalize nothing, so a table cell
  // that shows a student or a class name resolves it through these lists. The
  // cache is invalidated whenever a write touches the owning collection.
  // ---------------------------------------------------------------------

  var REF_SOURCES = {
    students: '/students',
    teachers: '/teachers',
    centers: '/centers',
    programs: '/programs',
    courses: '/courses',
    classes: '/classes',
    enrollments: '/enrollments'
  };

  var REF = {};
  var REF_PROMISE = {};

  function invalidateRef(name) {
    if (!name) {
      REF = {};
      REF_PROMISE = {};
      return;
    }
    delete REF[name];
    delete REF_PROMISE[name];
  }

  function loadRef(name) {
    if (REF[name]) return Promise.resolve(REF[name]);
    if (REF_PROMISE[name]) return REF_PROMISE[name];
    REF_PROMISE[name] = api('GET', REF_SOURCES[name]).then(function (rows) {
      REF[name] = Array.isArray(rows) ? rows : [];
      delete REF_PROMISE[name];
      return REF[name];
    }, function (err) {
      delete REF_PROMISE[name];
      REF[name] = [];
      throw err;
    });
    return REF_PROMISE[name];
  }

  // Human label for a referenced record, with the id as the honest fallback
  // when the referenced record is not resolvable inside this tenant.
  function refLabel(source, id) {
    var key = String(id || '').trim();
    if (!key) return '—';
    var rows = REF[source] || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id || '') === key) {
        return refName(source, rows[i]) + ' (' + key + ')';
      }
    }
    return key;
  }

  function refName(source, row) {
    if (!row) return '—';
    if (source === 'centers' || source === 'programs' || source === 'courses') {
      return String(row.displayName || row.name || row.id || '');
    }
    if (source === 'classes') {
      return String(row.displayName || row.name || row.classCode || row.id || '');
    }
    var first = String(row.firstName || '').trim();
    var last = String(row.lastName || '').trim();
    var full = (first + ' ' + last).trim();
    return String(row.displayName || full || row.id || '');
  }

  // `enrollments` has no name of its own, so its label is composed from the
  // student and class it links. The relationship is never duplicated as a
  // stored field; this is derived for display only.
  function enrollmentLabel(row) {
    if (!row) return '—';
    var student = refLabel('students', row.studentId);
    var klass = refLabel('classes', row.classId);
    return student + ' → ' + klass;
  }

  // ---------------------------------------------------------------------
  // Entity descriptors. Every field, option list and route here is mirrored
  // from the corresponding backend service.
  // ---------------------------------------------------------------------

  function refField(name, label, source, required, immutable) {
    return {
      name: name,
      label: label,
      type: 'ref',
      source: source,
      required: !!required,
      immutable: !!immutable
    };
  }

  function selectField(name, label, values, required) {
    return { name: name, label: label, type: 'select', values: values, required: !!required };
  }

  function textField(name, label, extra) {
    var field = { name: name, label: label, type: 'text', maxLength: MAX_STRING_LEN };
    if (extra) {
      Object.keys(extra).forEach(function (k) { field[k] = extra[k]; });
    }
    return field;
  }

  var ENTITIES = {
    students: {
      key: 'students',
      path: '/students',
      title: 'Students',
      icon: 'users',
      addLabel: 'Add Student',
      archivePath: '/archive',
      archiveLabel: 'Archive',
      statuses: STATUS_VALUES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: STATUS_VALUES },
        { name: 'search', label: 'Search', type: 'search' }
      ],
      fields: [
        textField('studentCode', 'Student Code'),
        textField('firstName', 'First Name', { required: true }),
        textField('lastName', 'Last Name', { required: true }),
        textField('dateOfBirth', 'Date of Birth', { type: 'date' }),
        textField('gender', 'Gender'),
        textField('phone', 'Phone'),
        textField('email', 'Email', { type: 'email' }),
        textField('address', 'Address'),
        selectField('status', 'Status', STATUS_VALUES),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Code', cell: function (r) { return code(r.studentCode); } },
        { label: 'Name', cell: function (r) { return text(refName('students', r)); } },
        { label: 'Phone', cell: function (r) { return text(r.phone); } },
        { label: 'Email', cell: function (r) { return text(r.email); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } }
      ],
      export: csvExport('education-students', [
        csvColumn('Code', function (r) { return str(r.studentCode); }),
        csvColumn('Name', function (r) { return refName('students', r); }),
        csvColumn('Phone', function (r) { return str(r.phone); }),
        csvColumn('Email', function (r) { return str(r.email); }),
        csvColumn('Status', function (r) { return str(r.status); })
      ])
    },

    teachers: {
      key: 'teachers',
      path: '/teachers',
      title: 'Teachers',
      icon: 'userCheck',
      addLabel: 'Add Teacher',
      archivePath: '/archive',
      archiveLabel: 'Archive',
      statuses: STATUS_VALUES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: STATUS_VALUES },
        { name: 'employmentType', label: 'Employment', type: 'select', values: EMPLOYMENT_TYPES },
        { name: 'search', label: 'Search', type: 'search' }
      ],
      fields: [
        textField('teacherCode', 'Teacher Code'),
        textField('firstName', 'First Name', { required: true }),
        textField('lastName', 'Last Name', { required: true }),
        textField('displayName', 'Display Name'),
        textField('dateOfBirth', 'Date of Birth', { type: 'date' }),
        textField('gender', 'Gender'),
        textField('phone', 'Phone'),
        textField('email', 'Email', { type: 'email' }),
        textField('address', 'Address'),
        textField('specialization', 'Specialization'),
        textField('qualification', 'Qualification'),
        selectField('employmentType', 'Employment Type', EMPLOYMENT_TYPES),
        selectField('status', 'Status', STATUS_VALUES),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Code', cell: function (r) { return code(r.teacherCode); } },
        { label: 'Name', cell: function (r) { return text(refName('teachers', r)); } },
        { label: 'Specialization', cell: function (r) { return text(r.specialization); } },
        { label: 'Employment', cell: function (r) { return r.employmentType ? pill(r.employmentType) : text(''); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } }
      ],
      export: csvExport('education-teachers', [
        csvColumn('Code', function (r) { return str(r.teacherCode); }),
        csvColumn('Name', function (r) { return refName('teachers', r); }),
        csvColumn('Specialization', function (r) { return str(r.specialization); }),
        csvColumn('Employment', function (r) { return str(r.employmentType); }),
        csvColumn('Status', function (r) { return str(r.status); })
      ])
    },

    centers: {
      key: 'centers',
      path: '/centers',
      title: 'Centers',
      icon: 'building',
      addLabel: 'Add Center',
      archivePath: '/archive',
      archiveLabel: 'Archive',
      statuses: STATUS_VALUES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: STATUS_VALUES },
        { name: 'search', label: 'Search', type: 'search' }
      ],
      fields: [
        textField('centerCode', 'Center Code'),
        textField('name', 'Name', { required: true }),
        textField('displayName', 'Display Name'),
        { name: 'description', label: 'Description', type: 'textarea', maxLength: MAX_STRING_LEN },
        textField('phone', 'Phone'),
        textField('email', 'Email', { type: 'email' }),
        textField('address', 'Address'),
        textField('timezone', 'Timezone', {
          hint: 'IANA time zone, for example Africa/Cairo.'
        }),
        selectField('status', 'Status', STATUS_VALUES),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Code', cell: function (r) { return code(r.centerCode); } },
        { label: 'Name', cell: function (r) { return text(refName('centers', r)); } },
        { label: 'Timezone', cell: function (r) { return code(r.timezone); } },
        { label: 'Phone', cell: function (r) { return text(r.phone); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } }
      ],
      export: csvExport('education-centers', [
        csvColumn('Code', function (r) { return str(r.centerCode); }),
        csvColumn('Name', function (r) { return refName('centers', r); }),
        csvColumn('Timezone', function (r) { return str(r.timezone); }),
        csvColumn('Phone', function (r) { return str(r.phone); }),
        csvColumn('Status', function (r) { return str(r.status); })
      ])
    },

    programs: {
      key: 'programs',
      path: '/programs',
      title: 'Programs',
      icon: 'folder',
      addLabel: 'Add Program',
      archivePath: '/archive',
      archiveLabel: 'Archive',
      statuses: STATUS_VALUES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: STATUS_VALUES },
        { name: 'centerId', label: 'Center', type: 'ref', source: 'centers' },
        { name: 'search', label: 'Search', type: 'search' }
      ],
      fields: [
        refField('centerId', 'Center', 'centers', false),
        textField('programCode', 'Program Code'),
        textField('name', 'Name', { required: true }),
        textField('displayName', 'Display Name'),
        { name: 'description', label: 'Description', type: 'textarea', maxLength: MAX_STRING_LEN },
        textField('level', 'Level'),
        { name: 'durationValue', label: 'Duration Value', type: 'number', min: 1, max: 1000 },
        selectField('durationUnit', 'Duration Unit', DURATION_UNITS),
        selectField('status', 'Status', STATUS_VALUES),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Code', cell: function (r) { return code(r.programCode); } },
        { label: 'Name', cell: function (r) { return text(refName('programs', r)); } },
        { label: 'Center', cell: function (r) { return code(r.centerId ? refLabel('centers', r.centerId) : ''); } },
        { label: 'Duration', cell: function (r) { return duration(r); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } }
      ],
      export: csvExport('education-programs', [
        csvColumn('Code', function (r) { return str(r.programCode); }),
        csvColumn('Name', function (r) { return refName('programs', r); }),
        csvColumn('Center', csvRef('centers', 'centerId')),
        csvColumn('Duration', function (r) {
          return r.durationValue === undefined || r.durationValue === null
            ? '' : str(r.durationValue) + ' ' + str(r.durationUnit);
        }),
        csvColumn('Status', function (r) { return str(r.status); })
      ])
    },

    courses: {
      key: 'courses',
      path: '/courses',
      title: 'Courses',
      icon: 'book',
      addLabel: 'Add Course',
      archivePath: '/archive',
      archiveLabel: 'Archive',
      statuses: STATUS_VALUES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: STATUS_VALUES },
        { name: 'programId', label: 'Program', type: 'ref', source: 'programs' },
        { name: 'search', label: 'Search', type: 'search' }
      ],
      fields: [
        refField('programId', 'Program', 'programs', true),
        textField('courseCode', 'Course Code'),
        textField('name', 'Name', { required: true }),
        textField('displayName', 'Display Name'),
        { name: 'description', label: 'Description', type: 'textarea', maxLength: MAX_STRING_LEN },
        textField('level', 'Level'),
        { name: 'durationValue', label: 'Duration Value', type: 'number', min: 1, max: 1000 },
        selectField('durationUnit', 'Duration Unit', DURATION_UNITS),
        selectField('status', 'Status', STATUS_VALUES),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Code', cell: function (r) { return code(r.courseCode); } },
        { label: 'Name', cell: function (r) { return text(refName('courses', r)); } },
        { label: 'Program', cell: function (r) { return code(refLabel('programs', r.programId)); } },
        { label: 'Duration', cell: function (r) { return duration(r); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } }
      ],
      export: csvExport('education-courses', [
        csvColumn('Code', function (r) { return str(r.courseCode); }),
        csvColumn('Name', function (r) { return refName('courses', r); }),
        csvColumn('Program', csvRef('programs', 'programId')),
        csvColumn('Duration', function (r) {
          return r.durationValue === undefined || r.durationValue === null
            ? '' : str(r.durationValue) + ' ' + str(r.durationUnit);
        }),
        csvColumn('Status', function (r) { return str(r.status); })
      ])
    },

    classes: {
      key: 'classes',
      path: '/classes',
      title: 'Classes',
      icon: 'school',
      addLabel: 'Add Class',
      archivePath: '/archive',
      archiveLabel: 'Archive',
      statuses: STATUS_VALUES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: STATUS_VALUES },
        { name: 'courseId', label: 'Course', type: 'ref', source: 'courses' },
        { name: 'teacherId', label: 'Teacher', type: 'ref', source: 'teachers' },
        { name: 'programId', label: 'Program', type: 'ref', source: 'programs' },
        { name: 'search', label: 'Search', type: 'search' }
      ],
      fields: [
        refField('courseId', 'Course', 'courses', true),
        refField('teacherId', 'Teacher', 'teachers', true),
        textField('classCode', 'Class Code'),
        textField('name', 'Name'),
        textField('displayName', 'Display Name'),
        { name: 'description', label: 'Description', type: 'textarea', maxLength: MAX_STRING_LEN },
        selectField('status', 'Status', STATUS_VALUES),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Code', cell: function (r) { return code(r.classCode); } },
        { label: 'Name', cell: function (r) { return text(refName('classes', r)); } },
        { label: 'Course', cell: function (r) { return code(refLabel('courses', r.courseId)); } },
        { label: 'Teacher', cell: function (r) { return code(refLabel('teachers', r.teacherId)); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } }
      ],
      export: csvExport('education-classes', [
        csvColumn('Code', function (r) { return str(r.classCode); }),
        csvColumn('Name', function (r) { return refName('classes', r); }),
        csvColumn('Course', csvRef('courses', 'courseId')),
        csvColumn('Teacher', csvRef('teachers', 'teacherId')),
        csvColumn('Status', function (r) { return str(r.status); })
      ])
    },

    enrollments: {
      key: 'enrollments',
      path: '/enrollments',
      title: 'Enrollments',
      icon: 'userPlus',
      addLabel: 'Add Enrollment',
      withdrawPath: '/withdraw',
      withdrawLabel: 'Withdraw',
      statuses: ENROLLMENT_STATUSES,
      filters: [
        { name: 'status', label: 'Status', type: 'select', values: ENROLLMENT_STATUSES },
        { name: 'studentId', label: 'Student', type: 'ref', source: 'students' },
        { name: 'classId', label: 'Class', type: 'ref', source: 'classes' },
        { name: 'courseId', label: 'Course', type: 'ref', source: 'courses' },
        { name: 'programId', label: 'Program', type: 'ref', source: 'programs' },
        { name: 'teacherId', label: 'Teacher', type: 'ref', source: 'teachers' }
      ],
      fields: [
        refField('studentId', 'Student', 'students', true, true),
        refField('classId', 'Class', 'classes', true, true),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Student', cell: function (r) { return text(refLabel('students', r.studentId)); } },
        { label: 'Class', cell: function (r) { return text(refLabel('classes', r.classId)); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } },
        { label: 'Enrolled', cell: function (r) { return code(String(r.enrolledAt || '').slice(0, 10)); } },
        { label: 'Notes', cell: function (r) { return text(r.notes); } }
      ],
      export: csvExport('education-enrollments', [
        csvColumn('Student', csvRef('students', 'studentId')),
        csvColumn('Class', csvRef('classes', 'classId')),
        csvColumn('Status', function (r) { return str(r.status); }),
        csvColumn('Enrolled', function (r) { return str(r.enrolledAt).slice(0, 10); }),
        csvColumn('Notes', function (r) { return str(r.notes); })
      ])
    },

    attendance: {
      key: 'attendance',
      path: '/attendance',
      title: 'Attendance',
      icon: 'clipboard',
      addLabel: 'Record Attendance',
      statuses: ATTENDANCE_STATUSES,
      filters: [
        { name: 'enrollmentId', label: 'Enrollment', type: 'ref', source: 'enrollments' },
        { name: 'attendanceDate', label: 'Date', type: 'date' },
        { name: 'dateFrom', label: 'From', type: 'date' },
        { name: 'dateTo', label: 'To', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', values: ATTENDANCE_STATUSES },
        { name: 'studentId', label: 'Student', type: 'ref', source: 'students' },
        { name: 'classId', label: 'Class', type: 'ref', source: 'classes' }
      ],
      fields: [
        refField('enrollmentId', 'Enrollment', 'enrollments', true, true),
        { name: 'attendanceDate', label: 'Attendance Date', type: 'date', required: true, immutable: true },
        selectField('status', 'Status', ATTENDANCE_STATUSES, true),
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Enrollment', cell: function (r) { return text(enrollmentLabel(byEnrollment(r.enrollmentId))); } },
        { label: 'Date', cell: function (r) { return code(r.attendanceDate); } },
        { label: 'Status', cell: function (r) { return pill(r.status); } },
        { label: 'Notes', cell: function (r) { return text(r.notes); } }
      ],
      export: csvExport('education-attendance', [
        csvColumn('Enrollment', csvRowRef('enrollments', 'enrollmentId')),
        csvColumn('Date', function (r) { return str(r.attendanceDate); }),
        csvColumn('Status', function (r) { return str(r.status); }),
        csvColumn('Notes', function (r) { return str(r.notes); })
      ])
    },

    scheduling: {
      key: 'scheduling',
      path: '/scheduling',
      title: 'Schedule',
      icon: 'calendar',
      addLabel: 'Add Session',
      statuses: [],
      filters: [
        { name: 'classId', label: 'Class', type: 'ref', source: 'classes' },
        { name: 'teacherId', label: 'Teacher', type: 'ref', source: 'teachers' },
        { name: 'scheduledDate', label: 'Date', type: 'date' },
        { name: 'dateFrom', label: 'From', type: 'date' },
        { name: 'dateTo', label: 'To', type: 'date' }
      ],
      fields: [
        refField('classId', 'Class', 'classes', true, true),
        { name: 'scheduledDate', label: 'Scheduled Date', type: 'date', required: true, immutable: true },
        { name: 'startTime', label: 'Start Time', type: 'time', required: true, hint: '24-hour wall clock, HH:MM.' },
        { name: 'endTime', label: 'End Time', type: 'time', required: true, hint: 'Must be after the start time.' },
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Class', cell: function (r) { return text(refLabel('classes', r.classId)); } },
        // The teacher is the teacher of the session's CLASS, resolved on demand.
        // A session stores no teacher of its own, and the backend derives the
        // same value for its own double-booking rule.
        { label: 'Teacher', cell: function (r) { return text(refLabel('teachers', teacherOfClass(r.classId))); } },
        { label: 'Date', cell: function (r) { return code(r.scheduledDate); } },
        { label: 'Time', cell: function (r) { return code(String(r.startTime || '') + ' – ' + String(r.endTime || '')); } },
        { label: 'Notes', cell: function (r) { return text(r.notes); } }
      ],
      export: csvExport('education-scheduling', [
        csvColumn('Class', csvRef('classes', 'classId')),
        csvColumn('Teacher', function (r) { return refLabel('teachers', teacherOfClass(r.classId)); }),
        csvColumn('Date', function (r) { return str(r.scheduledDate); }),
        csvColumn('Time', csvTime),
        csvColumn('Notes', function (r) { return str(r.notes); })
      ])
    },

    // Grading stays DESCRIPTIVE. `grade` is a bounded free-text value recorded
    // verbatim; the page offers no scale, no aggregation, no ranking and no
    // assessment vocabulary, because the backend defines none.
    grading: {
      key: 'grading',
      path: '/grading',
      title: 'Grading',
      icon: 'award',
      addLabel: 'Record Grade',
      statuses: [],
      filters: [
        { name: 'enrollmentId', label: 'Enrollment', type: 'ref', source: 'enrollments' },
        { name: 'gradingDate', label: 'Date', type: 'date' },
        { name: 'dateFrom', label: 'From', type: 'date' },
        { name: 'dateTo', label: 'To', type: 'date' },
        { name: 'grade', label: 'Grade', type: 'search' },
        { name: 'studentId', label: 'Student', type: 'ref', source: 'students' },
        { name: 'classId', label: 'Class', type: 'ref', source: 'classes' }
      ],
      fields: [
        refField('enrollmentId', 'Enrollment', 'enrollments', true, true),
        { name: 'gradingDate', label: 'Grading Date', type: 'date', required: true, immutable: true },
        {
          name: 'grade',
          label: 'Grade',
          type: 'text',
          required: true,
          maxLength: MAX_STRING_LEN,
          hint: 'Recorded exactly as typed. No scale is defined, so no scale is offered.'
        },
        { name: 'notes', label: 'Notes', type: 'textarea', maxLength: MAX_STRING_LEN }
      ],
      columns: [
        { label: 'Enrollment', cell: function (r) { return text(enrollmentLabel(byEnrollment(r.enrollmentId))); } },
        { label: 'Date', cell: function (r) { return code(r.gradingDate); } },
        { label: 'Grade', cell: function (r) { return text(r.grade); } },
        { label: 'Notes', cell: function (r) { return text(r.notes); } }
      ],
      export: csvExport('education-grading', [
        csvColumn('Enrollment', csvRowRef('enrollments', 'enrollmentId')),
        csvColumn('Date', function (r) { return str(r.gradingDate); }),
        csvColumn('Grade', function (r) { return str(r.grade); }),
        csvColumn('Notes', function (r) { return str(r.notes); })
      ])
    }
  };

  // ---------------------------------------------------------------------------
  // CSV export descriptors.
  //
  // One per list page, declared next to the columns it mirrors: the header is
  // the SAME label the table prints, and the value is the SAME field the table
  // shows, in plain text. Nothing else about the record is exported — no tenant
  // id, no token, no internal bookkeeping — and no user, auth or security field
  // appears anywhere on this page, so there is nothing else that could leak.
  // ---------------------------------------------------------------------------

  function csvExport(filename, columns) {
    return { filename: filename, columns: columns };
  }

  function csvColumn(header, value) {
    return { header: header, value: value };
  }

  // The derived labels the tables show (a student, a class) are resolved the
  // same way in the export, so a spreadsheet and the screen agree.
  function csvRef(source, key) {
    return function (row) { return refLabel(source, row[key]); };
  }

  function csvRowRef(source, key) {
    return function (row) { return enrollmentLabel(byEnrollment(row[key])); };
  }

  function csvTime(row) {
    return str(row.startTime) + ' - ' + str(row.endTime);
  }

  function byEnrollment(id) {

    var rows = REF.enrollments || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id || '') === String(id || '')) return rows[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Cell helpers.
  // ---------------------------------------------------------------------

  function code(value) {
    var raw = String(value === undefined || value === null ? '' : value).trim();
    if (raw === '') return '&mdash;';
    return '<span class="edu-mono">' + esc(raw) + '</span>';
  }

  function pill(value) {
    var raw = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    if (raw === '') return '&mdash;';
    var safe = raw.replace(/[^a-z_]/g, '');
    return '<span class="edu-pill edu-pill-' + safe + '">' + esc(raw) + '</span>';
  }

  function duration(row) {
    var value = row.durationValue;
    var unit = String(row.durationUnit || '').trim();
    if (value === undefined || value === null || String(value).trim() === '') return '&mdash;';
    return esc(String(value).trim() + (unit ? ' ' + unit : ''));
  }

  // ---------------------------------------------------------------------
  // Page state.
  // ---------------------------------------------------------------------

  var PAGES = ['dashboard', 'students', 'teachers', 'centers', 'programs', 'courses',
    'classes', 'roster', 'enrollments', 'attendance', 'register', 'schedule', 'calendar',
    'grading', 'settings', 'teacher', 'student'];

  var state = {
    page: 'dashboard',
    rows: {},
    filters: {},
    lookups: {},
    error: {},
    loading: {},
    // The four operational views keep their own small selection so a user can
    // arrive from a class row, from the roster, or from the nav and still land
    // on a coherent screen. Each value is an id or a day chosen by the user —
    // never a tenant, never an identity the backend does not assert.
    rosterClassId: '',
    registerClassId: '',
    registerDate: '',
    registerRows: [],
    calendarMode: 'week',
    calendarAnchor: '',
    pack: null
  };

  // The nav id `schedule` and the backend path segment `scheduling` are not the
  // same string. This is the single place that knows the difference.
  function entityFor(page) {
    if (page === 'schedule') return ENTITIES.scheduling;
    return ENTITIES[page] || null;
  }

  // ---------------------------------------------------------------------
  // DOM lookup + rendering.
  // ---------------------------------------------------------------------

  function byId(id) {
    return document.getElementById(id);
  }

  function renderPage(page) {
    state.page = page;
    var host = byId('edu-view');
    if (!host) return;

    var body = document.createElement('section');
    body.className = 'edu-page-body is-active';
    body.id = 'edu-body-' + page;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', pageLabel(page));

    var nodes = document.querySelectorAll('.edu-page-body');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
    host.appendChild(body);

    syncNav(page);
    closeDrawer();

    if (page === 'dashboard') renderDashboard(body);
    else if (page === 'teacher') renderTeacherWorkspace(body);
    else if (page === 'student') renderStudentWorkspace(body);
    else if (page === 'roster') renderRoster(body);
    else if (page === 'register') renderRegister(body);
    else if (page === 'calendar') renderCalendar(body);
    else if (page === 'settings') renderPackSettings(body);
    else renderEntity(body, entityFor(page));
  }

  function pageLabel(page) {
    if (page === 'dashboard') return 'Education dashboard';
    if (page === 'teacher') return 'Teacher workspace';
    if (page === 'student') return 'Student workspace';
    if (page === 'roster') return 'Class roster';
    if (page === 'register') return 'Class register';
    if (page === 'calendar') return 'Schedule calendar';
    if (page === 'settings') return 'Education settings';
    if (page === 'schedule') return 'Schedule';
    return (entityFor(page) || {}).title || 'Education';
  }

  function syncNav(page) {
    var buttons = document.querySelectorAll('[data-edu-page]');
    for (var i = 0; i < buttons.length; i++) {
      var isCurrent = buttons[i].getAttribute('data-edu-page') === page;
      buttons[i].classList.toggle('is-active', isCurrent);
      if (buttons[i].hasAttribute('aria-current')) {
        if (isCurrent) buttons[i].setAttribute('aria-current', 'page');
        else buttons[i].removeAttribute('aria-current');
      }
    }
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function stateBlock(kind, message, actionLabel, action) {
    var wrap = el('div', 'edu-state');
    wrap.innerHTML = esc(message);
    if (actionLabel && action) {
      var btn = el('button', 'edu-btn edu-btn-outline edu-btn-sm', esc(actionLabel));
      btn.type = 'button';
      btn.style.marginTop = '10px';
      btn.addEventListener('click', action);
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function banner(kind, message, retry) {
    var node = el('div', 'edu-banner edu-banner-' + kind);
    node.appendChild(el('span', null, esc(message)));
    if (retry) {
      var btn = el('button', null, 'Retry');
      btn.type = 'button';
      btn.addEventListener('click', retry);
      node.appendChild(btn);
    }
    return node;
  }

  function loadingBlock() {
    var wrap = el('div', 'edu-loading');
    var spinner = el('div', 'edu-spinner');
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading');
    wrap.appendChild(spinner);
    wrap.appendChild(el('span', null, 'Loading…'));
    return wrap;
  }

  function toast(message, isError) {
    var host = byId('edu-toasts');
    if (!host) return;
    var node = el('div', 'edu-toast' + (isError ? ' edu-toast-error' : ''), esc(message));
    host.appendChild(node);
    var live = byId('edu-live');
    if (live) live.textContent = message;
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 4500);
  }

  // ---------------------------------------------------------------------
  // Entity table page.
  // ---------------------------------------------------------------------

  function renderEntity(body, spec) {
    if (!spec) {
      body.appendChild(stateBlock('empty', 'This view is not available.'));
      return;
    }

    body.appendChild(el('h2', 'edu-section-title', esc(spec.title)));

    if (spec.key === 'grading') {
      body.appendChild(banner('info',
        'Grading here is descriptive only. A record carries an enrollment, a date, a ' +
        'grade value typed by staff and free-text notes. This page deliberately offers ' +
        'no scale, no totals and no comparison, because the platform defines none.'));
    }

    var toolbar = el('div', 'edu-actions');
    toolbar.style.marginTop = '0';
    var addBtn = el('button', 'edu-btn edu-btn-primary', icon('plus') + '<span>' + esc(spec.addLabel) + '</span>');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { openForm(spec, null); });
    toolbar.appendChild(addBtn);

    var refreshBtn = el('button', 'edu-btn edu-btn-outline', icon('refresh') + '<span>Refresh</span>');
    refreshBtn.type = 'button';
    refreshBtn.addEventListener('click', function () { loadPage(spec, true); });
    toolbar.appendChild(refreshBtn);

    // The export writes exactly the rows the table below is showing — the
    // currently loaded, currently filtered set — so the file can never disagree
    // with the screen. It stays disabled while there is nothing to write.
    if (spec.export) {
      var exportBtn = el('button', 'edu-btn edu-btn-outline',
        icon('download') + '<span>Export CSV</span>');
      exportBtn.type = 'button';
      exportBtn.setAttribute('data-edu-export', spec.key);
      exportBtn.addEventListener('click', function () { exportCsv(spec); });
      toolbar.appendChild(exportBtn);
    }

    body.appendChild(toolbar);

    var filtersHost = el('div', 'edu-filters');
    filtersHost.id = 'edu-filters';
    body.appendChild(filtersHost);

    var listHost = el('div', 'edu-card');
    listHost.id = 'edu-list';
    body.appendChild(listHost);

    renderFilters(spec, filtersHost);
    loadPage(spec, false);
  }

  function renderFilters(spec, host) {
    host.textContent = '';
    var current = state.filters[spec.key] || {};
    var defs = spec.filters || [];

    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      var group = el('div', 'edu-filter');
      var inputId = 'edu-f-' + spec.key + '-' + def.name;
      var label = el('label', null, esc(def.label));
      label.setAttribute('for', inputId);
      group.appendChild(label);

      var input;
      if (def.type === 'select') {
        input = el('select', 'edu-select');
        input.id = inputId;
        appendOptions(input, def.values, current[def.name]);
      } else {
        input = el('input', 'edu-input');
        input.id = inputId;
        input.type = def.type === 'date' ? 'date' : 'text';
        input.value = current[def.name] || '';
        if (def.type === 'date') input.dir = 'ltr';
      }
      input.addEventListener('change', function (e) {
        var name = e.target.getAttribute('data-filter-name');
        state.filters[spec.key] = state.filters[spec.key] || {};
        state.filters[spec.key][name] = e.target.value;
        loadPage(spec, false);
      });
      input.setAttribute('data-filter-name', def.name);
      group.appendChild(input);
      host.appendChild(group);
    }

    if (defs.length) {
      var clear = el('button', 'edu-btn edu-btn-outline edu-btn-sm', 'Clear filters');
      clear.type = 'button';
      clear.addEventListener('click', function () {
        state.filters[spec.key] = {};
        renderFilters(spec, host);
        loadPage(spec, false);
      });
      host.appendChild(clear);
    }
  }

  function appendOptions(select, values, selected) {
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'All';
    select.appendChild(blank);
    for (var i = 0; i < values.length; i++) {
      var opt = document.createElement('option');
      opt.value = values[i];
      opt.textContent = values[i];
      if (String(selected || '') === values[i]) opt.selected = true;
      select.appendChild(opt);
    }
  }

  // Loads the reference collections a table needs, then the table itself.
  // Takes the SPEC, not the nav id, because the nav id `schedule` and the
  // entity key `scheduling` differ. The stale-response guard compares specs, so
  // a response that arrives after the user navigated away is dropped.
  function loadPage(spec, isRefresh) {
    if (!spec) return;

    var host = byId('edu-list');
    if (!host) return;

    state.loading[spec.key] = true;
    if (isRefresh) host.textContent = '';
    host.appendChild(loadingBlock());

    Promise.all(refSourcesFor(spec).map(loadRef)).then(function () {
      state.loading[spec.key] = false;
      return loadRows(spec);
    }).then(function (rows) {
      if (entityFor(state.page) !== spec) return;
      paintRows(spec, rows);
    }).catch(function (err) {
      state.loading[spec.key] = false;
      if (entityFor(state.page) !== spec) return;
      state.error[spec.key] = explain(err);
      paintError(spec, explain(err));
    });
  }

  function refSourcesFor(spec) {
    var sources = [];
    (spec.filters || []).forEach(function (def) {
      if (def.type === 'ref' && sources.indexOf(def.source) < 0) sources.push(def.source);
    });
    (spec.fields || []).forEach(function (field) {
      if (field.type === 'ref' && sources.indexOf(field.source) < 0) sources.push(field.source);
    });
    if (spec.key === 'attendance' || spec.key === 'grading') {
      ['students', 'classes', 'enrollments'].forEach(function (name) {
        if (sources.indexOf(name) < 0) sources.push(name);
      });
    }
    return sources;
  }

  function loadRows(spec) {
    var filters = state.filters[spec.key] || {};
    var query = qs(filters);
    return api('GET', spec.path + (query ? '?' + query : '')).then(function (rows) {
      state.rows[spec.key] = Array.isArray(rows) ? rows : [];
      return state.rows[spec.key];
    });
  }

  function paintError(spec, message) {
    var host = byId('edu-list');
    if (!host) return;
    host.textContent = '';
    host.appendChild(banner('error', message, function () { loadPage(spec, true); }));
  }

  function paintRows(spec, rows) {
    var host = byId('edu-list');
    if (!host) return;
    host.textContent = '';

    host.appendChild(el('h2', null, esc(spec.title)));
    host.appendChild(el('p', 'edu-card-sub',
      rows.length + (rows.length === 1 ? ' record' : ' records') + ' in this tenant.'));

    if (!rows.length) {
      host.appendChild(stateBlock('empty', 'No records match the current filters.',
        spec.addLabel, function () { openForm(spec, null); }));
      return;
    }

    var wrap = el('div', 'edu-table-wrap');
    var table = el('table', 'edu-table');
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    (spec.columns || []).forEach(function (column) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = column.label;
      headRow.appendChild(th);
    });
    var actionsTh = document.createElement('th');
    actionsTh.scope = 'col';
    actionsTh.textContent = 'Actions';
    headRow.appendChild(actionsTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      (spec.columns || []).forEach(function (column) {
        var td = document.createElement('td');
        td.innerHTML = column.cell(row);
        tr.appendChild(td);
      });
      tr.appendChild(actionCell(spec, row));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function actionCell(spec, row) {
    var td = el('td', 'edu-cell-actions');
    var wrap = el('div', 'edu-actions');
    wrap.style.marginTop = '0';

    // The roster is a VIEW over the enrollments that already exist for this
    // class. It adds no stored data and no new endpoint: the same
    // `GET /enrollments?classId=` the list page already calls.
    if (spec.key === 'classes') {
      var rosterBtn = el('button', 'edu-btn edu-btn-outline edu-btn-sm',
        icon('list', 'edu-icon-sm') + '<span>Roster</span>');
      rosterBtn.type = 'button';
      rosterBtn.addEventListener('click', function () {
        state.rosterClassId = String(row.id || '');
        go('roster');
      });
      wrap.appendChild(rosterBtn);
    }

    var editBtn = el('button', 'edu-btn edu-btn-outline edu-btn-sm', icon('edit', 'edu-icon-sm') + '<span>Edit</span>');
    editBtn.type = 'button';
    editBtn.addEventListener('click', function () { openForm(spec, row); });
    wrap.appendChild(editBtn);

    if (spec.archivePath && row.status === 'active') {
      var archiveBtn = el('button', 'edu-btn edu-btn-danger edu-btn-sm',
        icon('archive', 'edu-icon-sm') + '<span>' + esc(spec.archiveLabel) + '</span>');
      archiveBtn.type = 'button';
      archiveBtn.addEventListener('click', function () { confirmAndRun(spec, row); });
      wrap.appendChild(archiveBtn);
    }

    if (spec.withdrawPath && row.status === 'active') {
      var withdrawBtn = el('button', 'edu-btn edu-btn-danger edu-btn-sm',
        icon('archive', 'edu-icon-sm') + '<span>' + esc(spec.withdrawLabel) + '</span>');
      withdrawBtn.type = 'button';
      withdrawBtn.addEventListener('click', function () { confirmAndRun(spec, row); });
      wrap.appendChild(withdrawBtn);
    }

    td.appendChild(wrap);
    return td;
  }

  // ---------------------------------------------------------------------
  // Dashboard. Counts and a descriptive attendance breakdown only. Every
  // figure is a plain record count: no rate, no share, no comparison.
  // ---------------------------------------------------------------------

  var DASHBOARD_CARDS = [
    { key: 'students', label: 'Students' },
    { key: 'teachers', label: 'Teachers' },
    { key: 'centers', label: 'Centers' },
    { key: 'programs', label: 'Programs' },
    { key: 'courses', label: 'Courses' },
    { key: 'classes', label: 'Classes' },
    { key: 'enrollments', label: 'Enrollments' },
    { key: 'scheduling', label: 'Schedule' },
    { key: 'grading', label: 'Grading' }
  ];

  function statCard(label, total) {
    var stat = el('div', 'edu-stat');
    stat.appendChild(el('span', 'edu-stat-label', esc(label)));
    stat.appendChild(el('span', 'edu-stat-value', String(total)));
    stat.appendChild(el('span', 'edu-stat-sub', 'records in this tenant'));
    return stat;
  }

  function renderDashboard(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Education overview'));
    body.appendChild(el('p', 'edu-card-sub',
      'Every figure below is a record count for the signed-in tenant, read from the ' +
      'Education services. No figure here is combined with another or compared.'));

    var grid = el('div', 'edu-dashboard-grid');
    body.appendChild(grid);

    var dist = el('div', 'edu-card');
    dist.id = 'edu-dashboard-dist';
    body.appendChild(dist);
    dist.appendChild(loadingBlock());

    var capabilities = el('div', 'edu-card');
    capabilities.id = 'edu-dashboard-caps';
    body.appendChild(capabilities);
    capabilities.appendChild(loadingBlock());

    // The attendance register is requested once, outside the count-card batch,
    // so an unreadable attendance collection degrades only the breakdown and
    // never blanks the counts beside it.
    var attendanceRequest = api('GET', '/attendance').then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    }, function () {
      return null;
    });

    Promise.all(DASHBOARD_CARDS.map(function (card) {
      return api('GET', '/' + card.key).then(function (rows) {
        return { card: card, total: Array.isArray(rows) ? rows.length : 0 };
      }, function (err) {
        return { card: card, error: explain(err) };
      });
    })).then(function (results) {
      if (state.page !== 'dashboard') return;
      results.forEach(function (result) {
        if (result.error) return;
        grid.appendChild(statCard(result.card.label, result.total));
      });
    });

    // One request serves both the attendance count card and the breakdown, so
    // the page never fetches the same register twice.
    attendanceRequest.then(function (rows) {
      if (state.page !== 'dashboard') return;
      if (rows) grid.appendChild(statCard('Attendance', rows.length));
      paintAttendanceDistribution(dist, rows);
    });

    api('GET', '/capabilities').then(function (rows) {
      if (state.page !== 'dashboard') return;
      capabilities.textContent = '';
      capabilities.appendChild(el('h2', null, 'Shipped Education capabilities'));
      capabilities.appendChild(el('p', 'edu-card-sub',
        'Reported by the Education service itself, so this panel can never overstate the surface.'));
      var list = el('ul', 'edu-ref-list');
      (Array.isArray(rows) ? rows : []).forEach(function (entry) {
        var li = document.createElement('li');
        li.innerHTML = (entry.implemented
          ? '<span class="edu-pill edu-pill-active">implemented</span>'
          : '<span class="edu-pill edu-pill-archived">not implemented</span>') +
          ' <strong>' + esc(entry.key) + '</strong> <span class="edu-mono">' + esc(entry.phase) + '</span> — ' +
          esc(entry.description);
        list.appendChild(li);
      });
      if (!list.children.length) {
        list.appendChild(stateBlock('empty', 'No capabilities reported.'));
      }
      capabilities.appendChild(list);
    }, function (err) {
      if (state.page !== 'dashboard') return;
      capabilities.textContent = '';
      capabilities.appendChild(el('h2', null, 'Shipped Education capabilities'));
      capabilities.appendChild(banner('neutral', explain(err)));
    });
  }

  // A distribution of COUNTS by attendance status. The bar length is a visual
  // cue over a raw count; no percentage, rate or share is displayed.
  function paintAttendanceDistribution(host, rows) {
    host.textContent = '';
    host.appendChild(el('h2', null, 'Attendance records by status'));
    host.appendChild(el('p', 'edu-card-sub',
      'Raw record counts, read from the attendance service for this tenant.'));

    if (rows === null) {
      host.appendChild(banner('neutral',
        'Attendance is not readable with this account, so no breakdown is shown.'));
      return;
    }
    if (!rows.length) {
      host.appendChild(stateBlock('empty', 'No attendance records yet.'));
      return;
    }

    var totals = {};
    ATTENDANCE_STATUSES.forEach(function (value) { totals[value] = 0; });
    rows.forEach(function (row) {
      var value = String(row.status || '').trim();
      if (Object.prototype.hasOwnProperty.call(totals, value)) totals[value] += 1;
    });

    var max = 1;
    ATTENDANCE_STATUSES.forEach(function (value) { if (totals[value] > max) max = totals[value]; });

    var dist = el('div', 'edu-dist');
    ATTENDANCE_STATUSES.forEach(function (value) {
      var row = el('div', 'edu-dist-row');
      row.appendChild(el('span', 'edu-dist-label', esc(value)));
      var track = el('div', 'edu-dist-track');
      var fill = el('div', 'edu-dist-fill edu-dist-fill-' + value);
      fill.style.width = Math.round((totals[value] / max) * 100) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'edu-dist-value', String(totals[value])));
      dist.appendChild(row);
    });
    host.appendChild(dist);
  }

  // ---------------------------------------------------------------------
  // Class roster.
  //
  // A ROSTER IS NOT A RECORD. It is the set of enrollments that already exist
  // for one class, read through the existing `GET /enrollments?classId=`
  // filter, with each student resolved from the students the page has already
  // loaded. Nothing is duplicated, cached under a new key, or written back, and
  // the search runs over rows the browser is already holding rather than
  // inventing a search endpoint the backend does not declare.
  // ---------------------------------------------------------------------

  function renderRoster(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Class roster'));

    var picker = el('div', 'edu-filters');
    body.appendChild(picker);

    var group = el('div', 'edu-filter');
    var label = el('label', null, 'Class');
    label.setAttribute('for', 'edu-roster-class');
    group.appendChild(label);
    var select = el('select', 'edu-select');
    select.id = 'edu-roster-class';
    group.appendChild(select);
    picker.appendChild(group);

    // One button to move from the roster to the register for the same class and
    // the same day, so the operational path is a single step.
    var registerBtn = el('button', 'edu-btn edu-btn-primary',
      icon('clipboard') + '<span>Take attendance</span>');
    registerBtn.type = 'button';
    registerBtn.addEventListener('click', function () {
      state.registerClassId = select.value;
      state.registerDate = today();
      go('register');
    });
    picker.appendChild(registerBtn);

    var host = el('div', 'edu-card');
    host.id = 'edu-roster-detail';
    body.appendChild(host);
    host.appendChild(loadingBlock());

    Promise.all([loadRef('classes'), loadRef('students'), loadRef('courses'), loadRef('teachers')])
      .then(function (results) {
        var classes = results[0];
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'Choose a class';
        select.appendChild(blank);
        classes.forEach(function (klass) {
          var opt = document.createElement('option');
          opt.value = String(klass.id || '');
          opt.textContent = refName('classes', klass) + (klass.classCode ? ' (' + klass.classCode + ')' : '');
          select.appendChild(opt);
        });

        var wanted = state.rosterClassId;
        var exists = classes.some(function (klass) { return String(klass.id || '') === wanted; });
        if (!exists) wanted = classes.length ? String(classes[0].id || '') : '';
        state.rosterClassId = wanted;
        select.value = wanted;

        if (!wanted) {
          host.textContent = '';
          host.appendChild(stateBlock('empty', 'No class records in this tenant yet.'));
          return;
        }
        paintRoster(host, wanted);
      }, function (err) {
        host.textContent = '';
        host.appendChild(banner('error', explain(err)));
      });

    select.addEventListener('change', function () {
      state.rosterClassId = select.value;
      if (!select.value) {
        host.textContent = '';
        host.appendChild(stateBlock('empty', 'Choose a class to see its roster.'));
        return;
      }
      paintRoster(host, select.value);
    });
  }

  function paintRoster(host, classId) {
    if (state.page !== 'roster') return;
    host.textContent = '';
    host.appendChild(loadingBlock());

    api('GET', '/enrollments?classId=' + encodeURIComponent(classId))
      .then(function (rows) {
        if (state.page !== 'roster') return;
        paintRosterBody(host, classId, Array.isArray(rows) ? rows : []);
      }, function (err) {
        if (state.page !== 'roster') return;
        host.textContent = '';
        host.appendChild(banner('error', explain(err)));
      });
  }

  function paintRosterBody(host, classId, rows) {
    host.textContent = '';
    var klass = null;
    var classes = REF.classes || [];
    for (var i = 0; i < classes.length; i++) {
      if (String(classes[i].id || '') === String(classId || '')) klass = classes[i];
    }

    // The class detail panel. Everything here is read off the Class record or
    // resolved through it; the Class chain behind a Class (course, then program
    // and center) is read for display only, exactly as the table cells do.
    if (klass) {
      var details = el('div', 'edu-detail-grid');
      [
        ['Class', refName('classes', klass)],
        ['Class Code', str(klass.classCode)],
        ['Course', refLabel('courses', klass.courseId)],
        ['Teacher', refLabel('teachers', klass.teacherId)],
        ['Status', str(klass.status)],
        ['Description', str(klass.description)],
        ['Notes', str(klass.notes)]
      ].forEach(function (pair) {
        var cell = el('div', 'edu-detail');
        cell.appendChild(el('span', 'edu-detail-label', esc(pair[0])));
        cell.appendChild(el('span', 'edu-detail-value', esc(pair[1] === '' ? '—' : pair[1])));
        details.appendChild(cell);
      });
      host.appendChild(el('h2', null, 'Class details'));
      host.appendChild(details);
    }

    var head = el('div', 'edu-section-head');
    head.appendChild(el('h2', 'edu-section-title', 'Roster'));
    head.appendChild(el('span', 'edu-card-sub',
      rows.length + (rows.length === 1 ? ' enrolled student' : ' enrolled students') + ' in this class.'));
    host.appendChild(head);

    if (!rows.length) {
      host.appendChild(stateBlock('empty', 'No students are enrolled in this class yet.',
        'Add Enrollment', function () { go('enrollments'); }));
      return;
    }

    // A client-side filter over the rows already fetched. It cannot widen the
    // result set, so it can never show a record the tenant call did not return.
    var searchId = 'edu-roster-search';
    var search = el('input', 'edu-input');
    search.id = searchId;
    search.type = 'search';
    search.placeholder = 'Search students';
    var searchLabel = el('label', 'edu-sr-only', 'Search students');
    searchLabel.setAttribute('for', searchId);
    var searchGroup = el('div', 'edu-filter');
    searchGroup.appendChild(searchLabel);
    searchGroup.appendChild(search);
    host.appendChild(searchGroup);

    var tableHost = el('div');
    host.appendChild(tableHost);

    var paint = function (needle) {
      var query = String(needle || '').trim().toLowerCase();
      var visible = rows.filter(function (row) {
        if (!query) return true;
        var student = refLabel('students', row.studentId);
        var codeText = str(studentCodeOf(row.studentId)).toLowerCase();
        return (student + ' ' + codeText).toLowerCase().indexOf(query) >= 0;
      });

      tableHost.textContent = '';
      if (!visible.length) {
        tableHost.appendChild(stateBlock('empty', 'No enrolled student matches this search.'));
        return;
      }
      tableHost.appendChild(simpleTable(
        ['Student', 'Status', 'Enrolled', 'Withdrawn', 'Notes'],
        visible.map(function (row) {
          return [
            text(refLabel('students', row.studentId)),
            pill(row.status),
            code(str(row.enrolledAt).slice(0, 10)),
            row.withdrawnAt ? code(str(row.withdrawnAt).slice(0, 10)) : code(''),
            text(row.notes)
          ];
        })
      ));
    };

    search.addEventListener('input', function () { paint(search.value); });
    paint('');
  }

  function studentCodeOf(studentId) {
    var rows = REF.students || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id || '') === String(studentId || '')) return rows[i].studentCode;
    }
    return '';
  }

  // ---------------------------------------------------------------------
  // Class register — one workflow for a whole class.
  //
  // The teacher picks a class and a day, the roster arrives from the SAME
  // `GET /enrollments?classId=` call the roster view uses, and the whole class is
  // marked in one save. The semantics are unchanged: `enrollmentId` stays the
  // only ownership authority, a status is one of the four the service accepts,
  // and a day that is already recorded is loaded for correction rather than
  // overwritten.
  //
  // TWO EXPLICIT WRITES, NEVER ONE SILENT ONE. Rows with no record for the day
  // are sent as a single `POST /attendance/bulk`, which is all-or-nothing. Rows
  // that already have a record are corrections, and a correction is still the
  // existing `PUT /attendance/:id` with its own rules — the batch endpoint
  // deliberately refuses them with a typed conflict rather than replacing them.
  // ---------------------------------------------------------------------

  function renderRegister(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Class register'));
    body.appendChild(banner('info',
      'Mark a whole class in one save. Every student needs an explicit status; nothing is ' +
      'marked for you. A day that is already recorded is loaded here so you can correct it ' +
      'through the same rules the service already applies.'));

    var picker = el('div', 'edu-filters');
    body.appendChild(picker);

    var classGroup = el('div', 'edu-filter');
    var classLabel = el('label', null, 'Class');
    classLabel.setAttribute('for', 'edu-register-class');
    classGroup.appendChild(classLabel);
    var classSelect = el('select', 'edu-select');
    classSelect.id = 'edu-register-class';
    classGroup.appendChild(classSelect);
    picker.appendChild(classGroup);

    var dateGroup = el('div', 'edu-filter');
    var dateLabel = el('label', null, 'Date');
    dateLabel.setAttribute('for', 'edu-register-date');
    dateGroup.appendChild(dateLabel);
    var dateInput = el('input', 'edu-input');
    dateInput.id = 'edu-register-date';
    dateInput.type = 'date';
    dateInput.dir = 'ltr';
    // The service refuses a future day, so the control is capped rather than
    // letting the request fail.
    dateInput.max = today();
    dateGroup.appendChild(dateInput);
    picker.appendChild(dateGroup);

    var allPresent = el('button', 'edu-btn edu-btn-outline',
      icon('userCheck') + '<span>Mark all present</span>');
    allPresent.type = 'button';
    allPresent.addEventListener('click', function () {
      state.registerRows.forEach(function (row) { row.status = 'present'; });
      paintRegister();
    });
    picker.appendChild(allPresent);

    var host = el('div', 'edu-card');
    host.id = 'edu-register-body';
    body.appendChild(host);
    host.appendChild(loadingBlock());

    function reload() {
      state.registerDate = dateInput.value;
      state.registerClassId = classSelect.value;
      if (!classSelect.value || !isDay(dateInput.value)) {
        host.textContent = '';
        host.appendChild(stateBlock('empty', 'Choose a class and a date to mark the register.'));
        return;
      }
      host.textContent = '';
      host.appendChild(loadingBlock());
      Promise.all([loadRef('students'), loadRef('enrollments'), loadRef('classes'),
        api('GET', '/enrollments?classId=' + encodeURIComponent(classSelect.value)),
        api('GET', '/attendance?classId=' + encodeURIComponent(classSelect.value) +
          '&attendanceDate=' + encodeURIComponent(dateInput.value))
      ]).then(function (results) {
        if (state.page !== 'register') return;
        var enrollments = Array.isArray(results[3]) ? results[3] : [];
        var existing = Array.isArray(results[4]) ? results[4] : [];
        var byId = {};
        existing.forEach(function (row) { byId[String(row.enrollmentId || '')] = row; });

        state.registerRows = enrollments.map(function (row) {
          var key = String(row.id || '');
          var prior = byId[key] || null;
          return {
            enrollmentId: key,
            studentId: row.studentId,
            // An already-recorded day is loaded with the value staff gave it, so
            // a correction starts from the truth rather than from a blank.
            status: prior ? String(prior.status || '') : '',
            notes: prior ? String(prior.notes || '') : '',
            existingId: prior ? String(prior.id || '') : ''
          };
        });
        paintRegister();
      }, function (err) {
        if (state.page !== 'register') return;
        host.textContent = '';
        host.appendChild(banner('error', explain(err), reload));
      });
    }

    // The counts and the table are repainted from `state.registerRows` after any
    // change, so a total can never disagree with the rows above it.
    function paintRegister() {
      if (state.page !== 'register') return;
      host.textContent = '';

      if (!state.registerRows.length) {
        host.appendChild(stateBlock('empty',
          'No students are enrolled in this class, so there is no register to mark.'));
        return;
      }

      var counts = {};
      ATTENDANCE_STATUSES.forEach(function (value) { counts[value] = 0; });
      var already = 0;
      state.registerRows.forEach(function (row) {
        if (row.existingId) already += 1;
        if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1;
      });

      var summary = el('div', 'edu-summary');
      // The five figures are COUNTS of the rows above them and nothing else:
      // the roster size and how many rows currently carry each status. No
      // rate, share, ratio or average is derived from them anywhere.
      var headCount = el('div', 'edu-summary-item');
      headCount.appendChild(el('span', 'edu-summary-label', 'Total'));
      headCount.appendChild(el('span', 'edu-summary-value', String(state.registerRows.length)));
      summary.appendChild(headCount);
      ATTENDANCE_STATUSES.forEach(function (value) {
        var item = el('div', 'edu-summary-item');
        item.appendChild(el('span', 'edu-summary-label', value));
        item.appendChild(el('span', 'edu-summary-value', String(counts[value])));
        summary.appendChild(item);
      });
      var recorded = el('div', 'edu-summary-item');
      recorded.appendChild(el('span', 'edu-summary-label', 'Already recorded'));
      recorded.appendChild(el('span', 'edu-summary-value', String(already)));
      summary.appendChild(recorded);
      summary.setAttribute('role', 'status');
      summary.setAttribute('aria-live', 'polite');
      host.appendChild(summary);

      host.appendChild(el('p', 'edu-card-sub',
        already
          ? already + ' student(s) already have a record for this day and will be corrected on save.'
          : 'No student has a record for this day yet.'));

      var wrap = el('div', 'edu-table-wrap');
      var table = el('table', 'edu-table');
      table.innerHTML = '<thead><tr>' +
        '<th scope="col">Student</th>' +
        '<th scope="col">Status</th>' +
        '<th scope="col">Notes</th>' +
        '<th scope="col">Record</th>' +
        '</tr></thead>';
      var tbody = document.createElement('tbody');

      state.registerRows.forEach(function (row, index) {
        var tr = document.createElement('tr');

        var nameCell = document.createElement('td');
        nameCell.innerHTML = text(refLabel('students', row.studentId));
        tr.appendChild(nameCell);

        var statusCell = document.createElement('td');
        var statusSelect = el('select', 'edu-select edu-select-inline');
        statusSelect.setAttribute('data-register-status', String(index));
        var unset = document.createElement('option');
        unset.value = '';
        unset.textContent = '— not set —';
        statusSelect.appendChild(unset);
        ATTENDANCE_STATUSES.forEach(function (value) {
          var opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value;
          if (row.status === value) opt.selected = true;
          statusSelect.appendChild(opt);
        });
        statusSelect.addEventListener('change', function () {
          state.registerRows[index].status = statusSelect.value;
          paintRegister();
        });
        statusCell.appendChild(statusSelect);
        tr.appendChild(statusCell);

        var notesCell = document.createElement('td');
        var notes = el('input', 'edu-input');
        notes.type = 'text';
        notes.maxLength = MAX_STRING_LEN;
        notes.value = row.notes;
        notes.setAttribute('data-register-notes', String(index));
        notes.setAttribute('aria-label', 'Notes');
        notes.addEventListener('input', function () {
          state.registerRows[index].notes = notes.value;
        });
        notesCell.appendChild(notes);
        tr.appendChild(notesCell);

        var recordCell = document.createElement('td');
        recordCell.innerHTML = row.existingId
          ? '<span class="edu-pill edu-pill-inactive">correction</span>'
          : code('new');
        tr.appendChild(recordCell);

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrap.appendChild(table);
      host.appendChild(wrap);

      var actions = el('div', 'edu-actions');
      var save = el('button', 'edu-btn edu-btn-primary', icon('check') + '<span>Save all</span>');
      save.type = 'button';
      save.setAttribute('data-register-save', 'true');
      save.addEventListener('click', function () { saveRegister(); });
      actions.appendChild(save);
      host.appendChild(actions);
    }

    function saveRegister() {
      var missing = state.registerRows.filter(function (row) { return !row.status; });
      if (missing.length) {
        toast(missing.length + ' student(s) still have no status. Mark every student before saving.', true);
        return;
      }

      var payloadEntries = [];
      var corrections = [];
      state.registerRows.forEach(function (row) {
        if (row.existingId) {
          // A correction addresses the RECORD, not the relationship: the update
          // route refuses `enrollmentId` outright, so the body carries only what
          // the service allows a correction to change.
          var body = { status: row.status };
          if (row.notes) body.notes = row.notes;
          corrections.push({ row: row, body: body });
        } else {
          var entry = { enrollmentId: row.enrollmentId, status: row.status };
          if (row.notes) entry.notes = row.notes;
          payloadEntries.push(entry);
        }
      });

      function report(created, corrected, failures) {
        if (state.page !== 'register') return;
        var parts = [];
        if (created) parts.push(created + ' recorded');
        if (corrected) parts.push(corrected + ' corrected');
        if (failures.length) {
          toast(parts.join(', ') + ' — ' + failures.length + ' failed: ' + failures.join('; '), true);
        } else {
          toast(parts.join(', ') + '.');
        }
        reload();
      }

      // ONE request for every new row, and the existing single-record path for
      // every correction. A refused batch therefore leaves the register exactly
      // as it was, which is reported rather than hidden.
      var created = 0;
      var corrected = 0;
      var failures = [];

      var chain = Promise.resolve();
      if (payloadEntries.length) {
        chain = chain.then(function () {
          return api('POST', '/attendance/bulk', {
            attendanceDate: dateInput.value,
            entries: payloadEntries
          }).then(function () {
            created = payloadEntries.length;
          }, function (err) {
            throw err;
          });
        });
      } else {
        chain = chain.then(function () { return null; });
      }

      corrections.forEach(function (item) {
        chain = chain.then(function () {
          return api('PUT', '/attendance/' + encodeURIComponent(item.row.existingId), item.body)
            .then(function () { corrected += 1; }, function (err) {
              failures.push(refLabel('students', item.row.studentId) + ': ' + explain(err));
            });
        });
      });

      chain.then(function () {
        report(created, corrected, failures);
      }, function (err) {
        if (state.page !== 'register') return;
        // The batch is all-or-nothing, so a refusal here means the register is
        // unchanged. It is reported plainly instead of being retried quietly.
        toast(explain(err), true);
      });
    }

    Promise.all([loadRef('classes'), loadRef('students')]).then(function (results) {
      var classes = results[0];
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose a class';
      classSelect.appendChild(blank);
      classes.forEach(function (klass) {
        var opt = document.createElement('option');
        opt.value = String(klass.id || '');
        opt.textContent = refName('classes', klass) + (klass.classCode ? ' (' + klass.classCode + ')' : '');
        classSelect.appendChild(opt);
      });

      var wanted = state.registerClassId;
      var exists = classes.some(function (klass) { return String(klass.id || '') === wanted; });
      if (!exists) wanted = classes.length ? String(classes[0].id || '') : '';
      classSelect.value = wanted;
      state.registerClassId = wanted;
      if (!dateInput.value) dateInput.value = isDay(state.registerDate) ? state.registerDate : today();
      reload();
    }, function (err) {
      host.textContent = '';
      host.appendChild(banner('error', explain(err)));
    });

    classSelect.addEventListener('change', reload);
    dateInput.addEventListener('change', reload);
  }

  // ---------------------------------------------------------------------
  // Schedule calendar.
  //
  // A reading of the sessions that already exist, over the existing
  // `dateFrom` / `dateTo` filters. There is no recurrence, no room, no capacity
  // and no timetable template anywhere in the backend, so there is none here: a
  // week is seven columns of REAL scheduled sessions and nothing is generated to
  // fill an empty cell. On a narrow screen the same markup stacks into an
  // agenda, because a squeezed seven-column grid is unreadable on a phone.
  // ---------------------------------------------------------------------

  var CALENDAR_MODES = [
    { key: 'day', label: 'Day', icon: 'clock' },
    { key: 'week', label: 'Week', icon: 'grid' },
    { key: 'agenda', label: 'Agenda', icon: 'list' }
  ];

  function calendarRange(mode, anchor) {
    if (mode === 'day') return { from: anchor, to: anchor };
    if (mode === 'agenda') {
      var from = startOfWeek(anchor);
      return { from: from, to: addDays(from, 27) };
    }
    var start = startOfWeek(anchor);
    return { from: start, to: addDays(start, 6) };
  }

  function renderCalendar(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Schedule calendar'));
    body.appendChild(banner('info',
      'Every entry below is a session that already exists in this tenant, read over a date ' +
      'range. There is no recurring timetable here: an empty day is empty because nothing ' +
      'was scheduled, not because a template is missing.'));

    var modes = el('div', 'edu-seg', el('span', 'edu-seg-label', 'View'));
    CALENDAR_MODES.forEach(function (mode) {
      var btn = el('button', 'edu-btn edu-btn-outline edu-btn-sm' +
        (state.calendarMode === mode.key ? ' is-active' : ''),
        icon(mode.icon, 'edu-icon-sm') + '<span>' + esc(mode.label) + '</span>');
      btn.type = 'button';
      btn.setAttribute('data-calendar-mode', mode.key);
      btn.setAttribute('aria-pressed', state.calendarMode === mode.key ? 'true' : 'false');
      btn.addEventListener('click', function () {
        state.calendarMode = mode.key;
        go('calendar');
      });
      modes.appendChild(btn);
    });
    body.appendChild(modes);

    var nav = el('div', 'edu-filters');
    body.appendChild(nav);

    // Date navigation, deliberately NOT a pager: these step the visible range
    // of REAL sessions, and the Education list routes declare no page or limit
    // to page through. The labels say "earlier" and "later" so nothing on this
    // page can be mistaken for a pagination control.
    var prev = el('button', 'edu-btn edu-btn-outline edu-btn-sm', icon('left', 'edu-icon-sm'));
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Earlier range');
    prev.addEventListener('click', function () { shiftCalendar(-1); });
    nav.appendChild(prev);

    var next = el('button', 'edu-btn edu-btn-outline edu-btn-sm', icon('right', 'edu-icon-sm'));
    next.type = 'button';
    next.setAttribute('aria-label', 'Later range');
    next.addEventListener('click', function () { shiftCalendar(1); });
    nav.appendChild(next);

    var anchorId = 'edu-calendar-anchor';
    var anchorLabel = el('label', null, 'Date');
    anchorLabel.setAttribute('for', anchorId);
    var anchorGroup = el('div', 'edu-filter');
    anchorGroup.appendChild(anchorLabel);
    var anchorInput = el('input', 'edu-input');
    anchorInput.id = anchorId;
    anchorInput.type = 'date';
    anchorInput.dir = 'ltr';
    anchorInput.value = isDay(state.calendarAnchor) ? state.calendarAnchor : today();
    state.calendarAnchor = anchorInput.value;
    anchorGroup.appendChild(anchorInput);
    nav.appendChild(anchorGroup);

    var todayBtn = el('button', 'edu-btn edu-btn-outline edu-btn-sm', '<span>Today</span>');
    todayBtn.type = 'button';
    todayBtn.addEventListener('click', function () {
      state.calendarAnchor = today();
      go('calendar');
    });
    nav.appendChild(todayBtn);

    anchorInput.addEventListener('change', function () {
      if (!isDay(anchorInput.value)) return;
      state.calendarAnchor = anchorInput.value;
      go('calendar');
    });

    var host = el('div', 'edu-card');
    host.id = 'edu-calendar-body';
    body.appendChild(host);
    host.appendChild(loadingBlock());

    var range = calendarRange(state.calendarMode, state.calendarAnchor);
    Promise.all([loadRef('classes'), loadRef('teachers'), api(
      'GET',
      '/scheduling?dateFrom=' + encodeURIComponent(range.from) + '&dateTo=' + encodeURIComponent(range.to)
    )]).then(function (results) {
      if (state.page !== 'calendar') return;
      var sessions = Array.isArray(results[2]) ? results[2] : [];
      paintCalendar(host, sessions, range);
    }, function (err) {
      if (state.page !== 'calendar') return;
      host.textContent = '';
      host.appendChild(banner('error', explain(err)));
    });
  }

  function shiftCalendar(direction) {
    var step = state.calendarMode === 'day' ? 1 : (state.calendarMode === 'week' ? 7 : 28);
    state.calendarAnchor = addDays(isDay(state.calendarAnchor) ? state.calendarAnchor : today(), direction * step);
    go('calendar');
  }

  function paintCalendar(host, sessions, range) {
    host.textContent = '';
    host.appendChild(el('p', 'edu-card-sub',
      sessions.length + (sessions.length === 1 ? ' session' : ' sessions') + ' between ' +
      range.from + ' and ' + range.to + '.'));

    if (!sessions.length) {
      host.appendChild(stateBlock('empty', 'No sessions are scheduled in this range.'));
      return;
    }

    var byDay = {};
    sessions.forEach(function (session) {
      var key = String(session.scheduledDate || '');
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(session);
    });

    if (state.calendarMode === 'day') {
      host.appendChild(dayHeading(range.from));
      host.appendChild(sessionList(byDay[range.from] || []));
      return;
    }

    if (state.calendarMode === 'agenda') {
      var agenda = el('div');
      Object.keys(byDay).sort().forEach(function (day) {
        agenda.appendChild(dayHeading(day));
        agenda.appendChild(sessionList(byDay[day]));
      });
      host.appendChild(agenda);
      return;
    }

    var grid = el('div', 'edu-week');
    for (var i = 0; i < 7; i++) {
      var day = addDays(range.from, i);
      var column = el('div', 'edu-week-day');
      column.appendChild(dayHeading(day));
      column.appendChild(sessionList(byDay[day] || []));
      grid.appendChild(column);
    }
    host.appendChild(grid);
  }

  function dayHeading(day) {
    var node = el('div', 'edu-day-head');
    node.appendChild(el('span', 'edu-day-weekday', esc(weekdayOf(day))));
    node.appendChild(el('span', 'edu-day-date', esc(day)));
    return node;
  }

  function sessionList(sessions) {
    if (!sessions.length) return el('p', 'edu-day-empty', 'No sessions');
    var list = el('ul', 'edu-session-list');
    sessions.forEach(function (session) {
      var li = document.createElement('li');
      li.className = 'edu-session';
      li.innerHTML =
        '<span class="edu-session-time edu-mono">' +
        esc(str(session.startTime) + ' – ' + str(session.endTime)) + '</span>' +
        '<span class="edu-session-class">' + esc(refLabel('classes', session.classId)) + '</span>' +
        '<span class="edu-session-teacher">' + esc(refLabel('teachers', teacherOfClass(session.classId))) + '</span>' +
        (session.notes ? '<span class="edu-session-notes">' + esc(session.notes) + '</span>' : '');
      list.appendChild(li);
    });
    return list;
  }

  // ---------------------------------------------------------------------
  // Education pack settings.
  //
  // Exactly the three fields `PUT /pack` already accepts as strings:
  // `academicYear`, `timezone` and `currency`. Nothing is added, nothing is
  // renamed, and the screen is not a settings framework: there is no section
  // list, no toggle, and no field the service would refuse.
  // ---------------------------------------------------------------------

  var PACK_FIELDS = [
    { name: 'academicYear', label: 'Academic Year', hint: 'Free text, exactly as the Education service stores it.' },
    { name: 'timezone', label: 'Timezone', hint: 'IANA time zone, for example Africa/Cairo.' },
    { name: 'currency', label: 'Currency', hint: 'Free text, for example EGP. The service defines no currency list.' }
  ];

  function renderPackSettings(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Education settings'));
    body.appendChild(el('p', 'edu-card-sub',
      'These are the only three settings the Education service accepts. They are tenant ' +
      'scoped, saved through the existing pack endpoint, and nothing else about the section ' +
      'is configurable here.'));

    var host = el('div', 'edu-card');
    host.id = 'edu-pack-body';
    body.appendChild(host);
    host.appendChild(loadingBlock());

    api('GET', '/pack').then(function (pack) {
      if (state.page !== 'settings') return;
      state.pack = pack || {};
      paintPackSettings(host);
    }, function (err) {
      if (state.page !== 'settings') return;
      host.textContent = '';
      host.appendChild(banner('error', explain(err), function () { go('settings'); }));
    });
  }

  function paintPackSettings(host) {
    host.textContent = '';
    var pack = state.pack || {};

    var status = el('p', 'edu-pack-status');
    status.id = 'edu-pack-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    host.appendChild(status);

    var form = el('form', 'edu-form-grid');
    form.id = 'edu-pack-form';
    form.noValidate = true;

    PACK_FIELDS.forEach(function (field) {
      var wrap = el('div', 'edu-field');
      var id = 'edu-pack-' + field.name;
      var label = el('label', null, esc(field.label));
      label.setAttribute('for', id);
      wrap.appendChild(label);
      var input = el('input', 'edu-input');
      input.id = id;
      input.type = 'text';
      // No maxlength: the service accepts any string and trims it, so the page
      // must not refuse a value the service would have stored.
      input.value = str(pack[field.name]);
      input.setAttribute('data-pack-field', field.name);
      wrap.appendChild(input);
      wrap.appendChild(el('span', 'edu-field-hint', esc(field.hint)));
      form.appendChild(wrap);
    });
    host.appendChild(form);

    var actions = el('div', 'edu-actions');
    var save = el('button', 'edu-btn edu-btn-primary', '<span>Save settings</span>');
    save.type = 'submit';
    save.form = 'edu-pack-form';
    save.id = 'edu-pack-save';
    actions.appendChild(save);
    var refresh = el('button', 'edu-btn edu-btn-outline', icon('refresh') + '<span>Refresh</span>');
    refresh.type = 'button';
    refresh.addEventListener('click', function () { go('settings'); });
    actions.appendChild(refresh);
    host.appendChild(actions);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var payload = {};
      var invalid = null;
      PACK_FIELDS.forEach(function (field) {
        var control = form.querySelector('[data-pack-field="' + field.name + '"]');
        if (!control) return;
        if (control.value !== null && typeof control.value !== 'string') {
          invalid = invalid || field.label + ' must be text.';
          return;
        }
        payload[field.name] = String(control.value || '').trim();
      });
      if (invalid) {
        status.textContent = invalid;
        status.className = 'edu-pack-status is-error';
        return;
      }

      save.disabled = true;
      status.textContent = 'Saving…';
      status.className = 'edu-pack-status';

      api('PUT', '/pack', payload).then(function (saved) {
        if (state.page !== 'settings') return;
        state.pack = saved || {};
        save.disabled = false;
        // The controls are updated IN PLACE from the saved record rather than
        // re-rendered, so the success message the user just earned is not
        // replaced by a fresh form. The server trims, so the trimmed value is
        // what is shown: the screen never displays something the service did
        // not actually store.
        PACK_FIELDS.forEach(function (field) {
          var control = form.querySelector('[data-pack-field="' + field.name + '"]');
          if (control) control.value = str((saved || {})[field.name]);
        });
        status.textContent = 'Settings saved.';
        status.className = 'edu-pack-status is-saved';
        toast('Settings saved.');
      }, function (err) {
        if (state.page !== 'settings') return;
        save.disabled = false;
        status.textContent = explain(err);
        status.className = 'edu-pack-status is-error';
        toast(explain(err), true);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Workspaces.
  //
  // The backend links an authenticated user to neither a Teacher nor a
  // Student, so neither workspace may pretend to know who is signed in. Both
  // are explicit tenant-level pickers, and both say so on screen.
  // ---------------------------------------------------------------------

  function renderTeacherWorkspace(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Teacher workspace'));
    body.appendChild(banner('info',
      'The Education service does not link your signed-in account to a teacher record, ' +
      'so this view is scoped by an explicit teacher selection rather than pretending ' +
      'to know who you are.'));

    var picker = el('div', 'edu-filters');
    body.appendChild(picker);

    var group = el('div', 'edu-filter');
    var label = el('label', null, 'Teacher');
    label.setAttribute('for', 'edu-teacher-picker');
    group.appendChild(label);
    var select = el('select', 'edu-select');
    select.id = 'edu-teacher-picker';
    group.appendChild(select);
    picker.appendChild(group);

    var host = el('div', 'edu-card');
    host.id = 'edu-teacher-detail';
    body.appendChild(host);
    host.appendChild(loadingBlock());

    loadRef('teachers').then(function (teachers) {
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose a teacher';
      select.appendChild(blank);
      teachers.forEach(function (teacher) {
        var opt = document.createElement('option');
        opt.value = String(teacher.id || '');
        opt.textContent = refName('teachers', teacher) + (teacher.teacherCode ? ' (' + teacher.teacherCode + ')' : '');
        select.appendChild(opt);
      });
      select.addEventListener('change', function () {
        paintTeacherDetail(host, select.value);
      });
      if (teachers.length) {
        select.value = String(teachers[0].id || '');
        paintTeacherDetail(host, select.value);
      } else {
        host.textContent = '';
        host.appendChild(stateBlock('empty', 'No teacher records in this tenant yet.'));
      }
    }, function (err) {
      host.textContent = '';
      host.appendChild(banner('error', explain(err)));
    });
  }

  function paintTeacherDetail(host, teacherId) {
    if (!teacherId) {
      host.textContent = '';
      host.appendChild(stateBlock('empty', 'Choose a teacher to see their classes and sessions.'));
      return;
    }
    host.textContent = '';
    host.appendChild(loadingBlock());

    Promise.all([
      api('GET', '/classes?teacherId=' + encodeURIComponent(teacherId)),
      loadRef('courses')
    ]).then(function (results) {
      var classes = Array.isArray(results[0]) ? results[0] : [];
      host.textContent = '';
      host.appendChild(el('h2', null, 'Classes'));
      host.appendChild(el('p', 'edu-card-sub', classes.length + ' class(es) assigned to this teacher.'));
      if (!classes.length) {
        host.appendChild(stateBlock('empty', 'This teacher has no classes yet.'));
      } else {
        var list = el('ul', 'edu-ref-list');
        classes.forEach(function (klass) {
          var li = document.createElement('li');
          li.innerHTML = pill(klass.status) + ' <strong>' + esc(refName('classes', klass)) + '</strong> ' +
            code(klass.classCode) + ' <span>' + esc(refLabel('courses', klass.courseId)) + '</span>';
          list.appendChild(li);
        });
        host.appendChild(list);
      }

      var classIds = classes.map(function (klass) { return String(klass.id || ''); });
      if (!classIds.length) return null;
      return Promise.all(classIds.map(function (id) {
        return api('GET', '/scheduling?classId=' + encodeURIComponent(id));
      }));
    }).then(function (batches) {
      if (!batches || state.page !== 'teacher') return;
      var sessions = [];
      batches.forEach(function (batch) {
        if (Array.isArray(batch)) sessions = sessions.concat(batch);
      });
      sessions.sort(function (a, b) {
        var left = String(a.scheduledDate || '') + String(a.startTime || '');
        var right = String(b.scheduledDate || '') + String(b.startTime || '');
        return left < right ? -1 : (left > right ? 1 : 0);
      });

      host.appendChild(el('h2', 'edu-section-title', 'Sessions'));
      host.appendChild(el('p', 'edu-card-sub', sessions.length + ' session(s) across the selected teacher’s classes.'));
      if (!sessions.length) {
        host.appendChild(stateBlock('empty', 'No sessions scheduled for these classes.'));
        return;
      }
      var wrap = el('div', 'edu-table-wrap');
      var table = el('table', 'edu-table');
      table.innerHTML = '<thead><tr><th scope="col">Class</th><th scope="col">Date</th>' +
        '<th scope="col">Time</th><th scope="col">Notes</th></tr></thead>';
      var tbody = document.createElement('tbody');
      sessions.forEach(function (session) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + text(refLabel('classes', session.classId)) + '</td>' +
          '<td>' + code(session.scheduledDate) + '</td>' +
          '<td>' + code(String(session.startTime || '') + ' – ' + String(r.endTime || '')) + '</td>' +
          '<td>' + text(session.notes) + '</td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      host.appendChild(wrap);
    }).catch(function (err) {
      host.textContent = '';
      host.appendChild(banner('error', explain(err)));
    });
  }

  function renderStudentWorkspace(body) {
    body.appendChild(el('h2', 'edu-section-title', 'Student workspace'));
    body.appendChild(banner('info',
      'The Education service does not link your signed-in account to a student record, ' +
      'so this view is scoped by an explicit student selection rather than pretending ' +
      'to know who you are.'));

    var picker = el('div', 'edu-filters');
    body.appendChild(picker);

    var group = el('div', 'edu-filter');
    var label = el('label', null, 'Student');
    label.setAttribute('for', 'edu-student-picker');
    group.appendChild(label);
    var select = el('select', 'edu-select');
    select.id = 'edu-student-picker';
    group.appendChild(select);
    picker.appendChild(group);

    var host = el('div', 'edu-card');
    host.id = 'edu-student-detail';
    body.appendChild(host);
    host.appendChild(loadingBlock());

    loadRef('students').then(function (students) {
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose a student';
      select.appendChild(blank);
      students.forEach(function (student) {
        var opt = document.createElement('option');
        opt.value = String(student.id || '');
        opt.textContent = refName('students', student) + (student.studentCode ? ' (' + student.studentCode + ')' : '');
        select.appendChild(opt);
      });
      select.addEventListener('change', function () {
        paintStudentDetail(host, select.value);
      });
      if (students.length) {
        select.value = String(students[0].id || '');
        paintStudentDetail(host, select.value);
      } else {
        host.textContent = '';
        host.appendChild(stateBlock('empty', 'No student records in this tenant yet.'));
      }
    }, function (err) {
      host.textContent = '';
      host.appendChild(banner('error', explain(err)));
    });
  }

  function paintStudentDetail(host, studentId) {
    if (!studentId) {
      host.textContent = '';
      host.appendChild(stateBlock('empty', 'Choose a student to see their enrollments and records.'));
      return;
    }
    host.textContent = '';
    host.appendChild(loadingBlock());

    Promise.all([
      loadRef('classes'),
      loadRef('enrollments'),
      api('GET', '/enrollments?studentId=' + encodeURIComponent(studentId))
    ]).then(function (results) {
      var enrollments = Array.isArray(results[2]) ? results[2] : [];
      var attendance = [];
      var grading = [];

      host.textContent = '';
      host.appendChild(el('h2', null, 'Enrollments'));
      host.appendChild(el('p', 'edu-card-sub', enrollments.length + ' enrollment(s) for this student.'));
      if (!enrollments.length) {
        host.appendChild(stateBlock('empty', 'This student has no enrollments.'));
      } else {
        var list = el('ul', 'edu-ref-list');
        enrollments.forEach(function (enrollment) {
          var li = document.createElement('li');
          li.innerHTML = pill(enrollment.status) + ' <strong>' + esc(refLabel('classes', enrollment.classId)) + '</strong> ' +
            code(enrollment.id) + (enrollment.withdrawnAt ? ' <span>withdrawn ' + esc(String(enrollment.withdrawnAt).slice(0, 10)) + '</span>' : '');
          list.appendChild(li);
        });
        host.appendChild(list);
      }

      var active = enrollments.filter(function (row) { return row.status === 'active'; });
      if (!active.length) return;

      return Promise.all([
        Promise.all(active.map(function (row) {
          return api('GET', '/attendance?enrollmentId=' + encodeURIComponent(String(row.id || '')));
        })),
        Promise.all(active.map(function (row) {
          return api('GET', '/grading?enrollmentId=' + encodeURIComponent(String(row.id || '')));
        }))
      ]).then(function (batches) {
        batches[0].forEach(function (batch) { if (Array.isArray(batch)) attendance = attendance.concat(batch); });
        batches[1].forEach(function (batch) { if (Array.isArray(batch)) grading = grading.concat(batch); });
      });
    }).then(function () {
      if (state.page !== 'student') return;
      var card = el('div', 'edu-card');
      card.appendChild(el('h2', 'edu-section-title', 'Attendance records'));
      card.appendChild(el('p', 'edu-card-sub',
        'The daily register for this student’s active enrollments, oldest first.'));
      card.appendChild(attendance.length
        ? simpleTable(
          ['Date', 'Class', 'Status', 'Notes'],
          attendance.map(function (row) {
            return [
              code(row.attendanceDate),
              text(refLabel('classes', classOfEnrollment(row.enrollmentId))),
              pill(row.status),
              text(row.notes)
            ];
          }))
        : stateBlock('empty', 'No attendance records for this student.'));
      host.appendChild(card);

      // Grading stays a plain register of recorded values. Nothing is summed,
      // averaged, ranked or otherwise compared.
      var gradeCard = el('div', 'edu-card');
      gradeCard.appendChild(el('h2', 'edu-section-title', 'Recorded grades'));
      gradeCard.appendChild(el('p', 'edu-card-sub',
        'Each recorded value exactly as staff typed it. The platform defines no scale, ' +
        'so no total or comparison is shown.'));
      gradeCard.appendChild(grading.length
        ? simpleTable(
          ['Date', 'Class', 'Grade', 'Notes'],
          grading.map(function (row) {
            return [
              code(row.gradingDate),
              text(refLabel('classes', classOfEnrollment(row.enrollmentId))),
              text(row.grade),
              text(row.notes)
            ];
          }))
        : stateBlock('empty', 'No grades recorded for this student.'));
      host.appendChild(gradeCard);
    }).catch(function (err) {
      host.textContent = '';
      host.appendChild(banner('error', explain(err)));
    });
  }

  function classOfEnrollment(enrollmentId) {
    var row = byEnrollment(enrollmentId);
    return row ? row.classId : '';
  }

  // A session stores only its class, and the teacher of a class is what the
  // calendar shows beside it. Same rule: resolved on demand, never copied.
  function teacherOfClass(classId) {
    var rows = REF.classes || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id || '') === String(classId || '')) return rows[i].teacherId;
    }
    return '';
  }

  function simpleTable(headers, rows) {
    var wrap = el('div', 'edu-table-wrap');
    var table = el('table', 'edu-table');
    var head = document.createElement('thead');
    var headRow = document.createElement('tr');
    headers.forEach(function (label) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = document.createElement('tbody');
    rows.forEach(function (cells) {
      var tr = document.createElement('tr');
      cells.forEach(function (value) {
        var td = document.createElement('td');
        td.innerHTML = value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  // ---------------------------------------------------------------------
  // Create / edit form.
  // ---------------------------------------------------------------------

  var editingRow = null;

  function openForm(spec, row) {
    var overlay = byId('edu-form-overlay');
    var form = byId('edu-form');
    var title = byId('edu-form-title');
    if (!overlay || !form) return;

    editingRow = row || null;
    var editing = !!editingRow;
    title.textContent = editing ? ('Edit ' + spec.title.replace(/s$/, '')) : spec.addLabel;
    form.textContent = '';

    var refFields = (spec.fields || []).filter(function (field) { return field.type === 'ref'; });
    Promise.all(refFields.map(function (field) { return loadRef(field.source); }))
      .then(function () { buildFields(form, spec, editingRow); }, function () { buildFields(form, spec, editingRow); });

    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    var first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  }

  function buildFields(form, spec, row) {
    form.textContent = '';
    var editing = !!row;

    (spec.fields || []).forEach(function (field) {
      // The parent relationship is accepted only on create; the services refuse
      // to change it afterwards, so the control is not even rendered on edit.
      if (editing && field.immutable) return;

      var wrap = el('div', 'edu-field');
      var inputId = 'edu-field-' + field.name;
      var label = el('label', null, esc(field.label) + (field.required ? ' *' : ''));
      label.setAttribute('for', inputId);
      wrap.appendChild(label);

      var control;
      var value = row ? row[field.name] : '';

      if (field.type === 'ref') {
        control = el('select', 'edu-select');
        control.id = inputId;
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '—';
        control.appendChild(blank);
        (REF[field.source] || []).forEach(function (option) {
          var opt = document.createElement('option');
          opt.value = String(option.id || '');
          if (field.source === 'enrollments') opt.textContent = enrollmentLabel(option);
          else opt.textContent = refName(field.source, option);
          if (String(value || '') === opt.value) opt.selected = true;
          control.appendChild(opt);
        });
      } else if (field.type === 'select') {
        control = el('select', 'edu-select');
        control.id = inputId;
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '—';
        control.appendChild(empty);
        (field.values || []).forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          if (String(value || '') === name) opt.selected = true;
          control.appendChild(opt);
        });
      } else if (field.type === 'textarea') {
        control = el('textarea', 'edu-textarea');
        control.id = inputId;
        control.value = value === undefined || value === null ? '' : String(value);
        control.maxLength = field.maxLength || MAX_STRING_LEN;
      } else {
        control = el('input', 'edu-input');
        control.id = inputId;
        control.type = field.type === 'date' || field.type === 'time' || field.type === 'number' || field.type === 'email'
          ? field.type : 'text';
        control.value = value === undefined || value === null ? '' : String(value);
        if (field.maxLength) control.maxLength = field.maxLength;
        if (field.type === 'date' || field.type === 'time' || field.type === 'number') control.dir = 'ltr';
        if (field.type === 'number') {
          if (field.min !== undefined) control.min = String(field.min);
          if (field.max !== undefined) control.max = String(field.max);
        }
        if (field.type === 'date') control.max = today();
      }

      if (field.required) control.setAttribute('required', 'required');
      control.setAttribute('data-field-name', field.name);
      wrap.appendChild(control);
      if (field.hint) wrap.appendChild(el('span', 'edu-field-hint', esc(field.hint)));
      form.appendChild(wrap);
    });

    // The services refuse a grading or attendance date in the future, so the
    // control is capped at today rather than letting the request fail.
    if (spec.key === 'grading' || spec.key === 'attendance') {
      var dateInput = form.querySelector('input[type="date"]');
      if (dateInput) dateInput.max = today();
    }
  }

  function closeForm() {
    var overlay = byId('edu-form-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  // Mirrors the server's own rules for the fields the page can check cheaply,
  // so an obviously invalid request is never sent. The server remains the only
  // authority: anything it rejects is surfaced verbatim.
  function validate(spec, payload, editing) {
    var errors = [];
    (spec.fields || []).forEach(function (field) {
      if (editing && field.immutable) return;
      var value = payload[field.name];
      if (field.required && (value === undefined || value === null || String(value).trim() === '')) {
        errors.push(field.label + ' is required');
        return;
      }
      if (value === undefined || value === null || String(value).trim() === '') return;
      if (field.maxLength && String(value).length > field.maxLength) {
        errors.push(field.label + ' must be at most ' + field.maxLength + ' characters');
      }
    });

    if (spec.key === 'scheduling') {
      var start = String(payload.startTime || '');
      var end = String(payload.endTime || '');
      if (start && end && start >= end) {
        errors.push('End Time must be after Start Time');
      }
    }

    if (spec.key === 'grading' || spec.key === 'attendance') {
      var fieldName = spec.key === 'grading' ? 'gradingDate' : 'attendanceDate';
      var day = String(payload[fieldName] || '').trim();
      if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        errors.push(fieldName + ' must be a date in YYYY-MM-DD format');
      } else if (day && day > today()) {
        errors.push(fieldName + ' cannot be in the future');
      }
    }

    return errors;
  }

  function collectPayload(form) {
    var payload = {};
    var controls = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      var name = control.getAttribute('data-field-name');
      if (!name) continue;
      var value = control.value;
      if (value === null || value === undefined || String(value).trim() === '') continue;
      payload[name] = value;
    }
    return payload;
  }

  function submitForm(spec, row) {
    var form = byId('edu-form');
    if (!form) return;
    var payload = collectPayload(form);
    var editing = !!row;
    var errors = validate(spec, payload, editing);
    if (errors.length) {
      toast(errors.join('; '), true);
      return;
    }

    var submit = byId('edu-form-submit');
    if (submit) submit.disabled = true;

    var request = editing
      ? api('PUT', spec.path + '/' + encodeURIComponent(String(row.id || '')), payload)
      : api('POST', spec.path, payload);

    request.then(function () {
      closeForm();
      toast(editing ? 'Saved.' : 'Created.');
      invalidateRef(spec.key);
      invalidateRef(null);
      loadPage(spec, true);
    }, function (err) {
      toast(explain(err), true);
    }).then(function () {
      if (submit) submit.disabled = false;
    });
  }

  // ---------------------------------------------------------------------
  // Archive / withdraw confirmation.
  // ---------------------------------------------------------------------

  function confirmAndRun(spec, row) {
    var overlay = byId('edu-confirm-overlay');
    var message = byId('edu-confirm-message');
    var label = spec.archivePath ? spec.archiveLabel : spec.withdrawLabel;
    if (!overlay || !message) return;

    var target = spec.key === 'enrollments'
      ? (enrollmentLabel(row) || row.id)
      : (refName(spec.key, row) || row.id);
    message.textContent = label + ' ' + target + '? This keeps the record and its history; it is never deleted.';

    var ok = byId('edu-confirm-ok');
    var cancel = byId('edu-confirm-cancel');
    var close = function () {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      if (ok) ok.onclick = null;
    };

    if (ok) {
      ok.onclick = function () {
        close();
        var suffix = spec.archivePath || spec.withdrawPath;
        api('PATCH', spec.path + '/' + encodeURIComponent(String(row.id || '')) + suffix).then(function () {
          toast(label + ' applied.');
          invalidateRef(spec.key);
          invalidateRef(null);
          loadPage(spec, true);
        }, function (err) {
          toast(explain(err), true);
        });
      };
    }
    if (cancel) cancel.onclick = close;

    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  // ---------------------------------------------------------------------
  // Drawer.
  // ---------------------------------------------------------------------

  function openDrawer() {
    var drawer = byId('edu-drawer');
    var overlay = byId('edu-overlay');
    var toggle = document.querySelector('.edu-hamburger');
    if (!drawer) return;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    if (overlay) overlay.classList.add('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    var drawer = byId('edu-drawer');
    var overlay = byId('edu-overlay');
    var toggle = document.querySelector('.edu-hamburger');
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (overlay) overlay.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------------
  // Boot.
  // ---------------------------------------------------------------------

  function go(page) {
    if (PAGES.indexOf(page) < 0) page = 'dashboard';
    if (window.location.hash !== '#' + page) {
      window.location.hash = '#' + page;
      return;
    }
    renderPage(page);
  }

  function pageFromHash() {
    var hash = String(window.location.hash || '').replace(/^#/, '');
    return PAGES.indexOf(hash) >= 0 ? hash : 'dashboard';
  }

  function boot() {
    // Navigation is delegated: the bottom bar and the drawer share one handler.
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document && node.nodeType === 1) {
        if (node.getAttribute && node.getAttribute('data-edu-page')) {
          event.preventDefault();
          go(node.getAttribute('data-edu-page'));
          return;
        }
        node = node.parentNode;
      }
    });

    var toggle = document.querySelector('.edu-hamburger');
    if (toggle) toggle.addEventListener('click', openDrawer);
    var overlay = byId('edu-overlay');
    if (overlay) overlay.addEventListener('click', closeDrawer);

    ['edu-form-close', 'edu-form-cancel'].forEach(function (id) {
      var node = byId(id);
      if (node) node.addEventListener('click', closeForm);
    });
    var formOverlay = byId('edu-form-overlay');
    if (formOverlay) {
      formOverlay.addEventListener('click', function (event) {
        if (event.target === formOverlay) closeForm();
      });
    }
    var confirmOverlay = byId('edu-confirm-overlay');
    if (confirmOverlay) {
      confirmOverlay.addEventListener('click', function (event) {
        if (event.target === confirmOverlay) {
          confirmOverlay.classList.remove('is-open');
          confirmOverlay.setAttribute('aria-hidden', 'true');
        }
      });
    }
    var closeConfirm = byId('edu-confirm-close');
    if (closeConfirm) {
      closeConfirm.addEventListener('click', function () {
        confirmOverlay.classList.remove('is-open');
        confirmOverlay.setAttribute('aria-hidden', 'true');
      });
    }

    var form = byId('edu-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var spec = entityFor(state.page);
        if (spec) submitForm(spec, editingRow);
      });
    }

    window.addEventListener('hashchange', function () {
      renderPage(pageFromHash());
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      closeForm();
      closeDrawer();
    });

    renderPage(pageFromHash());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
