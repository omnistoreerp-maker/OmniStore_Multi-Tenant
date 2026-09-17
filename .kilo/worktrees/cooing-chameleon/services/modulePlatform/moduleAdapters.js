(function (root) {
  'use strict';
  const loader = root.OmniModuleLoader;
  const registry = root.OmniModuleRegistry || {};
  if (!loader) return;

  Object.values(registry).forEach(definition => {
    loader.register(definition.id, {
      register(context) {
        root.dispatchEvent?.(new CustomEvent('omnistoremoduleregister', { detail: { id: definition.id, settings: context.settings } }));
      },
      boot(context) {
        root.dispatchEvent?.(new CustomEvent('omnistoremoduleboot', { detail: { id: definition.id, settings: context.settings } }));
      },
      shutdown() {
        root.dispatchEvent?.(new CustomEvent('omnistoremoduleshutdown', { detail: { id: definition.id } }));
      },
      onRoute(context) {
        root.dispatchEvent?.(new CustomEvent('omnistoremoduleroute', { detail: { id: definition.id, route: context.route } }));
      }
    });
  });

  root.bootstrapOmniModulePlatform = function () {
    const state = loader.boot();
    root.OmniNavigationBuilder?.build();
    root.OmniDashboardBuilder?.build();
    return state;
  };

  root.addEventListener?.('businessprofilechange', () => root.bootstrapOmniModulePlatform());
})(typeof globalThis !== 'undefined' ? globalThis : window);
