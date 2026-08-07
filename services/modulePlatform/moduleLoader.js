(function (root) {
  'use strict';

  const STORAGE_KEY = 'omnistore_modules_v1';
  const registry = root.OmniModuleRegistry || {};
  const lifecycle = new Map();
  let active = new Map();

  function readConfig() {
    try {
      const raw = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (e) { return {}; }
  }

  function writeConfig(config) {
    root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
  }

  function getBusinessType() {
    return typeof root.getCurrentBusinessType === 'function' ? root.getCurrentBusinessType() : 'computer_shop';
  }

  function isCompatible(definition, businessType = getBusinessType()) {
    return definition.businessTypes === '*' || definition.businessTypes.includes(businessType);
  }

  function getRequestedState(id) {
    const definition = registry[id];
    if (!definition) return false;
    const config = readConfig();
    return config[id]?.enabled ?? definition.enabled;
  }

  function resolveActive() {
    const next = new Map();
    const businessType = getBusinessType();
    Object.values(registry).forEach(definition => {
      next.set(definition.id, {
        definition,
        requested: !!getRequestedState(definition.id),
        compatible: isCompatible(definition, businessType),
        active: false,
        reason: ''
      });
    });
    let changed = true;
    while (changed) {
      changed = false;
      next.forEach(state => {
        const dependenciesReady = state.definition.dependencies.every(dep => next.get(dep)?.active);
        const shouldBeActive = state.requested && state.compatible && dependenciesReady;
        if (state.active !== shouldBeActive) {
          state.active = shouldBeActive;
          changed = true;
        }
      });
    }
    next.forEach(state => {
      if (!state.requested) state.reason = 'disabled';
      else if (!state.compatible) state.reason = 'business_type';
      else if (!state.active) state.reason = 'dependency';
    });
    return next;
  }

  function getSettings(id) {
    const definition = registry[id];
    if (!definition) return {};
    const config = readConfig();
    return { ...definition.defaultSettings, ...(config[id]?.settings || {}) };
  }

  function updateSettings(id, patch) {
    if (!registry[id]) throw new Error(`Unknown module: ${id}`);
    const config = readConfig();
    config[id] = {
      ...(config[id] || {}),
      settings: { ...getSettings(id), ...(patch || {}) }
    };
    writeConfig(config);
    return config[id].settings;
  }

  function register(id, hooks = {}) {
    if (!registry[id]) throw new Error(`Unknown module: ${id}`);
    lifecycle.set(id, {
      register: typeof hooks.register === 'function' ? hooks.register : () => {},
      boot: typeof hooks.boot === 'function' ? hooks.boot : () => {},
      shutdown: typeof hooks.shutdown === 'function' ? hooks.shutdown : () => {},
      onRoute: typeof hooks.onRoute === 'function' ? hooks.onRoute : () => {},
      registered: false,
      booted: false
    });
    return registry[id];
  }

  function boot() {
    const next = resolveActive();
    lifecycle.forEach((hooks, id) => {
      const shouldBoot = !!next.get(id)?.active;
      const context = { module: registry[id], settings: getSettings(id), loader: api };
      if (!hooks.registered) {
        hooks.register(context);
        hooks.registered = true;
      }
      if (shouldBoot && !hooks.booted) {
        hooks.boot(context);
        hooks.booted = true;
      } else if (!shouldBoot && hooks.booted) {
        hooks.shutdown(context);
        hooks.booted = false;
      }
    });
    active = next;
    return getState();
  }

  function setEnabled(id, enabled) {
    if (!registry[id]) throw new Error(`Unknown module: ${id}`);
    const config = readConfig();
    config[id] = { ...(config[id] || {}), enabled: !!enabled };
    writeConfig(config);
    boot();
    root.OmniNavigationBuilder?.build();
    root.OmniDashboardBuilder?.build();
    root.dispatchEvent?.(new CustomEvent('omnistoremoduleschange', { detail: getState() }));
    return getModuleState(id);
  }

  function getModuleState(id) {
    const state = active.get(id) || resolveActive().get(id);
    return state ? { ...state, settings: getSettings(id) } : null;
  }

  function getState() {
    return [...active.values()].map(state => ({ ...state, settings: getSettings(state.definition.id) }));
  }

  function getActiveModules() {
    return getState().filter(state => state.active).map(state => state.definition);
  }

  function findByRoute(route) {
    return Object.values(registry).find(definition =>
      definition.route === route || definition.navigation.some(item => item.route === route)
    ) || null;
  }

  function isRouteEnabled(route) {
    const definition = findByRoute(route);
    return definition ? !!getModuleState(definition.id)?.active : true;
  }

  function notifyRoute(route) {
    const definition = findByRoute(route);
    if (!definition || !getModuleState(definition.id)?.active) return false;
    lifecycle.get(definition.id)?.onRoute({ route, module: definition, settings: getSettings(definition.id), loader: api });
    return true;
  }

  function reset() {
    root.localStorage?.removeItem(STORAGE_KEY);
    return boot();
  }

  const api = {
    storageKey: STORAGE_KEY,
    register, boot, setEnabled, reset,
    getSettings, updateSettings,
    getState, getModuleState, getActiveModules,
    findByRoute, isRouteEnabled, notifyRoute,
    getBusinessType
  };

  root.OmniModuleLoader = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : window);
