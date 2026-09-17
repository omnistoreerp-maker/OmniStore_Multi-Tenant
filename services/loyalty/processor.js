'use strict';

// Loyalty queue processor.
// - Processes pending sync operations from the retry queue.
// - Runs on app load and periodically.
// - Never blocks the main UI.

function processLoyaltySyncQueue() {
  if (typeof loyaltySync !== 'undefined' && typeof loyaltySync.processSyncQueue === 'function') {
    try {
      loyaltySync.processSyncQueue();
    } catch (e) {
      console.warn('Loyalty sync queue processing failed:', e.message);
    }
  }
}

function scheduleLoyaltySyncQueueProcessing(delayMs) {
  if (typeof loyaltySyncQueue === 'undefined') return;
  const delay = delayMs || 30000;
  setTimeout(() => {
    processLoyaltySyncQueue();
    scheduleLoyaltySyncQueueProcessing(delay);
  }, delay);
}

// Process queue on app load (after DOM ready)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(processLoyaltySyncQueue, 2000);
    scheduleLoyaltySyncQueueProcessing(60000);
  });
} else {
  setTimeout(processLoyaltySyncQueue, 2000);
  scheduleLoyaltySyncQueueProcessing(60000);
}

// Process queue when app becomes visible again (user returns to tab)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    setTimeout(processLoyaltySyncQueue, 500);
  }
});

window.loyaltySyncProcessor = {
  processLoyaltySyncQueue,
  scheduleLoyaltySyncQueueProcessing
};
