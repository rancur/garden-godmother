import puppeteer from 'puppeteer';

const SESSION = process.argv[2];
if (!SESSION) {
  console.error('Usage: node screenshots.mjs <session_cookie>');
  process.exit(1);
}

const BASE = 'https://garden.yourdomain.com';
const OUT = new URL('../docs/screenshots', import.meta.url).pathname;

const pages = [
  { name: 'login', path: '/login', noAuth: true },
  { name: 'dashboard', path: '/' },
  { name: 'map', path: '/map' },
  { name: 'planters', path: '/planters' },
  { name: 'planter-detail', path: '/planters/1' },
  { name: 'plants', path: '/plants' },
  { name: 'tasks', path: '/tasks' },
  { name: 'calendar', path: '/calendar' },
  { name: 'ground-plants', path: '/ground-plants' },
  { name: 'settings', path: '/settings' },
];

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });

  for (const page of pages) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 800 });

    if (!page.noAuth) {
      await p.setCookie({
        name: 'ggm_session',
        value: SESSION,
        domain: '.yourdomain.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    }

    await p.goto(`${BASE}${page.path}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    await p.screenshot({ path: `${OUT}/${page.name}.png`, fullPage: false });
    console.log(`Done: ${page.name}.png`);
    await p.close();
  }

  await browser.close();
  console.log('All screenshots complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
