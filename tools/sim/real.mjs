import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
export async function open(species, { w = 1280, h = 720 } = {}) {
  const b = await chromium.launch({ executablePath: `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, headless: true, args: ['--use-angle=metal'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // Swallow Vite's HMR socket so concurrent src/ edits cannot full-reload the page mid-run.
  await p.routeWebSocket(/.*/, () => {});
  if (process.env.CODE) {
    const edits = JSON.parse(readFileSync(process.env.CODE, 'utf8'));
    for (const file of new Set(edits.map(e => e.file))) await p.route(u => new URL(u).pathname === file, async route => {
      const res = await route.fetch(); let body = await res.text();
      for (const e of edits.filter(e => e.file === file)) { if (body.split(e.find).length !== 2) throw new Error('find mismatch ' + e.find); body = body.replace(e.find, () => e.replace); }
      await route.fulfill({ response: res, body });
    });
  }
  await p.goto('http://localhost:5199'); await p.waitForFunction(() => window.__pw);
  await p.evaluate(s => { __pw.app.test = true; __pw.select(s); }, species);
  await p.waitForTimeout(300);
  await p.evaluate(() => __pw.startMatch());
  await p.mouse.click(w / 2, h / 2);
  await p.waitForTimeout(200);
  return { b, p, errs };
}
