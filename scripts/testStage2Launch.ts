import { PackagedAppDriver } from './packagedAppDriver.js';

async function main() {
  const driver = new PackagedAppDriver();
  try {
    await driver.launch();
    console.log('App launched successfully via CDP.');

    // Wait 2 seconds for React to mount and query Ollama
    await new Promise((r) => setTimeout(r, 2000));

    // Check DOM title and header
    const title = await driver.eval('document.title');
    console.log('Document title:', title);

    const hasSlothSortApi = await driver.eval('typeof window.slothsort === "object" && window.slothsort !== null');
    console.log('Has window.slothsort API:', hasSlothSortApi);

    // Check Ollama status in the DOM
    const bodyText = await driver.eval('document.body.innerText');
    console.log('Body snippet:', bodyText.substring(0, 300));

    // Capture initial screenshot
    await driver.captureScreenshot('stage2_initial_launch.png');

    console.log('STAGE 2 LAUNCH TEST PASSED.');
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('STAGE 2 FAILED:', err);
  process.exit(1);
});
