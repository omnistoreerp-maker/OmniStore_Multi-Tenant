'use strict';

// Loyalty read-only sync foundation.
// - Fetches backend loyalty data for a customer.
// - Does NOT modify localStorage.
// - Does NOT call POS mutation APIs.
// - Backend failure is non-destructive.

const backendApi = window.backendApi || {};
const DB = (() => {
  try { return window.DB || {}; } catch (e) { return {}; }
})();

const REMOTE_STATE_KEY = 'digitronics_loyalty_remote_state_v1';

function loadRemoteState() {
  try {
    const raw = localStorage.getItem(REMOTE_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveRemoteState(state) {
  try {
    localStorage.setItem(REMOTE_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    // ignore storage errors
  }
}

function createRemoteState(customerId) {
  return {
    customerId: String(customerId || ''),
    remotePoints: null,
    remoteTransactions: [],
    remoteBalanceFetchedAt: null,
    remoteConfig: null,
    status: 'unknown',
    error: null
  };
}

async function fetchBackendBalance(customerId) {
  if (!backendApi.loyalty || !backendApi.loyalty.getBalance) {
    return { ok: false, error: 'backendApi.loyalty.getBalance unavailable' };
  }
  try {
    const res = await backendApi.loyalty.getBalance(customerId);
    if (!res || !res.success) {
      return { ok: false, error: (res && res.message) || 'Failed to fetch balance' };
    }
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Network error' };
  }
}

async function fetchBackendTransactions(customerId, query) {
  if (!backendApi.loyalty || !backendApi.loyalty.getTransactions) {
    return { ok: false, error: 'backendApi.loyalty.getTransactions unavailable' };
  }
  try {
    const res = await backendApi.loyalty.getTransactions(customerId, query);
    if (!res || !res.success) {
      return { ok: false, error: (res && res.message) || 'Failed to fetch transactions' };
    }
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Network error' };
  }
}

async function fetchBackendConfig() {
  if (!backendApi.loyalty || !backendApi.loyalty.getConfig) {
    return { ok: false, error: 'backendApi.loyalty.getConfig unavailable' };
  }
  try {
    const res = await backendApi.loyalty.getConfig();
    if (!res || !res.success) {
      return { ok: false, error: (res && res.message) || 'Failed to fetch config' };
    }
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Network error' };
  }
}

async function syncCustomer(customerId) {
  const id = String(customerId || '');
  if (!id) return { status: 'error', error: 'customerId is required' };

  let state = loadRemoteState();
  if (!state || state.customerId !== id) {
    state = createRemoteState(id);
  }

  const balanceResult = await fetchBackendBalance(id);
  if (balanceResult.ok) {
    state.remotePoints = balanceResult.data.points;
    state.remoteBalanceFetchedAt = Date.now();
    state.status = 'synced';
    state.error = null;
  } else {
    state.status = 'unavailable';
    state.error = balanceResult.error;
    saveRemoteState(state);
    return state;
  }

  const txResult = await fetchBackendTransactions(id, { page: 1, limit: 50 });
  if (txResult.ok) {
    state.remoteTransactions = txResult.data.transactions || [];
  }

  const cfgResult = await fetchBackendConfig();
  if (cfgResult.ok) {
    state.remoteConfig = cfgResult.data;
  }

  saveRemoteState(state);
  return state;
}

function getRemoteState(customerId) {
  const id = String(customerId || '');
  const state = loadRemoteState();
  if (!state || state.customerId !== id) {
    return createRemoteState(id);
  }
  return state;
}

function clearRemoteState(customerId) {
  const id = String(customerId || '');
  const state = loadRemoteState();
  if (!state || state.customerId !== id) return;
  saveRemoteState(createRemoteState(id));
}

// Expose minimal safe surface. Mutation wrappers exist but MUST NOT be
// called by POS during Phase 2A.
const loyaltySync = {
  syncCustomer,
  getRemoteState,
  clearRemoteState,
  fetchBackendBalance,
  fetchBackendTransactions,
  fetchBackendConfig
};

window.loyaltySync = loyaltySync;
