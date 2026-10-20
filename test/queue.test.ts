import { InferenceQueue } from '../src/main/queue.js';
import { OllamaClient } from '../src/ollamaClient.js';
import { ScannedFile } from '../src/types.js';

console.log('='.repeat(70));
console.log('SLOTHSORT INFERENCE QUEUE TEST SUITE (STAGE C)');
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

function createDummyFile(id: string, name: string): ScannedFile {
  return {
    id,
    relativePath: name,
    absolutePath: `D:/test/${name}`,
    metadata: {
      filename: name,
      extension: '.pdf',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      textExcerpt: 'Sample excerpt'
    }
  };
}

async function runQueueTests() {
  // Mock client implementation for fast unit testing of queue state machine
  class MockOllamaClient extends OllamaClient {
    public mockResponse: () => Promise<string>;
    constructor(mockResponse: () => Promise<string>) {
      super({ model: 'gemma3:4b' });
      this.mockResponse = mockResponse;
    }

    override async verifyModelInstalled(): Promise<boolean> {
      return true;
    }

    override async classify(
      _metadata: any,
      options?: { signal?: AbortSignal; timeoutMs?: number }
    ): Promise<{ rawText: string; metrics: { totalDurationMs: number } }> {
      if (options?.signal?.aborted) {
        const err = new Error('Inference cancelled by user.');
        err.name = 'AbortError';
        throw err;
      }

      const responsePromise = this.mockResponse();

      if (options?.signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('Inference cancelled by user.');
            err.name = 'AbortError';
            reject(err);
          });
        });
        const text = await Promise.race([responsePromise, abortPromise]);
        return { rawText: text, metrics: { totalDurationMs: 15 } };
      }

      const text = await responsePromise;
      return { rawText: text, metrics: { totalDurationMs: 15 } };
    }
  }

  // --- 1. Basic Sequential Processing & State Progression ---
  console.log('\n--- 1. Basic Sequential Processing & State Progression ---');
  let currentMockResponse = async () => JSON.stringify({
    category: 'Documents',
    suggestedFilename: 'Valid_Document.pdf',
    proposedDestination: 'Documents/Legal',
    confidence: 'high',
    reasoning: 'Clear legal document.'
  });

  const mockClient = new MockOllamaClient(() => currentMockResponse());
  const queue = new InferenceQueue(mockClient);

  const fileA = createDummyFile('file-01', 'Contract_Draft.pdf');
  const fileB = createDummyFile('file-02', 'Annual_Report.pdf');

  const { addedCount, duplicateCount } = await queue.enqueue([fileA, fileB]);
  assert('Enqueued 2 new files', addedCount === 2);
  assert('No duplicates on fresh queue', duplicateCount === 0);

  // Allow sequential worker to complete
  await new Promise((r) => setTimeout(r, 100));

  const items = queue.getAllItems();
  assert('Queue contains 2 items', items.length === 2);
  assert('file-01 completed', items.find((i) => i.id === 'file-01')?.analysisStatus === 'completed');
  assert('file-02 completed', items.find((i) => i.id === 'file-02')?.analysisStatus === 'completed');
  assert('file-01 has valid proposal', items.find((i) => i.id === 'file-01')?.proposal?.suggestedFilename === 'Valid_Document.pdf');

  // --- 2. Duplicate Job Prevention ---
  console.log('\n--- 2. Duplicate Job Prevention ---');
  const fileC = createDummyFile('file-03', 'Invoice.pdf');
  // Mock slow response so it stays in analyzing state
  currentMockResponse = () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({
    category: 'Documents',
    suggestedFilename: 'Invoice_Paid.pdf',
    proposedDestination: 'Documents/Invoices',
    confidence: 'high',
    reasoning: 'Paid invoice.'
  })), 150));

  await queue.enqueue([fileC]);
  // Immediately attempt to enqueue fileC again while it is active
  const dupResult = await queue.enqueue([fileC]);
  assert('Duplicate active job was prevented', dupResult.duplicateCount === 1);
  assert('Added count is 0 for duplicate', dupResult.addedCount === 0);

  await new Promise((r) => setTimeout(r, 200));

  // --- 3. Malformed Model Output & Error Resilience ---
  console.log('\n--- 3. Malformed Model Output Handling ---');
  const fileD = createDummyFile('file-04', 'Broken.pdf');
  currentMockResponse = async () => 'NOT_VALID_JSON_AT_ALL';

  await queue.enqueue([fileD]);
  await new Promise((r) => setTimeout(r, 60));

  const itemD = queue.getAllItems().find((i) => i.id === 'file-04');
  assert('Item with malformed JSON output transitioned to failed', itemD?.analysisStatus === 'failed');
  assert('Error message recorded in item', itemD?.error?.includes('valid JSON') === true);

  // --- 4. Unsafe Windows Filename Output Rejection ---
  console.log('\n--- 4. Unsafe Model Proposal Rejection ---');
  const fileE = createDummyFile('file-05', 'Unsafe.pdf');
  currentMockResponse = async () => JSON.stringify({
    category: 'Documents',
    suggestedFilename: 'Illegal:Colon*Star?.pdf',
    proposedDestination: 'Documents',
    confidence: 'high',
    reasoning: 'Illegal chars.'
  });

  await queue.enqueue([fileE]);
  await new Promise((r) => setTimeout(r, 60));

  const itemE = queue.getAllItems().find((i) => i.id === 'file-05');
  assert('Item with illegal Windows characters failed validation', itemE?.analysisStatus === 'failed');
  assert('Error specifies forbidden characters', itemE?.error?.includes('forbidden characters') === true);

  // --- 5. Failure Recovery: Subsequent jobs continue ---
  console.log('\n--- 5. Failure Recovery ---');
  const fileF = createDummyFile('file-06', 'AfterFailure.pdf');
  currentMockResponse = async () => JSON.stringify({
    category: 'Documents',
    suggestedFilename: 'Success_After_Failure.pdf',
    proposedDestination: 'Documents',
    confidence: 'high',
    reasoning: 'Good file.'
  });

  await queue.enqueue([fileF]);
  await new Promise((r) => setTimeout(r, 60));

  const itemF = queue.getAllItems().find((i) => i.id === 'file-06');
  assert('Queue recovered from earlier failure and completed next item', itemF?.analysisStatus === 'completed');

  // --- 6. Cancellation Support ---
  console.log('\n--- 6. Cancellation Support ---');
  const fileG = createDummyFile('file-07', 'ToCancel1.pdf');
  const fileH = createDummyFile('file-08', 'ToCancel2.pdf');

  currentMockResponse = () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({
    category: 'Documents',
    suggestedFilename: 'NeverCompleted.pdf',
    proposedDestination: 'Documents',
    confidence: 'high',
    reasoning: 'Cancelled.'
  })), 500));

  await queue.enqueue([fileG, fileH]);
  // Cancel immediately
  queue.cancel();

  await new Promise((r) => setTimeout(r, 50));

  const itemG = queue.getAllItems().find((i) => i.id === 'file-07');
  const itemH = queue.getAllItems().find((i) => i.id === 'file-08');
  assert('In-flight item cancelled', itemG?.analysisStatus === 'cancelled');
  assert('Pending item cancelled', itemH?.analysisStatus === 'cancelled');

  // --- 7. Retry Capability ---
  console.log('\n--- 7. Retry Capability ---');
  currentMockResponse = async () => JSON.stringify({
    category: 'Documents',
    suggestedFilename: 'Retried_Successfully.pdf',
    proposedDestination: 'Documents',
    confidence: 'high',
    reasoning: 'Retried.'
  });

  const retried = queue.retry('file-07');
  assert('Retry triggered for cancelled file-07', retried);

  await new Promise((r) => setTimeout(r, 60));
  const itemGAfter = queue.getAllItems().find((i) => i.id === 'file-07');
  assert('Retried item completed successfully', itemGAfter?.analysisStatus === 'completed');

  // --- 8. Review Management (Approval, Rejection, Editing) ---
  console.log('\n--- 8. Review Status Updates & Validated Editing ---');
  assert('Default review status is pending_review', itemF?.reviewStatus === 'pending_review');

  queue.updateReview('file-06', 'approved');
  assert('Updated review status to approved', queue.getAllItems().find((i) => i.id === 'file-06')?.reviewStatus === 'approved');

  queue.updateReview('file-06', 'rejected');
  assert('Updated review status to rejected', queue.getAllItems().find((i) => i.id === 'file-06')?.reviewStatus === 'rejected');

  queue.updateReview('file-06', 'edited', {
    category: 'Documents',
    suggestedFilename: 'Custom_User_Name.pdf',
    proposedDestination: 'Documents/Custom',
    confidence: 'high',
    reasoning: 'User custom edit.'
  });
  const editedItem = queue.getAllItems().find((i) => i.id === 'file-06');
  assert('Updated review status to edited with custom proposal', editedItem?.reviewStatus === 'edited');
  assert('Custom filename preserved', editedItem?.userEditedProposal?.suggestedFilename === 'Custom_User_Name.pdf');

  console.log('\n' + '='.repeat(70));
  console.log(`SUMMARY: ${totalPassed}/${totalTests} tests passed (${Math.round((totalPassed / totalTests) * 100)}%).`);
  console.log('='.repeat(70) + '\n');

  if (totalPassed !== totalTests) {
    process.exit(1);
  }
}

runQueueTests().catch((err) => {
  console.error('Queue test suite failed:', err);
  process.exit(1);
});
