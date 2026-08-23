import { chromium } from 'playwright';

const GROUP_URL = 'DÁN_LINK_GROUP_CỦA_BẠN_VÀO_ĐÂY';

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

  await page.goto(GROUP_URL, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForTimeout(5000);

  console.log('Current URL:', page.url());
  console.log('Group đã mở.');

  // Giữ browser mở
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});