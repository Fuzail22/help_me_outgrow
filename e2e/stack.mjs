/**
 * Starts the whole first cut on localhost for end-to-end tests and demos:
 *   mock push service (HTTPS) · notification platform · help_me_outgrow api · web app
 *
 * The platform is a separate repository; point NS_REPO at a checkout of it
 * (default: ../../notification-service). Everything runs with throwaway
 * keys, an in-memory store and the dev login; nothing here is production config.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const HMO = resolve(here, '..');
const NS = resolve(process.env.NS_REPO ?? join(HMO, '..', 'notification-service'));
export const PORTS = { platform: 8080, api: 8787, app: 5173 };
export const APP = `http://localhost:${PORTS.app}`;
export const PLATFORM = `http://localhost:${PORTS.platform}`;

async function waitFor(url, ok = (r) => r.status < 500, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (ok(await fetch(url))) return; } catch { /* not up yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function startStack({ quiet = true } = {}) {
  const { startMockPushService } = await import(pathToFileURL(join(NS, 'tools', 'mock-push-service.mjs')).href);
  const push = await startMockPushService();
  const dir = mkdtempSync(join(tmpdir(), 'hmo-e2e-'));
  const procs = [];
  const logs = [];
  const run = (name, cmd, args, cwd, env) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const sink = (b) => { logs.push(`[${name}] ${b}`); if (!quiet) process.stderr.write(`[${name}] ${b}`); };
    p.stdout.on('data', sink); p.stderr.on('data', sink);
    procs.push(p); return p;
  };
  const stop = async () => { for (const p of procs) p.kill('SIGTERM'); await push.close(); rmSync(dir, { recursive: true, force: true }); };

  try {
    const platformEnv = {
      PORT: String(PORTS.platform), APP_ENV: 'test', MEMORY_STORE_FILE: join(dir, 'platform.json'),
      JWT_SECRET: randomBytes(32).toString('hex'), KEY_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      VAPID_SUBJECT: 'mailto:dev@localhost.invalid', PUBLIC_API_URL: PLATFORM, ENABLE_DEV_ENDPOINTS: '1',
      PUSH_EXTRA_CA_FILE: push.caFile, PUSH_EXTRA_HOSTS: 'localhost', RATE_LIMIT_PER_MINUTE: '0',
    };
    const tsx = join(NS, 'server', 'node_modules', '.bin', 'tsx');
    // 1. Tenant with its own VAPID pair and keys, exactly as an operator would create it.
    const tenant = JSON.parse(execFileSync(tsx, ['scripts/bootstrap-tenant.ts', '--name', 'help me outgrow', '--slug', 'hmo', '--origin', APP,
      '--click-url', `${APP}/n/{deliveryId}?t={token}`, '--icon', '/icons/192.png', '--privileged'], { cwd: join(NS, 'server'), env: { ...process.env, ...platformEnv }, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    // 2. Platform.
    run('platform', tsx, ['src/index.ts'], join(NS, 'server'), platformEnv);
    await waitFor(`${PLATFORM}/healthz`);
    // 3. Seed the four topics through the public API.
    execFileSync('node', ['content/seed.mjs'], { cwd: HMO, env: { ...process.env, PLATFORM_API_URL: PLATFORM, PLATFORM_SECRET_KEY: tenant.secretKey }, stdio: 'ignore' });
    // 4. Thin backend.
    run('api', join(HMO, 'api', 'node_modules', '.bin', 'tsx'), ['src/index.ts'], join(HMO, 'api'), {
      PORT: String(PORTS.api), SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: APP, PLATFORM_API_URL: PLATFORM,
      PLATFORM_SECRET_KEY: tenant.secretKey, DEV_LOGIN: '1', ADMIN_OWNER_EMAIL: 'owner@dev.invalid', PUBLIC_URL: `http://localhost:${PORTS.api}`,
      ...(process.env.HMO_API_EXTRA_ENV ? JSON.parse(process.env.HMO_API_EXTRA_ENV) : {}),
    });
    await waitFor(`http://localhost:${PORTS.api}/auth/healthz`);
    // 5. Web app: a production build, served by vite preview.
    const clientEnv = { VITE_PLATFORM_API_URL: PLATFORM, VITE_PUBLISHABLE_KEY: tenant.publishableKey, VITE_DEV_LOGIN: '1' };
    execFileSync('npm', ['run', 'build'], { cwd: join(HMO, 'client'), env: { ...process.env, ...clientEnv }, stdio: 'ignore' });
    run('app', join(HMO, 'client', 'node_modules', '.bin', 'vite'), ['preview'], join(HMO, 'client'), clientEnv);
    await waitFor(APP);

    const secret = { authorization: `Bearer ${tenant.secretKey}` };
    return {
      tenant, push, logs, stop,
      /** Run one scheduler pass as if the time were `at` (ISO), and wait for the sends to finish. */
      tick: async (at) => (await fetch(`${PLATFORM}/__dev/tick${at ? `?at=${encodeURIComponent(at)}` : ''}`, { method: 'POST' })).json(),
      stats: async () => (await fetch(`${PLATFORM}/v1/stats`, { headers: secret })).json(),
    };
  } catch (e) { await stop(); console.error(logs.join('')); throw e; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startStack({ quiet: false });
  console.log(`\nApp: ${APP}\nPlatform: ${PLATFORM}\nPublishable key: ${s.tenant.publishableKey}\nSecret key: ${s.tenant.secretKey}\nCtrl-C to stop.`);
  process.on('SIGINT', async () => { await s.stop(); process.exit(0); });
}
