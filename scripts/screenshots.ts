// Capture screenshots of running pages (visual verification).
//   npm run shots -- models            → every unit + asset at 2 yaws into .shots/models
//   npm run shots -- /path out.png ... → arbitrary pages
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = path.resolve('.shots');

async function launch(): Promise<Browser> {
  const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  try {
    return await chromium.launch({ channel: 'chrome', args });
  } catch {
    return await chromium.launch({ args });
  }
}

async function capture(browser: Browser, url: string, file: string, waitReady = true): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  if (waitReady) await page.waitForFunction(() => (window as unknown as { __viewerReady?: boolean }).__viewerReady === true, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  if (errors.length) console.warn(`  ! ${url}\n    ${errors.join('\n    ')}`);
  await page.close();
}

async function main() {
  const argv = process.argv.slice(2);
  const browser = await launch();
  try {
    if (argv[0] === 'models') {
      const res = await fetch(`${BASE}/api/config`);
      const bundle = (await res.json()) as { units: { id: string }[]; assets: { id: string; kind: string }[] };
      const only = argv[1];
      const targets = [
        ...bundle.units.map((u) => ({ q: `unit=${u.id}`, name: `unit-${u.id}` })),
        ...bundle.assets.filter((a) => !['humanoid', 'horse', 'elephant', 'dragon', 'bird', 'catapult'].includes(a.kind)).map((a) => ({ q: `asset=${a.id}`, name: `asset-${a.id}` })),
      ].filter((t) => !only || t.name.includes(only));
      for (const t of targets) {
        for (const yaw of [30, 200]) {
          const file = path.join(OUT, 'models', `${t.name}-${yaw}.png`);
          await capture(browser, `/models?${t.q}&yaw=${yaw}&bare=1&anim=${argv[2] ?? 'idle'}`, file);
          console.log('shot', file);
        }
      }
    } else {
      for (let i = 0; i < argv.length; i += 2) {
        const file = path.resolve(argv[i + 1] ?? path.join(OUT, `shot-${i / 2}.png`));
        await capture(browser, argv[i], file, false);
        console.log('shot', file);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
