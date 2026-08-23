import { chromium } from 'playwright';

async function main() {
  const context = await chromium.launchPersistentContext(
    './fbpost/.browser-profile',
    {
      headless: false,
      viewport: null,
    }
  );

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForTimeout(5000);

  console.log('Facebook URL:', page.url());
  console.log('Browser đang mở. Nhấn Ctrl+C trong terminal để đóng.');

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});