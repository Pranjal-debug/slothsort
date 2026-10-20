import { InferenceQueue } from '../src/main/queue.js';
import { OllamaClient } from '../src/ollamaClient.js';
import { ScannedFile, StagedItem } from '../src/types.js';

console.log('='.repeat(70));
console.log('SLOTHSORT REAL LOCAL OLLAMA INTEGRATION TEST (STAGE C)');
console.log('Target Model: gemma3:4b on http://127.0.0.1:11434');
console.log('='.repeat(70));

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

async function runIntegration() {
  const client = new OllamaClient({ model: 'gemma3:4b' });

  // 1. Check runtime availability
  console.log('\n[1/4] Checking Ollama daemon and model...');
  const health = await client.checkHealth();
  if (!health.isHealthy) {
    console.warn(`  ⚠ Ollama is not running on 127.0.0.1:11434: ${health.error}. Skipping live integration test.`);
    return;
  }
  assert('Ollama daemon reachable', health.isHealthy);

  const modelInstalled = await client.verifyModelInstalled();
  if (!modelInstalled) {
    console.warn('  ⚠ gemma3:4b not found. Skipping live integration test.');
    return;
  }
  assert('gemma3:4b model verified in local library', modelInstalled);

  // 2. Setup InferenceQueue with real OllamaClient
  console.log('\n[2/4] Setting up live sequential queue with 2 synthetic files...');
  const updatedItems: StagedItem[] = [];
  const queue = new InferenceQueue(client, {
    onItemUpdated: (item) => {
      updatedItems.push({ ...item });
      console.log(`    [Live Queue Event] ${item.file.metadata.filename} -> ${item.analysisStatus.toUpperCase()} ${item.latencyMs ? `(${item.latencyMs}ms)` : ''}`);
      if (item.proposal) {
        console.log(`        Suggested: "${item.proposal.suggestedFilename}" | Dest: "${item.proposal.proposedDestination}" | Cat: ${item.proposal.category}`);
      }
    }
  });

  const file1: ScannedFile = {
    id: 'real-01',
    relativePath: 'docs/Q4_Security_Audit_2026.docx',
    absolutePath: 'D:/test/docs/Q4_Security_Audit_2026.docx',
    metadata: {
      filename: 'Q4_Security_Audit_2026.docx',
      extension: '.docx',
      sizeBytes: 45000,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      textExcerpt: 'Quarterly Security Audit Report 2026: Identity management, zero-trust network verification, and penetration testing results.'
    }
  };

  const file2: ScannedFile = {
    id: 'real-02',
    relativePath: 'screenshots/Screenshot 2026-10-20 153012.png',
    absolutePath: 'D:/test/screenshots/Screenshot 2026-10-20 153012.png',
    metadata: {
      filename: 'Screenshot 2026-10-20 153012.png',
      extension: '.png',
      sizeBytes: 980000,
      mimeType: 'image/png',
      isScreenshotHint: true,
      textExcerpt: 'OCR snippet: Database connection failed. Host unreachable at 10.0.0.4. Error code 503.'
    }
  };

  await queue.enqueue([file1, file2]);

  // Wait for both files to complete through sequential queue
  console.log('\n[3/4] Awaiting sequential background queue processing...');
  const maxWaitMs = 120000;
  const startWait = Date.now();

  while (Date.now() - startWait < maxWaitMs) {
    const stats = queue.getStats();
    if (stats.completed + stats.failed + stats.cancelled >= 2) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const items = queue.getAllItems();
  const processed1 = items.find((i) => i.id === 'real-01');
  const processed2 = items.find((i) => i.id === 'real-02');

  assert('File 1 completed successfully through live model', processed1?.analysisStatus === 'completed');
  assert('File 1 classified as Documents', processed1?.proposal?.category === 'Documents');
  assert('File 1 received non-empty proposed destination', Boolean(processed1?.proposal?.proposedDestination));

  assert('File 2 completed successfully through live model', processed2?.analysisStatus === 'completed');
  assert('File 2 classified as Screenshots', processed2?.proposal?.category === 'Screenshots');
  assert('File 2 received descriptive suggested filename', Boolean(processed2?.proposal?.suggestedFilename));

  // 3. Test Live Cancellation
  console.log('\n[4/4] Testing live cancellation on third item...');
  const file3: ScannedFile = {
    id: 'real-03',
    relativePath: 'temp/unwanted.log',
    absolutePath: 'D:/test/temp/unwanted.log',
    metadata: {
      filename: 'unwanted.log',
      extension: '.log',
      sizeBytes: 1000,
      textExcerpt: 'Temporary test log line.'
    }
  };

  await queue.enqueue([file3]);
  // Cancel immediately
  queue.cancel();

  const processed3 = queue.getAllItems().find((i) => i.id === 'real-03');
  assert('Live queue cancellation transitions item to cancelled', processed3?.analysisStatus === 'cancelled');

  console.log('\n' + '='.repeat(70));
  console.log(`LIVE INTEGRATION TEST RESULTS: ${totalPassed}/${totalTests} passed (${Math.round((totalPassed / totalTests) * 100)}%).`);
  if (processed1?.latencyMs && processed2?.latencyMs) {
    console.log(`Measured Actual Inference Latencies:`);
    console.log(`  - File 1 (Audit doc): ${processed1.latencyMs} ms`);
    console.log(`  - File 2 (Screenshot): ${processed2.latencyMs} ms`);
  }
  console.log('='.repeat(70) + '\n');

  if (totalPassed !== totalTests) {
    process.exit(1);
  }
}

runIntegration().catch((err) => {
  console.error('Live integration test failed:', err);
  process.exit(1);
});
