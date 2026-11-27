import { chromium } from 'playwright-core';

const webglArgs = process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : [];

export function launch({ args = [] } = {}) {
  return chromium.launch({
    channel: 'chromium',
    executablePath: process.env.CHROME || undefined,
    headless: true,
    args: [...webglArgs, '--autoplay-policy=no-user-gesture-required', ...args],
  });
}
