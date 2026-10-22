// Close-up of every legged animal at the countdown, for checking that legs meet the body.
// node tools/legs.mjs [tag]  -> .audit/shots/legs/<tag>-<id>.png
import { launch } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const tag = process.argv[2] || 'now';
const PITCH = Number(process.argv[3] ?? 0.12); // camera pitch; negative looks up from below. argv[4]: comma-separated species ids
const IDS = (process.argv[4] || 'gans,nilgans,schwan,kormoran,ente,taube,kraehe,elster,sittich,nutria').split(',');
mkdirSync('.audit/shots/legs', { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://localhost:5199/');
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#ui { display: none !important; }' });
// countdown freezes everyone; a three-quarter rear camera (the default play view) shows where legs meet the torso
for (const id of IDS) {
  const box = await page.evaluate(async ([id, PITCH]) => {
    __pw.app.test = true; __pw.select(id); __pw.startMatch();
    await new Promise(r => setTimeout(r, 400));
    const p = __pw.game.player;
    __pw.cam.yaw = p.yaw + 0.7; __pw.cam.pitch = PITCH;
    await new Promise(r => setTimeout(r, 500));
    const v = p.pos.clone(); v.y += p.model.height * 0.4; v.project(__pw.camera);
    const top = p.pos.clone(); top.y += p.model.height; top.project(__pw.camera);
    const half = Math.abs(top.y - v.y) * 0.5 * innerHeight * 1.4;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, half };
  }, [id, PITCH]);
  await page.screenshot({ path: `.audit/shots/legs/${tag}-${id}.png`, clip: { x: box.x - box.half, y: box.y - box.half, width: box.half * 2, height: box.half * 2 } });
}
console.log(errors.length ? errors : 'no page errors');
await browser.close();
