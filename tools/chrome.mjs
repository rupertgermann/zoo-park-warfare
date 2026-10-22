// Chrome for Testing from playwright's cache, or $CHROME. The flags keep WebGL on the GPU and let audio start without a click.
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';

const exe = process.env.CHROME || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
export const launch = () => chromium.launch({
  executablePath: exe, headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
