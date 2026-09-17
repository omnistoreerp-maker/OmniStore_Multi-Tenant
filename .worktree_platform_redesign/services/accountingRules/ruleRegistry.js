(function (root) {
  'use strict';

  const profiles = new Map();
  const aliases = new Map();
  const lifecycle = { booted: false };

  function registerProfile(profile, options = {}) {
    if (!profile || !profile.id || !Array.isArray(profile.rules)) throw new Error('Invalid accounting profile');
    if (profiles.has(profile.id) && !options.replace) throw new Error(`Accounting profile already registered: ${profile.id}`);
    profiles.set(profile.id, profile);
    (profile.aliases || []).forEach(alias => aliases.set(alias, profile.id));
    return profile;
  }

  function unregisterProfile(id) {
    const profile = profiles.get(id);
    if (!profile) return false;
    profiles.delete(id);
    [...aliases.entries()].forEach(([alias, target]) => {
      if (target === id) aliases.delete(alias);
    });
    return true;
  }

  function resolveProfileId(id) {
    const key = String(id || 'computer_shop').trim();
    return profiles.has(key) ? key : aliases.get(key) || (profiles.has('computer_shop') ? 'computer_shop' : key);
  }

  function getProfile(id) {
    return profiles.get(resolveProfileId(id)) || null;
  }

  function getRule(profileId, operation) {
    const profile = getProfile(profileId);
    const target = String(operation || '').trim();
    return profile ? profile.rules.find(rule => rule.templateId === target || rule.ruleId === target) || null : null;
  }

  function boot() {
    if (lifecycle.booted) return listProfiles();
    const bundled = root.OmniBusinessAccountingProfiles;
    if (!bundled) throw new Error('Business accounting profiles are unavailable');
    bundled.profiles.forEach(profile => registerProfile(profile, { replace: true }));
    lifecycle.booted = true;
    return listProfiles();
  }

  function listProfiles() {
    return [...profiles.values()];
  }

  function listRules(profileId) {
    const profile = getProfile(profileId);
    return profile ? [...profile.rules] : [];
  }

  function shutdown() {
    profiles.clear();
    aliases.clear();
    lifecycle.booted = false;
  }

  root.OmniAccountingRuleRegistry = Object.freeze({
    version: '1.0.0',
    registerProfile,
    unregisterProfile,
    resolveProfileId,
    getProfile,
    getRule,
    listProfiles,
    listRules,
    boot,
    shutdown,
    isBooted: () => lifecycle.booted,
    stats: () => ({
      profiles: profiles.size,
      rules: [...profiles.values()].reduce((sum, profile) => sum + profile.rules.length, 0)
    })
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
