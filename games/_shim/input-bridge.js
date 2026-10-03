/* OmniStore Games — sandboxed input bridge.
 *
 * Games run inside the portal player iframe, which is sandboxed WITHOUT
 * allow-same-origin (opaque origin, by design — the game can never read
 * OmniStore auth tokens, tenant data, admin APIs or platform secrets).
 *
 * Chromium routes key events for such frames to the TOP-LEVEL document even
 * after the frame is clicked and reports document.hasFocus() === true, so a
 * game that listens on its own document would never see a keystroke
 * (verified: click focuses the frame, ArrowLeft arrives at the parent only).
 * The portal therefore forwards its keystrokes with postMessage; this bridge
 * re-dispatches them inside the frame as real KeyboardEvents so the game's own
 * handler runs unchanged.
 *
 * Loaded as the SECOND script of every game page (right after
 * storage-shim.js). When the browser DOES deliver keys natively (the parent
 * then never sees them) nothing is forwarded, so there is no double input.
 * Only messages whose source is our own parent window and that carry the
 * magic token are accepted; no game data and no parent data is exchanged.
 */
(function () {
  'use strict';

  var MAGIC = '__omnistoreGamesInput';

  function dispatch(type, key, keyCode) {
    try {
      var init = {
        key: key || '',
        code: key || '',
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true
      };
      var event;
      try {
        event = new KeyboardEvent(type, init);
      } catch (e) {
        /* Very old engines: fall back to the legacy constructor. */
        event = document.createEvent('KeyboardEvent');
        event.initKeyboardEvent(type, true, true, window, key, 0, '', false, '');
      }
      document.dispatchEvent(event);
    } catch (e2) { /* never break the host game */ }
  }

  window.addEventListener('message', function (event) {
    /* Accept input only from our own embedder (the portal player). */
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data[MAGIC] !== true) return;
    if (typeof data.keyCode !== 'number') return;
    if (data.type === 'keydown' || data.type === 'keyup') {
      dispatch(data.type, data.key, data.keyCode);
    }
  });
})();
