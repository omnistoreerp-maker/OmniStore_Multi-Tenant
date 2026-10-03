// Education Center client. Talks only to /api/v1/tenant/education using the
// same auth convention as the rest of the platform pages: the access token
// lives in localStorage under `access_token` and is sent as a Bearer header.
// The tenant is resolved server-side from the signed token (tenantCarry) — it
// is never supplied from the client.
(function () {
  'use strict';

  var API = '/api/v1/tenant/education';

  function token() {
    try { return localStorage.getItem('access_token') || ''; } catch (_) { return ''; }
  }

  async function apiCall(method, path, body) {
    var headers = { Accept: 'application/json' };
    var t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var opts = { method: method, headers: headers };
    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(API + path, opts);
    var json = null;
    try { json = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((json && json.message) || ('HTTP ' + res.status));
    return json ? json.data : null;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'class') node.className = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function toast(message, isError) {
    var node = el('div', { class: 'toast' + (isError ? ' error' : ''), text: String(message) });
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 3500);
  }

  var content = document.getElementById('edu-content');
  var toolbar = document.getElementById('edu-toolbar');
  var tabsBar = document.getElementById('edu-tabs');
  var statsBar = document.getElementById('edu-stats');

  var TABS = [
    { id: 'centers', label: 'المراكز' },
    { id: 'teachers', label: 'المعلمون' },
    { id: 'students', label: 'الطلاب' },
    { id: 'courses', label: 'الدورات' },
    { id: 'lessons', label: 'الدروس' },
    { id: 'enrollments', label: 'التسجيلات' }
  ];
  var state = { tab: 'centers', centers: [], teachers: [], students: [], courses: [] };

  function setState(html) {
    if (typeof html === 'string') content.innerHTML = html;
    else { content.innerHTML = ''; content.appendChild(html); }
  }
  function stateText(msg, isError) {
    setState(el('div', { class: 'state' + (isError ? ' error' : ''), text: msg }));
  }
  function skeleton() {
    var wrap = el('div', { class: 'table-wrap' });
    for (var i = 0; i < 4; i++) wrap.appendChild(el('div', { class: 'skeleton', style: 'margin:8px 0' }));
    setState(wrap);
  }

  function renderTabs() {
    tabsBar.innerHTML = '';
    TABS.forEach(function (tab) {
      tabsBar.appendChild(el('button', {
        class: 'tab', type: 'button', role: 'tab',
        'aria-selected': state.tab === tab.id ? 'true' : 'false',
        text: tab.label,
        onclick: function () { state.tab = tab.id; renderTabs(); renderToolbar(); renderActive(); }
      }));
    });
  }

  async function loadDashboard() {
    try {
      var d = await apiCall('GET', '/dashboard');
      statsBar.innerHTML = '';
      [['المراكز', d.centers], ['المعلمون', d.teachers], ['الطلاب', d.students],
       ['الدورات', d.courses], ['المسجّلة', d.enrollments], ['تسجيلات نشطة', d.activeEnrollments]]
        .forEach(function (pair) {
          statsBar.appendChild(el('div', { class: 'stat' }, [
            el('div', { class: 'v', text: String(pair[1]) }),
            el('div', { class: 'l', text: pair[0] })
          ]));
        });
    } catch (err) {
      statsBar.innerHTML = '';
      statsBar.appendChild(el('div', { class: 'state error', text: 'تعذر تحميل الملخص: ' + err.message }));
    }
  }

  function badge(status) {
    var labels = {
      active: 'نشط', inactive: 'غير نشط', draft: 'مسودة', published: 'منشور',
      archived: 'مؤرشف', completed: 'مكتمل', cancelled: 'ملغي'
    };
    return el('span', { class: 'badge s-' + status, text: labels[status] || status });
  }

  function table(headers, rows) {
    var thead = el('tr', null, headers.map(function (h) { return el('th', { text: h }); }));
    var tbody = el('tbody', null, rows.map(function (cells) {
      return el('tr', null, cells.map(function (c) {
        return el('td', null, [typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c]);
      }));
    }));
    return el('div', { class: 'table-wrap' }, [el('table', null, [el('thead', null, [thead]), tbody])]);
  }

  function select(id, options, placeholder) {
    var s = el('select', { id: id });
    s.appendChild(el('option', { value: '', text: placeholder || '— اختر —' }));
    options.forEach(function (o) { s.appendChild(el('option', { value: o.value, text: o.label })); });
    return s;
  }
  function input(id, placeholder, type) {
    return el('input', { id: id, placeholder: placeholder || '', type: type || 'text' });
  }
  function btn(label, primary, onClick) {
    return el('button', { class: 'btn ' + (primary ? 'btn-primary' : 'btn-outline'), type: 'button', text: label, onclick: onClick });
  }

  async function loadRefs() {
    var results = await Promise.all([
      apiCall('GET', '/centers?limit=200'),
      apiCall('GET', '/teachers?limit=200'),
      apiCall('GET', '/students?limit=200'),
      apiCall('GET', '/courses?limit=200')
    ]);
    state.centers = results[0].items;
    state.teachers = results[1].items;
    state.students = results[2].items;
    state.courses = results[3].items;
  }

  function opt(list, labelKey) {
    return list.map(function (r) { return { value: r.id, label: r[labelKey] }; });
  }

  async function refresh() {
    try {
      await loadRefs();
    } catch (err) {
      stateText('تعذر تحميل البيانات: ' + err.message, true);
      return;
    }
    renderToolbar();
    renderActive();
    loadDashboard();
  }

  function addButton(label, payload, clearIds) {
    return btn(label, true, async function () {
      try {
        await apiCall('POST', currentAddPath(), payload());
        (clearIds || []).forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ''; });
        toast('تم الحفظ');
        await refresh();
      } catch (err) { toast(err.message, true); }
    });
  }

  function currentAddPath() {
    return { centers: '/centers', teachers: '/teachers', students: '/students', courses: '/courses', lessons: '/lessons', enrollments: '/enrollments' }[state.tab];
  }

  function fieldValue(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

  function renderToolbar() {
    toolbar.innerHTML = '';
    if (state.tab === 'centers') {
      toolbar.appendChild(input('f-center-name', 'اسم المركز'));
      toolbar.appendChild(input('f-center-phone', 'هاتف التواصل'));
      toolbar.appendChild(addButton('إضافة مركز', function () {
        return { name: fieldValue('f-center-name'), contactPhone: fieldValue('f-center-phone') };
      }, ['f-center-name', 'f-center-phone']));
    } else if (state.tab === 'teachers') {
      toolbar.appendChild(input('f-teacher-name', 'اسم المعلم'));
      toolbar.appendChild(select('f-teacher-center', opt(state.centers, 'name'), 'بدون مركز'));
      toolbar.appendChild(addButton('إضافة معلم', function () {
        return { displayName: fieldValue('f-teacher-name'), centerId: fieldValue('f-teacher-center') || null };
      }, ['f-teacher-name']));
    } else if (state.tab === 'students') {
      toolbar.appendChild(input('f-student-name', 'اسم الطالب'));
      toolbar.appendChild(input('f-student-grade', 'الصف'));
      toolbar.appendChild(select('f-student-center', opt(state.centers, 'name'), 'بدون مركز'));
      toolbar.appendChild(addButton('إضافة طالب', function () {
        return { displayName: fieldValue('f-student-name'), grade: fieldValue('f-student-grade'), centerId: fieldValue('f-student-center') || null };
      }, ['f-student-name', 'f-student-grade']));
    } else if (state.tab === 'courses') {
      toolbar.appendChild(input('f-course-title', 'عنوان الدورة'));
      toolbar.appendChild(select('f-course-center', opt(state.centers, 'name'), 'اختر المركز'));
      toolbar.appendChild(select('f-course-teacher', opt(state.teachers, 'displayName'), 'بدون معلم'));
      toolbar.appendChild(addButton('إضافة دورة', function () {
        return { title: fieldValue('f-course-title'), centerId: fieldValue('f-course-center'), teacherId: fieldValue('f-course-teacher') || null };
      }, ['f-course-title']));
    } else if (state.tab === 'lessons') {
      var courseSel = select('f-lesson-course', opt(state.courses, 'title'), 'اختر الدورة');
      courseSel.value = state.lessonCourseId || '';
      courseSel.addEventListener('change', function () { state.lessonCourseId = courseSel.value; renderActive(); });
      toolbar.appendChild(courseSel);
      toolbar.appendChild(input('f-lesson-title', 'عنوان الدرس'));
      toolbar.appendChild(addButton('إضافة درس', function () {
        return { courseId: fieldValue('f-lesson-course'), title: fieldValue('f-lesson-title') };
      }, ['f-lesson-title']));
    } else if (state.tab === 'enrollments') {
      toolbar.appendChild(select('f-enr-course', opt(state.courses, 'title'), 'اختر الدورة'));
      toolbar.appendChild(select('f-enr-student', opt(state.students, 'displayName'), 'اختر الطالب'));
      toolbar.appendChild(addButton('تسجيل طالب', function () {
        return { courseId: fieldValue('f-enr-course'), studentId: fieldValue('f-enr-student') };
      }, []));
    }
  }

  function renderActive() {
    if (state.tab === 'centers') return renderCenters();
    if (state.tab === 'teachers') return renderTeachers();
    if (state.tab === 'students') return renderStudents();
    if (state.tab === 'courses') return renderCourses();
    if (state.tab === 'lessons') return renderLessons();
    return renderEnrollments();
  }

  function renderCenters() {
    if (!state.centers.length) return stateText('لا توجد مراكز بعد. أضف أول مركز.');
    setState(table(['الاسم', 'الهاتف', 'المواد', 'الحالة'], state.centers.map(function (c) {
      return [c.name, c.contactPhone || '—', (c.subjects || []).join('، ') || '—', badge(c.status)];
    })));
  }

  function renderTeachers() {
    if (!state.teachers.length) return stateText('لا يوجد معلمون بعد. أضف أول معلم.');
    var byId = {}; state.centers.forEach(function (c) { byId[c.id] = c.name; });
    setState(table(['الاسم', 'المركز', 'المواد', 'الحالة'], state.teachers.map(function (t) {
      return [t.displayName, byId[t.centerId] || '—', (t.subjects || []).join('، ') || '—', badge(t.status)];
    })));
  }

  function renderStudents() {
    if (!state.students.length) return stateText('لا يوجد طلاب بعد. أضف أول طالب.');
    var byId = {}; state.centers.forEach(function (c) { byId[c.id] = c.name; });
    setState(table(['الاسم', 'الصف', 'المركز', 'الحالة'], state.students.map(function (s) {
      return [s.displayName, s.grade || '—', byId[s.centerId] || '—', badge(s.status)];
    })));
  }

  function renderCourses() {
    if (!state.courses.length) return stateText('لا توجد دورات بعد. أضف أول دورة.');
    var centersById = {}; state.centers.forEach(function (c) { centersById[c.id] = c.name; });
    var teachersById = {}; state.teachers.forEach(function (t) { teachersById[t.id] = t.displayName; });
    setState(table(['العنوان', 'المركز', 'المعلم', 'الحالة', 'إجراء'], state.courses.map(function (c) {
      var next = c.status === 'published' ? 'draft' : 'published';
      var action = btn(c.status === 'published' ? 'إلغاء النشر' : 'نشر', false, async function () {
        try { await apiCall('PATCH', '/courses/' + c.id, { status: next }); toast('تم التحديث'); await refresh(); }
        catch (err) { toast(err.message, true); }
      });
      return [c.title, centersById[c.centerId] || '—', teachersById[c.teacherId] || '—', badge(c.status), action];
    })));
  }

  function renderLessons() {
    var courseId = state.lessonCourseId || (state.courses[0] && state.courses[0].id);
    if (!courseId) return stateText('أضف دورة أولاً لعرض دروسها.');
    state.lessonCourseId = courseId;
    var sel = document.getElementById('f-lesson-course');
    if (sel) sel.value = courseId;
    skeleton();
    apiCall('GET', '/courses/' + courseId + '/lessons').then(function (lessons) {
      if (!lessons.length) return stateText('لا توجد دروس في هذه الدورة بعد.');
      setState(table(['#', 'العنوان', 'الحالة', 'إجراء'], lessons.map(function (l) {
        var next = l.status === 'published' ? 'draft' : 'published';
        var action = btn(l.status === 'published' ? 'إلغاء النشر' : 'نشر', false, async function () {
          try { await apiCall('PATCH', '/lessons/' + l.id, { status: next }); toast('تم التحديث'); renderLessons(); }
          catch (err) { toast(err.message, true); }
        });
        return [l.order, l.title, badge(l.status), action];
      })));
    }).catch(function (err) { stateText('تعذر تحميل الدروس: ' + err.message, true); });
  }

  function renderEnrollments() {
    skeleton();
    apiCall('GET', '/enrollments?limit=200').then(function (data) {
      if (!data.items.length) return stateText('لا توجد تسجيلات بعد.');
      var coursesById = {}; state.courses.forEach(function (c) { coursesById[c.id] = c.title; });
      var studentsById = {}; state.students.forEach(function (s) { studentsById[s.id] = s.displayName; });
      setState(table(['الطالب', 'الدورة', 'الحالة', 'إجراءات'], data.items.map(function (e) {
        var actions = el('div', { class: 'toolbar' });
        actions.appendChild(btn('المتابعة', false, function () { openProgress(e.id); }));
        if (e.status === 'active') {
          actions.appendChild(btn('إكمال', false, async function () {
            try { await apiCall('PATCH', '/enrollments/' + e.id + '/status', { status: 'completed' }); toast('تم'); refresh(); }
            catch (err) { toast(err.message, true); }
          }));
        }
        if (e.status !== 'cancelled') {
          actions.appendChild(btn('إلغاء', false, async function () {
            try { await apiCall('PATCH', '/enrollments/' + e.id + '/status', { status: 'cancelled' }); toast('تم'); refresh(); }
            catch (err) { toast(err.message, true); }
          }));
        }
        return [studentsById[e.studentId] || '—', coursesById[e.courseId] || '—', badge(e.status), actions];
      })));
    }).catch(function (err) { stateText('تعذر تحميل التسجيلات: ' + err.message, true); });
  }

  async function openProgress(enrollmentId) {
    skeleton();
    try {
      var p = await apiCall('GET', '/enrollments/' + enrollmentId + '/progress');
      var wrap = el('div');
      wrap.appendChild(el('h3', { text: 'نسبة الإنجاز: ' + p.percentage + '% (' + p.completedLessons + '/' + p.totalLessons + ')' }));
      var bar = el('div', { style: 'height:10px;border-radius:999px;background:rgba(15,23,42,.08);overflow:hidden;margin:8px 0 14px' });
      bar.appendChild(el('div', { style: 'height:100%;width:' + p.percentage + '%;background:linear-gradient(135deg,#6366f1,#8b5cf6)' }));
      wrap.appendChild(bar);
      wrap.appendChild(btn('رجوع للتسجيلات', false, function () { renderEnrollments(); }));
      if (!p.lessons.length) {
        wrap.appendChild(el('div', { class: 'state', text: 'لا توجد دروس في هذه الدورة.' }));
      } else {
        wrap.appendChild(table(['الدرس', 'مكتمل'], p.lessons.map(function (l) {
          var toggle = el('input', { type: 'checkbox', 'aria-label': l.title });
          toggle.checked = l.completed;
          toggle.addEventListener('change', async function () {
            try {
              await apiCall('POST', '/progress/lesson', { enrollmentId: enrollmentId, lessonId: l.lessonId, completed: toggle.checked });
              toast('تم حفظ التقدم'); openProgress(enrollmentId);
            } catch (err) { toast(err.message, true); toggle.checked = !toggle.checked; }
          });
          return [l.title, toggle];
        })));
      }
      setState(wrap);
    } catch (err) { stateText('تعذر تحميل التقدم: ' + err.message, true); }
  }

  function boot() {
    if (!token()) document.getElementById('edu-auth-note').classList.remove('hidden');
    renderTabs();
    skeleton();
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }


})();
