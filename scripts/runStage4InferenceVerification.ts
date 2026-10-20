import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OllamaClient } from '../src/ollamaClient.js';
import { InferenceQueue } from '../src/main/queue.js';
import { scanFolder } from '../src/main/scanner.js';
import { ALLOWED_CATEGORIES, ScannedFile, StagedItem } from '../src/types.js';

interface InferenceSampleResult {
  filename: string;
  relativePath: string;
  isMetadataOnly: boolean;
  latencyMs: number;
  category?: string;
  proposedDestination?: string;
  suggestedFilename?: string;
  explanation?: string;
  reviewStatus: string;
  sha256Before: string;
  sha256After: string;
  isUnchanged: boolean;
}

export async function runStage4Verification(): Promise<{
  success: boolean;
  model: string;
  endpoint: string;
  results: InferenceSampleResult[];
  queueSequentialConfirmed: boolean;
  zeroMutationConfirmed: boolean;
  checks: { name: string; pass: boolean; details?: string }[];
}> {
  console.log('\n======================================================');
  console.log('SLOTHSORT PHASE 3B: STAGE 4 LOCAL AI & QUEUE CHECKS');
  console.log('======================================================\n');

  const checks: { name: string; pass: boolean; details?: string }[] = [];
  const modelName = 'gemma3:4b';
  const endpoint = 'http://127.0.0.1:11434';

  // 1. Check Ollama client and model availability
  console.log(`[Stage 4.1] Connecting to local Ollama on ${endpoint}...`);
  const client = new OllamaClient({ model: modelName, baseUrl: endpoint });
  const health = await client.checkHealth();
  checks.push({
    name: 'Local Ollama daemon reachable on loopback 127.0.0.1:11434',
    pass: health.isHealthy,
    details: health.isHealthy ? `Connected: Ollama version ${health.version}` : `Failed: ${health.error}`
  });

  const modelInstalled = await client.verifyModelInstalled();
  checks.push({
    name: `Required model "${modelName}" is present in local library`,
    pass: modelInstalled,
    details: modelInstalled ? `Confirmed: ${modelName} installed` : `Model ${modelName} not found!`
  });

  if (!health.isHealthy || !modelInstalled) {
    throw new Error('Ollama or target model unavailable.');
  }

  // 2. Select 3 target synthetic files from fixtures
  const fixturesRoot = 'D:\\SlothSort-Phase3B-Test\\workspace\\fixtures';
  const scanResult = await scanFolder(fixturesRoot);

  const targetFiles: ScannedFile[] = [];
  const fNotes = scanResult.files.find((f) => f.metadata.filename === 'notes.md');
  const fCalc = scanResult.files.find((f) => f.metadata.filename === 'calculator.ts');
  const fImg = scanResult.files.find((f) => f.metadata.filename === 'image_01.png');

  if (fNotes) targetFiles.push(fNotes);
  if (fCalc) targetFiles.push(fCalc);
  if (fImg) targetFiles.push(fImg);

  console.log(`[Stage 4.2] Selected ${targetFiles.length} synthetic files for inference batch:`, targetFiles.map((f) => f.metadata.filename));

  // Compute pre-inference SHA-256 hashes
  const preHashes = new Map<string, string>();
  for (const f of targetFiles) {
    const data = fs.readFileSync(f.absolutePath);
    preHashes.set(f.id, crypto.createHash('sha256').update(data).digest('hex'));
  }

  // 3. Initialize Sequential Inference Queue
  const progressLogs: any[] = [];
  const updatedItems: StagedItem[] = [];
  let concurrentActiveCount = 0;
  let maxConcurrentObserved = 0;

  const queue = new InferenceQueue(client, {
    onItemUpdated: (item: StagedItem) => {
      if (item.analysisStatus === 'analyzing') {
        concurrentActiveCount++;
        if (concurrentActiveCount > maxConcurrentObserved) {
          maxConcurrentObserved = concurrentActiveCount;
        }
      } else if (item.analysisStatus === 'completed' || item.analysisStatus === 'failed') {
        concurrentActiveCount = Math.max(0, concurrentActiveCount - 1);
        updatedItems.push(item);
      }
    },
    onProgress: (p) => {
      progressLogs.push(p);
    }
  });

  // 4. Enqueue and execute
  console.log(`[Stage 4.3] Starting sequential background queue for ${targetFiles.length} items...`);
  const startTime = Date.now();
  await queue.enqueue(targetFiles);

  // Poll queue completion (bounded timeout: 3 minutes max)
  const pollStart = Date.now();
  while (true) {
    const stats = queue.getStats();
    if (stats.queued === 0 && stats.analyzing === 0) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    if (elapsed % 15 === 0) {
      console.log(`[Stage 4.3] Queue in progress (${elapsed}s elapsed): Queued=${stats.queued}, Analyzing=${stats.analyzing}, Completed=${stats.completed}, Failed=${stats.failed}`);
    }
    if (elapsed > 180) {
      console.warn('[Stage 4.3] Queue execution exceeded 180s timeout!');
      break;
    }
  }

  const totalBatchLatencyMs = Date.now() - startTime;
  console.log(`[Stage 4.3] All inference finished in ${totalBatchLatencyMs} ms. Max concurrent jobs observed: ${maxConcurrentObserved}`);

  // Check: Sequential execution (concurrency never exceeded 1)
  const isSequential = maxConcurrentObserved <= 1;
  checks.push({
    name: 'Sequential queue enforcement (strictly 1 worker active at a time)',
    pass: isSequential,
    details: `Max concurrent active jobs: ${maxConcurrentObserved}`
  });

  // 5. Inspect inference results and measure per-file timing
  const sampleResults: InferenceSampleResult[] = [];
  let allProposalsPendingReview = true;
  let allCategoriesValid = true;
  let allZeroMutations = true;

  for (const f of targetFiles) {
    const staged = queue.getItem(f.id);
    const postData = fs.readFileSync(f.absolutePath);
    const postHash = crypto.createHash('sha256').update(postData).digest('hex');
    const preHash = preHashes.get(f.id)!;
    const isUnchanged = postHash === preHash;
    if (!isUnchanged) allZeroMutations = false;

    if (!staged || staged.analysisStatus !== 'completed') {
      sampleResults.push({
        filename: f.metadata.filename,
        relativePath: f.relativePath,
        isMetadataOnly: !f.metadata.textExcerpt,
        latencyMs: staged?.latencyMs || 0,
        reviewStatus: staged?.reviewStatus || 'unknown',
        sha256Before: preHash,
        sha256After: postHash,
        isUnchanged
      });
      continue;
    }

    if (staged.reviewStatus !== 'pending_review') {
      allProposalsPendingReview = false;
    }

    const cat = staged.proposal?.category;
    if (!cat || !ALLOWED_CATEGORIES.includes(cat as any)) {
      allCategoriesValid = false;
    }

    sampleResults.push({
      filename: f.metadata.filename,
      relativePath: f.relativePath,
      isMetadataOnly: !f.metadata.textExcerpt,
      latencyMs: staged.latencyMs || 0,
      category: staged.proposal?.category,
      proposedDestination: staged.proposal?.proposedDestination,
      suggestedFilename: staged.proposal?.suggestedFilename,
      explanation: staged.proposal?.reasoning,
      reviewStatus: staged.reviewStatus,
      sha256Before: preHash,
      sha256After: postHash,
      isUnchanged
    });
  }

  checks.push({
    name: 'All completed proposals initialized with reviewStatus="pending_review" (No auto-move)',
    pass: allProposalsPendingReview,
    details: allProposalsPendingReview ? 'PASSED: User approval strictly required' : 'FAILED: Non-pending review status'
  });

  checks.push({
    name: 'All proposed categories belong to ALLOWED_CATEGORIES taxonomy',
    pass: allCategoriesValid,
    details: allCategoriesValid ? 'PASSED: Categories strictly conform to taxonomy' : 'FAILED: Invalid category found'
  });

  checks.push({
    name: 'Zero mutations during inference: Source files remain completely untouched and unmodified',
    pass: allZeroMutations,
    details: allZeroMutations ? 'PASSED: All source hashes match pre-inference hashes' : 'FAILED: File mutated during inference!'
  });

  // 6. Test cancellation and retry on a dummy pending item
  console.log('[Stage 4.6] Testing cancellation and retry capability...');
  const fExtra = scanResult.files.find((f) => f.metadata.filename === 'small_preview.txt');
  let cancelRetryPass = false;
  if (fExtra) {
    const testQueue = new InferenceQueue(client);
    await testQueue.enqueue([fExtra]);
    // Cancel immediately
    testQueue.cancel();
    const itemAfterCancel = testQueue.getItem(fExtra.id);
    const wasCancelled = itemAfterCancel?.analysisStatus === 'cancelled';
    // Retry
    const retryRes = testQueue.retry(fExtra.id);
    const itemAfterRetry = testQueue.getItem(fExtra.id);
    const wasRequeued = itemAfterRetry?.analysisStatus === 'queued' || itemAfterRetry?.analysisStatus === 'analyzing';
    testQueue.cancel(); // cancel again cleanly
    cancelRetryPass = wasCancelled && retryRes && wasRequeued;
  }
  checks.push({
    name: 'Queue supports job cancellation and retry without corrupted state',
    pass: cancelRetryPass,
    details: cancelRetryPass ? 'PASSED: Successfully cancelled and retried item' : 'FAILED: Cancel/retry issue'
  });

  const allPass = checks.every((c) => c.pass);
  console.log(`\n[Stage 4] Local AI verification result: ${allPass ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.pass).length}/${checks.length} checks passed).\n`);

  return {
    success: allPass,
    model: modelName,
    endpoint,
    results: sampleResults,
    queueSequentialConfirmed: isSequential,
    zeroMutationConfirmed: allZeroMutations,
    checks
  };
}

if (process.argv[1]?.endsWith('runStage4InferenceVerification.ts')) {
  runStage4Verification()
    .then((res) => {
      console.log('STAGE 4 RESULTS:', JSON.stringify(res, null, 2));
      if (!res.success) process.exit(1);
    })
    .catch((err) => {
      console.error('STAGE 4 FAILED:', err);
      process.exit(1);
    });
}
