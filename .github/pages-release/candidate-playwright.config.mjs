// Trusted test config. Production bundle remains unchanged. No live sync POST.
import path from 'node:path';
const source = path.join(process.env.GITHUB_WORKSPACE, 'source');
export default {
  testDir: path.join(source, 'tests'), fullyParallel: false, forbidOnly: true,
  retries: 0, reporter: 'list', outputDir: path.join(process.env.RUNNER_TEMP, 'candidate-test-results'),
  use: {
    browserName: 'chromium', baseURL: 'http://127.0.0.1:4173',
    viewport: {width: 1280, height: 720}, trace: 'off', serviceWorkers: 'block',
    // External browser HTTP(S), including Worker, cannot reach the network.
    launchOptions: {proxy: {server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost'}},
  },
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4173', cwd: source,
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120000,
  },
  projects: [{name: 'chromium'}],
};
