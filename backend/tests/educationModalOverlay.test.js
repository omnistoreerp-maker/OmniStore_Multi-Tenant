'use strict';

// Education modal visibility — regression guard.
//
// Visibility in index.html is owned by the overlay wrapper:
//   .modal-overlay      { display:none; ... }
//   .modal-overlay.show { display:flex; }
// and openModal()/closeModal() only toggle the `show` class. `.modal` itself
// carries no display declaration.
//
// The four Education dialogs (center, teacher, student, enrollment) were
// declared as bare `<div class="modal" id="education*Modal">` directly on
// <body>, unlike every other dialog in the app. A bare `.modal` therefore
// inherits `display:block` from load, and toggling `show` cannot hide it — in
// production all four forms painted over the login screen on every
// unauthenticated page load, hiding the sign-in form.
//
// This suite pins the overlay contract so the defect cannot come back.
// It reads source only; it never mutates runtime data.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const EDUCATION_MODALS = [
  'educationCenterModal',
  'educationTeacherModal',
  'educationStudentModal',
  'educationEnrollmentModal'
];

// All .modal{...} rule bodies. The regex deliberately requires `{` right
// after `modal` so `.modal-overlay`, `.modal-lg` and selector lists are skipped.
function modalRuleBodies(html) {
  const bodies = [];
  const re = /\.modal\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(html)) !== null) bodies.push(m[1]);
  return bodies;
}

describe('Education modals are hidden by the modal overlay contract', () => {
  test('no bare .modal element carries an id (every dialog is an overlay)', () => {
    const bare = [];
    const re = /<div class="modal" id="([^"]+)">/g;
    let m;
    while ((m = re.exec(HTML)) !== null) bare.push(m[1]);
    expect(bare).toEqual([]);
  });

  test.each(EDUCATION_MODALS)('%s is declared on a .modal-overlay', (id) => {
    expect(HTML).toContain(`<div class="modal-overlay" id="${id}"><div class="modal">`);
    expect(HTML).not.toContain(`<div class="modal" id="${id}">`);
  });

  test('every openModal/closeModal target of an Education dialog is an overlay', () => {
    EDUCATION_MODALS.forEach((id) => {
      expect(HTML).toContain(`openModal('${id}')`);
      expect(HTML).toContain(`closeModal('${id}')`);
    });
  });

  test('.modal never declares display, so only the overlay can hide it', () => {
    const bodies = modalRuleBodies(HTML);
    expect(bodies.length).toBeGreaterThan(0);
    bodies.forEach((body) => {
      expect(body).not.toMatch(/(^|;)\s*display\s*:/);
    });
  });

  test('the overlay contract itself is intact', () => {
    expect(HTML).toMatch(/\.modal-overlay\s*\{[^}]*display\s*:\s*none/);
    expect(HTML).toMatch(/\.modal-overlay\.show\s*\{[^}]*display\s*:\s*flex/);
  });
});
