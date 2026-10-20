import { SYNTHETIC_MALFORMED_RESPONSES } from './testCases.js';
import { validateFilename, validateDestination, validateModelOutput } from './validator.js';

console.log('='.repeat(65));
console.log('SLOTHSORT PROGRAMMATIC VALIDATOR UNIT TESTS');
console.log('='.repeat(65));

let totalPassed = 0;
let totalTests = 0;

function assert(description: string, condition: boolean, detail?: string) {
  totalTests++;
  if (condition) {
    totalPassed++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description} ${detail ? `(${detail})` : ''}`);
  }
}

// 1. Filename safety checks
console.log('\n--- 1. Windows Filename Safety Checks ---');
assert('Valid filename passes', validateFilename('Monthly_Report_2026.pdf').isValid);
assert('Unicode filename passes', validateFilename('財務諸表_2026.xlsx').isValid);
assert('Filename with colon fails', !validateFilename('Report:2026.pdf').isValid);
assert('Filename with question mark fails', !validateFilename('what?.pdf').isValid);
assert('Filename with asterisk fails', !validateFilename('star*.png').isValid);
assert('Filename with backslash fails', !validateFilename('path\\file.txt').isValid);
assert('Filename with forward slash fails', !validateFilename('path/file.txt').isValid);
assert('Filename exceeding 255 chars fails', !validateFilename('a'.repeat(256) + '.txt').isValid);
assert('Reserved Windows device CON fails', !validateFilename('CON.txt').isValid);
assert('Reserved Windows device AUX fails', !validateFilename('aux.pdf').isValid);
assert('Reserved Windows device NUL fails', !validateFilename('NUL').isValid);
assert('Trailing dot on Windows fails', !validateFilename('filename.').isValid);

// 2. Destination path safety checks
console.log('\n--- 2. Destination Folder Path Safety Checks ---');
assert('Valid relative path passes', validateDestination('Documents/Finance').isValid);
assert('Simple folder passes', validateDestination('Images').isValid);
assert('Directory traversal (..) fails', !validateDestination('../../Windows/System32').isValid);
assert('Absolute path with drive letter fails', !validateDestination('C:/Program Files').isValid);
assert('Leading slash fails', !validateDestination('/etc/passwd').isValid);
assert('Illegal character in destination fails', !validateDestination('Documents/Sub<dir>').isValid);

// 3. Synthetic malformed response rejection
console.log('\n--- 3. Synthetic Malformed Response Rejection Tests ---');
for (const tc of SYNTHETIC_MALFORMED_RESPONSES) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tc.raw);
  } catch {
    parsed = tc.raw;
  }
  const result = validateModelOutput(parsed);
  assert(`Rejects: ${tc.description}`, !result.isValid, result.errors.join('; '));
}

// 4. Valid structured object acceptance
console.log('\n--- 4. Valid Structured Object Acceptance ---');
const validSample = {
  category: 'Documents',
  suggestedFilename: 'Q3_2026_Report.pdf',
  proposedDestination: 'Documents/Financial',
  confidence: 'high',
  reasoning: 'Clear financial statement document.'
};
const validResult = validateModelOutput(validSample);
assert('Valid structured sample is accepted', validResult.isValid);
assert('Category preserved', validResult.sanitized?.category === 'Documents');
assert('Destination sanitized', validResult.sanitized?.proposedDestination === 'Documents/Financial');

console.log('\n' + '='.repeat(65));
console.log(`SUMMARY: ${totalPassed}/${totalTests} tests passed (${Math.round((totalPassed/totalTests)*100)}%).`);
console.log('='.repeat(65));

if (totalPassed !== totalTests) {
  process.exit(1);
}
