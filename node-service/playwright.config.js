import { defineConfig, devices } from '@playwright/test';

// Browser smoke test lives in e2e/ (kept out of test/ so `npm test`'s node:test
// runner never tries to execute Playwright specs).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Let the page's AudioContext start without a user gesture so the streaming
      // playback path (decode -> schedule -> onended) actually advances headless.
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
});
