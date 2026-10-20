import os from 'node:os';
import { OllamaClient } from './ollamaClient.js';
import { SYNTHETIC_MALFORMED_RESPONSES, SYNTHETIC_TEST_CASES } from './testCases.js';
import { TestCase, TestResult } from './types.js';
import { validateModelOutput } from './validator.js';

export interface EvaluationSummary {
  modelName: string;
  totalCases: number;
  validJsonCount: number;
  validStructureCount: number;
  structuredOutputRatePct: number;
  correctCategoryCount: number;
  classificationAccuracyPct: number;
  coldStartLatencyMs: number;
  warmAverageLatencyMs: number;
  warmMedianLatencyMs: number;
  minWarmLatencyMs: number;
  maxWarmLatencyMs: number;
  failures: Array<{
    id: string;
    description: string;
    expected: string;
    actualCategory?: string;
    reason: string;
  }>;
  memoryReport: {
    processMemoryMb: number;
    systemTotalRamGb: number;
    systemFreeRamGb: number;
  };
  validatorSelfTest: {
    passed: boolean;
    totalMalformedTested: number;
    rejectedCount: number;
  };
}

/**
 * Runs the evaluation suite against the specified model.
 */
export async function runEvaluation(modelName: string = 'gemma3:4b'): Promise<EvaluationSummary> {
  console.log('='.repeat(70));
  console.log(`SLOTHSORT LOCAL AI EVALUATION SUITE: MODEL "${modelName}"`);
  console.log('='.repeat(70));

  // --- Step A: Validator Self-Test on Malformed Responses ---
  console.log('\n[1/3] Running Programmatic Validator Self-Test against malformed responses...');
  let rejectedCount = 0;
  for (const malformed of SYNTHETIC_MALFORMED_RESPONSES) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(malformed.raw);
    } catch {
      parsed = malformed.raw;
    }
    const valResult = validateModelOutput(parsed);
    if (!valResult.isValid) {
      rejectedCount++;
      console.log(`  ✓ Successfully rejected: "${malformed.description}" -> ${valResult.errors[0]}`);
    } else {
      console.error(`  ✗ FAILED TO REJECT: "${malformed.description}"`);
    }
  }
  const validatorPassed = rejectedCount === SYNTHETIC_MALFORMED_RESPONSES.length;
  console.log(`Validator Self-Test: ${rejectedCount}/${SYNTHETIC_MALFORMED_RESPONSES.length} malformed inputs safely rejected.\n`);

  // --- Step B: Ollama Health & Model Check ---
  console.log('[2/3] Checking Local Ollama Runtime...');
  const client = new OllamaClient({ model: modelName });
  const health = await client.checkHealth();
  if (!health.isHealthy) {
    throw new Error(`Cannot connect to Ollama: ${health.error}. Please ensure Ollama is installed and running on port 11434.`);
  }
  console.log(`  ✓ Ollama runtime detected. Version: ${health.version}`);

  const localModels = await client.listLocalModels();
  console.log(`  Local models available: ${localModels.length > 0 ? localModels.join(', ') : 'None'}`);

  const targetInstalled = localModels.some((m) => m === modelName || m.startsWith(`${modelName}:`));
  if (!targetInstalled) {
    console.warn(`  ⚠ Warning: Target model "${modelName}" was not found in installed tags! It may trigger an on-demand pull or fail.`);
  }

  // --- Step C: Run Synthetic Test Cases ---
  console.log(`\n[3/3] Running ${SYNTHETIC_TEST_CASES.length} Synthetic Test Cases...`);
  const results: TestResult[] = [];
  const warmLatencies: number[] = [];
  let coldStartLatency = 0;

  for (let i = 0; i < SYNTHETIC_TEST_CASES.length; i++) {
    const testCase = SYNTHETIC_TEST_CASES[i];
    const isCold = i === 0;

    process.stdout.write(`  [${i + 1}/${SYNTHETIC_TEST_CASES.length}] Testing ${testCase.id} (${testCase.input.filename})... `);

    try {
      const inference = await client.classify(testCase.input);
      if (isCold) {
        coldStartLatency = inference.metrics.totalDurationMs;
      } else {
        warmLatencies.push(inference.metrics.totalDurationMs);
      }

      let parsed: unknown = null;
      let jsonParseError = false;
      try {
        parsed = JSON.parse(inference.rawText);
      } catch {
        jsonParseError = true;
      }

      const validation = jsonParseError
        ? { isValid: false, errors: ['Failed to parse JSON response'] }
        : validateModelOutput(parsed);

      let isCorrectCategory = false;
      if (validation.isValid && validation.sanitized) {
        const actualCat = validation.sanitized.category;
        isCorrectCategory =
          actualCat === testCase.expectedCategory ||
          actualCat === testCase.acceptableAlternative;
      }

      results.push({
        testCase,
        rawResponseText: inference.rawText,
        parsedResponse: parsed,
        validation,
        isCorrectCategory,
        metrics: inference.metrics,
        isWarmup: isCold
      });

      const statusTag = validation.isValid
        ? (isCorrectCategory ? '✓ PASS' : '⚠ WRONG CAT')
        : '✗ INVALID';
      console.log(`${statusTag} (${inference.metrics.totalDurationMs}ms)`);
      if (validation.isValid && validation.sanitized) {
        console.log(`      → Cat: ${validation.sanitized.category} | Dest: ${validation.sanitized.proposedDestination} | Name: "${validation.sanitized.suggestedFilename}"`);
      } else {
        console.log(`      → Errors: ${validation.errors.join('; ')}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`✗ INFERENCE ERROR: ${errMsg}`);
      results.push({
        testCase,
        rawResponseText: '',
        validation: { isValid: false, errors: [errMsg] },
        isCorrectCategory: false,
        metrics: { totalDurationMs: 0 },
        isWarmup: isCold
      });
    }
  }

  // --- Step D: Metric Aggregation ---
  const validStructureCount = results.filter((r) => r.validation.isValid).length;
  const correctCategoryCount = results.filter((r) => r.isCorrectCategory).length;
  const validJsonCount = results.filter((r) => r.parsedResponse !== null && r.parsedResponse !== undefined).length;

  const warmAvgLatency = warmLatencies.length > 0
    ? Math.round(warmLatencies.reduce((a, b) => a + b, 0) / warmLatencies.length)
    : 0;

  const sortedWarm = [...warmLatencies].sort((a, b) => a - b);
  const warmMedian = sortedWarm.length > 0
    ? sortedWarm[Math.floor(sortedWarm.length / 2)]
    : 0;
  const minWarm = sortedWarm.length > 0 ? sortedWarm[0] : 0;
  const maxWarm = sortedWarm.length > 0 ? sortedWarm[sortedWarm.length - 1] : 0;

  const failures: EvaluationSummary['failures'] = [];
  for (const r of results) {
    if (!r.validation.isValid) {
      failures.push({
        id: r.testCase.id,
        description: r.testCase.description,
        expected: r.testCase.expectedCategory,
        reason: `Validation failed: ${r.validation.errors.join('; ')}`
      });
    } else if (!r.isCorrectCategory) {
      failures.push({
        id: r.testCase.id,
        description: r.testCase.description,
        expected: r.testCase.expectedCategory,
        actualCategory: r.validation.sanitized?.category,
        reason: `Category mismatch: expected "${r.testCase.expectedCategory}", got "${r.validation.sanitized?.category}"`
      });
    }
  }

  const memUsage = process.memoryUsage();
  const summary: EvaluationSummary = {
    modelName,
    totalCases: results.length,
    validJsonCount,
    validStructureCount,
    structuredOutputRatePct: Math.round((validStructureCount / results.length) * 100),
    correctCategoryCount,
    classificationAccuracyPct: Math.round((correctCategoryCount / results.length) * 100),
    coldStartLatencyMs: coldStartLatency,
    warmAverageLatencyMs: warmAvgLatency,
    warmMedianLatencyMs: warmMedian,
    minWarmLatencyMs: minWarm,
    maxWarmLatencyMs: maxWarm,
    failures,
    memoryReport: {
      processMemoryMb: Math.round(memUsage.rss / 1024 / 1024),
      systemTotalRamGb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      systemFreeRamGb: Math.round((os.freemem() / 1024 / 1024 / 1024) * 10) / 10
    },
    validatorSelfTest: {
      passed: validatorPassed,
      totalMalformedTested: SYNTHETIC_MALFORMED_RESPONSES.length,
      rejectedCount
    }
  };

  printSummary(summary);
  return summary;
}

function printSummary(s: EvaluationSummary) {
  console.log('\n' + '='.repeat(70));
  console.log('SLOTHSORT PHASE 1 EVALUATION REPORT');
  console.log('='.repeat(70));
  console.log(`Model Identifier:                 ${s.modelName}`);
  console.log(`Total Test Cases:                 ${s.totalCases}`);
  console.log(`Valid Structured Output Rate:     ${s.structuredOutputRatePct}% (${s.validStructureCount}/${s.totalCases})`);
  console.log(`Classification Accuracy:          ${s.classificationAccuracyPct}% (${s.correctCategoryCount}/${s.totalCases})`);
  console.log(`Cold Start Latency (1st request): ${s.coldStartLatencyMs} ms`);
  console.log(`Warm Average Latency:             ${s.warmAverageLatencyMs} ms`);
  console.log(`Warm Median Latency:              ${s.warmMedianLatencyMs} ms (Range: ${s.minWarmLatencyMs}ms - ${s.maxWarmLatencyMs}ms)`);
  console.log(`Node Process RSS Memory:          ${s.memoryReport.processMemoryMb} MB`);
  console.log(`System Memory (Free / Total):     ${s.memoryReport.systemFreeRamGb} GB free / ${s.memoryReport.systemTotalRamGb} GB total`);
  console.log(`Validator Unit Tests:             ${s.validatorSelfTest.passed ? 'PASSED' : 'FAILED'} (${s.validatorSelfTest.rejectedCount}/${s.validatorSelfTest.totalMalformedTested} malformed rejected)`);

  if (s.failures.length > 0) {
    console.log(`\nFailures & Discrepancies (${s.failures.length}):`);
    for (const f of s.failures) {
      console.log(`  - [${f.id}] ${f.description}:`);
      console.log(`      Expected: ${f.expected} | ${f.reason}`);
    }
  } else {
    console.log('\nAll test cases passed validation and classification accurately!');
  }
  console.log('='.repeat(70) + '\n');
}

// If executed directly
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const targetModel = process.argv[2] || process.env.SLOTHSORT_MODEL || 'gemma3:4b';
  runEvaluation(targetModel).catch((err) => {
    console.error('Fatal evaluation error:', err);
    process.exit(1);
  });
}
