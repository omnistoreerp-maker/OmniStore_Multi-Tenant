'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_FILES = [
  path.join(__dirname, '..', '..', 'DigiTronics_v5.html'),
  path.join(__dirname, '..', '..', 'index.html')
];

const FORBIDDEN_SECRETS = [
  { value: '2C851EAAF6CB406CA5A484A0DCAD4E51', reason: 'hardcoded Veriphone API key' }
];

const FORBIDDEN_CREDENTIAL_PATTERNS = [
  { pattern: /password:\s*'RTX3080'/, reason: "default hardcoded password 'RTX3080'" },
  { pattern: /password:\s*'admin123'/, reason: "default hardcoded password 'admin123'" },
  { pattern: /password:\s*'8927'/, reason: "default hardcoded password '8927'" },
  { pattern: /password:\s*'3660'/, reason: "default hardcoded password '3660'" },
  { pattern: /password:\s*'1234'/, reason: "default hardcoded password '1234'" },
  { pattern: /password:\s*'1234c'/, reason: "default hardcoded password '1234c'" },
  { pattern: /password:\s*'1235c'/, reason: "default hardcoded password '1235c'" }
];

describe('client-side secret scan', () => {
  let fileContents;

  beforeAll(() => {
    fileContents = {};
    for (const fp of CLIENT_FILES) {
      fileContents[fp] = fs.readFileSync(fp, 'utf-8');
    }
  });

  for (const fp of CLIENT_FILES) {
    describe(path.basename(fp), () => {
      test('does not contain the removed Veriphone API key', () => {
        expect(fileContents[fp]).not.toContain('2C851EAAF6CB406CA5A484A0DCAD4E51');
      });

      test('does not auto-inject Veriphone API key on load', () => {
        expect(fileContents[fp]).not.toMatch(/veriphoneApiKey\s*=\s*['"][A-Z0-9]{20,}['"]/);
      });

      for (const item of FORBIDDEN_CREDENTIAL_PATTERNS) {
        test(`does not contain ${item.reason}`, () => {
          expect(fileContents[fp]).not.toMatch(item.pattern);
        });
      }
    });
  }
});
