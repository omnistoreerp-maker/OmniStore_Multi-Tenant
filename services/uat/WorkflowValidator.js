(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  const REQUIRED = Object.freeze(['pos','sales','purchases','inventory','accounting','reports','manufacturing']);
  function validate(context = {}) {
    const { check, group, issue } = ns.UATUtils;
    const workflows = context.workflows || {};
    const checks = REQUIRED.map(id => {
      const value = workflows[id];
      const passed = value === true || (value && value.available === true);
      return check(`${id}_workflow`, `${id} workflow`, passed, passed ? 'Read-only scenario available' : 'Scenario unavailable');
    });
    const issues = checks.filter(item => !item.passed).map(item => issue('WORKFLOW_UNAVAILABLE', `${item.label} is unavailable for UAT.`, { severity: 'critical', blocking: true, area: 'workflow', reference: item.id }));
    return group('workflows', 'Workflow Validation', checks, issues);
  }
  ns.WorkflowValidator = Object.freeze({ version: '1.0.0', REQUIRED, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
