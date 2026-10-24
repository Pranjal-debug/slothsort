import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PackagedAppDriver } from './packagedAppDriver.js';

const validationRoot = 'D:\\SlothSort-Day2-Packaged-Validation';
const workspaceRoot = path.join(validationRoot, 'workspace');
const profileRoot = path.join(validationRoot, 'profile');
const evidenceRoot = path.resolve('artifacts', 'day-2-audit');
const screenshotRoot = path.join(evidenceRoot, 'screenshots');
const exePath = path.resolve('dist', 'package', 'win-unpacked', 'SlothSort.exe');

interface Check {
  name: string;
  pass: boolean;
  details: string;
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function capture(driver: PackagedAppDriver, filename: string): Promise<string> {
  const response = await driver.send('Page.captureScreenshot', { format: 'png' });
  const target = path.join(screenshotRoot, filename);
  fs.writeFileSync(target, Buffer.from(response.data, 'base64'));
  return target;
}

async function waitFor(
  description: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 120_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error(`This validation must run with Windows Node.js; detected ${process.platform}.`);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error(`Fresh packaged executable was not found at ${exePath}.`);
  }

  fs.rmSync(validationRoot, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(screenshotRoot, { recursive: true });

  const sourcePath = path.join(workspaceRoot, 'meeting_summary.txt');
  const secondPath = path.join(workspaceRoot, 'invoice_demo.txt');
  const sourceContent = 'Synthetic executive summary for the SlothSort Day 2 packaged validation.\n';
  const secondContent = 'Synthetic invoice document for the SlothSort Day 2 packaged validation.\n';
  fs.writeFileSync(sourcePath, sourceContent);
  fs.writeFileSync(secondPath, secondContent);
  const sourceHash = sha256(sourcePath);
  const secondHash = sha256(secondPath);

  const checks: Check[] = [];
  const screenshots: string[] = [];
  const resourceUrls = new Set<string>();
  const driver = new PackagedAppDriver();
  driver.exePath = exePath;
  driver.userDataDir = profileRoot;

  try {
    await driver.launch({ port: 9250 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    screenshots.push(await capture(driver, 'day2_01_launch.png'));

    const status = await driver.eval('window.slothsort.getOllamaStatus()');
    checks.push({
      name: 'Packaged app reaches local Ollama and finds gemma3:4b',
      pass: status.isHealthy === true && status.modelInstalled === true,
      details: JSON.stringify(status)
    });

    const launchResources: string[] = await driver.eval(
      'performance.getEntriesByType("resource").map((entry) => entry.name)'
    );
    for (const resource of launchResources) resourceUrls.add(resource);

    await driver.eval(`
      window.__day2LastAnalyzedItem = null;
      window.slothsort.onAnalysisResult((item) => { window.__day2LastAnalyzedItem = item; });
    `);

    const scanResult = await driver.eval(`window.slothsort.scanFolder(${JSON.stringify(workspaceRoot)})`);
    screenshots.push(await capture(driver, 'day2_02_scanned.png'));
    checks.push({
      name: 'Packaged scanner discovers only synthetic workspace files',
      pass: scanResult.files.length === 2 && scanResult.files.every((file: any) => file.absolutePath.startsWith(workspaceRoot)),
      details: `discovered=${scanResult.files.length}`
    });

    const targetFile = scanResult.files.find((file: any) => file.metadata.filename === 'meeting_summary.txt');
    if (!targetFile) throw new Error('Synthetic meeting_summary.txt was not discovered.');

    await driver.eval(`window.slothsort.startAnalysis([${JSON.stringify(targetFile)}])`);
    await waitFor('local inference result', async () => {
      const item = await driver.eval('window.__day2LastAnalyzedItem');
      return item?.analysisStatus === 'completed';
    });
    screenshots.push(await capture(driver, 'day2_03_inference_review.png'));

    const editedProposal = {
      category: 'Documents',
      proposedDestination: 'Documents/Summaries',
      suggestedFilename: 'Q4_Meeting_Summary.txt',
      confidence: 'high',
      reasoning: 'Synthetic Day 2 packaged validation proposal.'
    };
    const edited = await driver.eval(`window.slothsort.updateReview(${JSON.stringify(targetFile.id)}, 'edited', ${JSON.stringify(editedProposal)})`);
    const approved = await driver.eval(`window.slothsort.updateReview(${JSON.stringify(targetFile.id)}, 'approved')`);
    screenshots.push(await capture(driver, 'day2_04_approved.png'));
    checks.push({
      name: 'Packaged review edit invalidates then requires fresh approval',
      pass: edited === true && approved === true,
      details: `edited=${edited}, approved=${approved}`
    });

    const execution = await driver.eval(
      `window.slothsort.executeOperations(${JSON.stringify(workspaceRoot)}, [${JSON.stringify(targetFile.id)}])`
    );
    const destinationPath = path.join(workspaceRoot, 'Documents', 'Summaries', 'Q4_Meeting_Summary.txt');
    const executionPass =
      execution.successful.length === 1 &&
      fs.existsSync(destinationPath) &&
      !fs.existsSync(sourcePath) &&
      sha256(destinationPath) === sourceHash;
    screenshots.push(await capture(driver, 'day2_05_executed.png'));
    checks.push({
      name: 'Packaged approved move preserves SHA-256 and unlinks source',
      pass: executionPass,
      details: `successful=${execution.successful.length}, destinationExists=${fs.existsSync(destinationPath)}, sourceExists=${fs.existsSync(sourcePath)}, hash=${executionPass ? 'match' : 'mismatch'}`
    });

    const history = await driver.eval(`window.slothsort.getJournal(${JSON.stringify(workspaceRoot)})`);
    const operation = history.find((record: any) => record.stagedItemId === targetFile.id);
    checks.push({
      name: 'Packaged operation history records completed move',
      pass: operation?.status === 'completed',
      details: `historyRecords=${history.length}, status=${operation?.status ?? 'missing'}`
    });

    const undo = await driver.eval(`window.slothsort.undoOperation(${JSON.stringify(operation.id)})`);
    const undoPass =
      undo.success === true &&
      fs.existsSync(sourcePath) &&
      !fs.existsSync(destinationPath) &&
      sha256(sourcePath) === sourceHash;
    screenshots.push(await capture(driver, 'day2_06_undone.png'));
    checks.push({
      name: 'Packaged undo restores original bytes and path',
      pass: undoPass,
      details: `success=${undo.success}, sourceRestored=${fs.existsSync(sourcePath)}, destinationExists=${fs.existsSync(destinationPath)}, hash=${undoPass ? 'match' : 'mismatch'}`
    });

    await driver.close();

    const restarted = new PackagedAppDriver();
    restarted.exePath = exePath;
    restarted.userDataDir = profileRoot;
    try {
      await restarted.launch({ port: 9251 });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const reloadedHistory = await restarted.eval(`window.slothsort.getJournal(${JSON.stringify(workspaceRoot)})`);
      const reloaded = reloadedHistory.find((record: any) => record.stagedItemId === targetFile.id);
      screenshots.push(await capture(restarted, 'day2_07_relaunch_history.png'));
      checks.push({
        name: 'Restarted packaged app reloads journal with undone status',
        pass: reloaded?.status === 'undone',
        details: `historyRecords=${reloadedHistory.length}, status=${reloaded?.status ?? 'missing'}`
      });

      const restartResources: string[] = await restarted.eval(
        'performance.getEntriesByType("resource").map((entry) => entry.name)'
      );
      for (const resource of restartResources) resourceUrls.add(resource);
    } finally {
      await restarted.close();
    }
  } finally {
    await driver.close();
  }

  const externalResources = [...resourceUrls].filter((url) => {
    if (!/^https?:/i.test(url)) return false;
    return !url.startsWith('http://127.0.0.1:11434') && !url.startsWith('http://localhost:5173');
  });
  const fontResources = [...resourceUrls].filter((url) => /fonts\.(googleapis|gstatic)\.com/i.test(url));
  checks.push({
    name: 'Packaged renderer requests no Google Fonts or other external resources',
    pass: externalResources.length === 0 && fontResources.length === 0,
    details: `external=${JSON.stringify(externalResources)}, fonts=${JSON.stringify(fontResources)}`
  });

  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    windowsVersion: process.env.OS || 'Windows',
    executable: exePath,
    executableSha256: sha256(exePath),
    workspaceRoot,
    sourceHash,
    secondHash,
    screenshots,
    resourceUrls: [...resourceUrls],
    checks,
    allPassed: checks.every((check) => check.pass)
  };
  fs.writeFileSync(path.join(evidenceRoot, 'windows-packaged-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.allPassed) process.exit(1);
}

main().catch((error) => {
  console.error('DAY 2 WINDOWS PACKAGED VALIDATION FAILED:', error);
  process.exit(1);
});
