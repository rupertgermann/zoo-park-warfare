// Usage: node tools/park-dump.mjs [out.json]   (dev server on :5199). Prints a digest and, with an arg, writes the full JSON.
// Also builds the park twice in one page to prove buildPark is idempotent.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
const exe = process.env.CHROME || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.routeWebSocket(/.*/, () => {});
await page.goto('http://localhost:5199/tools/park-dump.html');
await page.waitForFunction(() => window.ready);
const [a, b] = await page.evaluate(() => window.dumpTwice());
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
console.log('build1', sha(a), a.length, 'bytes');
console.log('build2', sha(b), 'idempotent:', a === b);
if (process.argv[2]) writeFileSync(process.argv[2], a);
if (errs.length) console.log('errors', errs);
await browser.close();
