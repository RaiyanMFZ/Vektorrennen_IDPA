import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('TypeError') || msg.text().includes('[DEBUG]') || msg.text().includes('[ERROR]') || msg.text().includes('FAILED')) {
      console.log('BROWSER_CONSOLE:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('BROWSER_PAGEERROR:', error.message);
  });

  await page.goto('http://localhost:5173');
  console.log('Loaded page');

  // Wait for the name input and join button
  await page.waitForSelector('#player-name');
  await page.type('#player-name', 'TestPlayer');
  await page.click('#btn-join');

  // Wait for the start screen
  await page.waitForSelector('#btn-host');
  await page.click('#btn-host');

  // Wait for the player count selector (if it exists)
  try {
    await page.waitForSelector('.count-btn', { timeout: 2000 });
    await page.click('.count-btn[data-count="2"]'); // Click "2" players
    console.log('Clicked player count');
  } catch(e) {
    console.log('No player count modal');
  }

  // Wait for lobby info modal
  try {
    await page.waitForSelector('#btn-lobby-info-ok', { timeout: 2000 });
    await page.click('#btn-lobby-info-ok');
    console.log('Clicked OK on lobby info');
  } catch(e) {
    console.log('No lobby info modal');
  }

  // Wait for the lobby to load
  await page.waitForSelector('#btn-start-race');
  console.log('Lobby loaded. Clicking start race...');

  // Start the race
  await page.click('#btn-start-race');

  // Wait for a few seconds to let errors propagate
  await new Promise(r => setTimeout(r, 4000));

  console.log('Done waiting. Exiting.');
  await browser.close();
})();
