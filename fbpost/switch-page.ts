import { chromium, Page } from '@playwright/test';
import path from 'path';

const PROFILE_DIR = path.resolve('./fbpost/.browser-profile');
const PAGE_NAME = 'Đảo Bánh Quy';

async function openProfileMenu(page: Page): Promise<boolean> {
  console.log('\n========================================');
  console.log('🔵 MỞ MENU PROFILE');
  console.log('========================================');

  const selectors = [
    '[aria-label="Your profile"]',
    '[aria-label="Account"]',
    '[aria-label*="profile" i]',
    '[aria-label*="account" i]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();

    if (await locator.count() === 0) {
      continue;
    }

    try {
      await locator.click({ timeout: 3000 });
      console.log(`✅ Đã mở menu bằng selector: ${selector}`);

      await page.waitForTimeout(1500);
      return true;
    } catch {
      // Thử selector tiếp theo
    }
  }

  console.log('❌ Không tìm thấy nút Profile/Account.');

  return false;
}

async function openSelectProfile(page: Page): Promise<boolean> {
  console.log('\n========================================');
  console.log('🔵 MỞ SELECT PROFILE');
  console.log('========================================');

  const seeAllProfiles = page.getByText('See all profiles', {
    exact: true,
  });

  const count = await seeAllProfiles.count();

  console.log(`🔎 "See all profiles": ${count}`);

  if (count === 0) {
    console.log(
      'ℹ️ Facebook có thể đã mở sẵn Select profile.'
    );

    return true;
  }

  try {
    await seeAllProfiles.last().click({
      timeout: 5000,
    });

    console.log('✅ Đã click "See all profiles".');

    await page.waitForTimeout(1500);

    return true;
  } catch (error) {
    console.log('⚠️ Không click được "See all profiles".');
    console.error(error);

    return false;
  }
}

async function switchToPage(page: Page): Promise<boolean> {
  console.log('\n========================================');
  console.log(`🔵 CHỌN PAGE: ${PAGE_NAME}`);
  console.log('========================================');

  /*
   * Trên Facebook của bạn hiện tại:
   *
   * nth(0) = Đảo Bánh Quy cá nhân
   * nth(1) = Đảo Bánh Quy Page
   *
   * Vì hai cái cùng tên nên phải chọn nth(1).
   */

  const pageNames = page.getByText(PAGE_NAME, {
    exact: true,
  });

  const count = await pageNames.count();

  console.log(
    `🔎 Tìm thấy ${count} phần tử tên "${PAGE_NAME}".`
  );

  if (count < 2) {
    console.log(
      '❌ Không tìm thấy đủ 2 phần tử để xác định Page.'
    );

    const bodyText = await page.locator('body').innerText();

    console.log('\n========== FACEBOOK TEXT ==========');
    console.log(bodyText.substring(0, 5000));
    console.log('===================================\n');

    return false;
  }

  const pageOption = pageNames.nth(1);

  console.log('✅ Đã xác định Page là phần tử thứ 2.');

  await pageOption.scrollIntoViewIfNeeded();

  await page.waitForTimeout(500);

  const box = await pageOption.boundingBox();

  if (!box) {
    console.log('❌ Không lấy được vị trí của Page.');

    return false;
  }

  console.log(
    `📍 Page position: ` +
    `x=${Math.round(box.x)}, ` +
    `y=${Math.round(box.y)}, ` +
    `w=${Math.round(box.width)}, ` +
    `h=${Math.round(box.height)}`
  );

  /*
   * Không dùng locator.click().
   *
   * Facebook profile switcher là component động,
   * nên click bằng mouse vào chính vị trí text
   * ổn định hơn.
   */

  const clickX = box.x + box.width / 2;
  const clickY = box.y + box.height / 2;

  console.log(
    `👉 Đang click tại x=${Math.round(clickX)}, ` +
    `y=${Math.round(clickY)}...`
  );

  await page.mouse.click(clickX, clickY);

  console.log('✅ Đã gửi click.');

  console.log('⏳ Chờ Facebook chuyển sang Page...');

  await page.waitForTimeout(5000);

  return true;
}

async function verifyPage(page: Page): Promise<boolean> {
  console.log('\n========================================');
  console.log('🔍 KIỂM TRA PAGE');
  console.log('========================================');

  await page.waitForTimeout(2000);

  const url = page.url();

  console.log(`🌐 URL hiện tại: ${url}`);

  const bodyText = await page.locator('body').innerText();

  /*
   * Sau khi switch thành công,
   * Facebook của bạn đang hiển thị:
   *
   * "What's on your mind, Đảo Bánh Quy?"
   */

  const pageComposer = `What's on your mind, ${PAGE_NAME}`;

  if (bodyText.includes(pageComposer)) {
    console.log('\n========================================');
    console.log('🎉 SWITCH PAGE THÀNH CÔNG!');
    console.log(`📄 Page: ${PAGE_NAME}`);
    console.log('========================================');

    return true;
  }

  /*
   * Facebook đôi khi dùng text khác tùy giao diện.
   * Kiểm tra thêm tên Page trong phần composer.
   */

  if (
    bodyText.includes(PAGE_NAME) &&
    !bodyText.includes('Sign in')
  ) {
    console.log('\n⚠️ Có vẻ đã chuyển Page.');
    console.log(`📄 Đang thấy tên: ${PAGE_NAME}`);
    console.log(
      '👉 Không xác nhận được tuyệt đối bằng composer.'
    );

    return true;
  }

  console.log('\n❌ Chưa xác nhận được Page.');

  console.log('\n========== TEXT HIỆN TẠI ==========');
  console.log(bodyText.substring(0, 3000));
  console.log('===================================\n');

  return false;
}

async function waitForManualLogin(page: Page): Promise<void> {
  const url = page.url();

  if (
    url.includes('/login') ||
    url.includes('/checkpoint') ||
    url.includes('/two_step_verification')
  ) {
    console.log('\n========================================');
    console.log('⚠️ FACEBOOK ĐANG YÊU CẦU LOGIN/XÁC MINH');
    console.log('========================================');

    console.log(
      '👉 Hãy xử lý login/CAPTCHA trên cửa sổ Facebook.'
    );

    console.log(
      '👉 Sau khi vào được Facebook, nhấn ENTER trong Terminal.'
    );

    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });

    await page.waitForTimeout(3000);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('🚀 FACEBOOK SWITCH PAGE');
  console.log('========================================');

  console.log(`📁 Profile: ${PROFILE_DIR}`);
  console.log(`📄 Target Page: ${PAGE_NAME}`);

  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: false,

      viewport: null,

      args: [
        '--disable-blink-features=AutomationControlled',
      ],
    }
  );

  let page: Page;

  if (context.pages().length > 0) {
    page = context.pages()[0];
  } else {
    page = await context.newPage();
  }

  try {
    console.log('\n🌐 Mở Facebook...');

    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    console.log(`🌐 URL: ${page.url()}`);

    await waitForManualLogin(page);

    console.log('\n⏳ Đợi Facebook tải...');

    await page.waitForTimeout(3000);

    /*
     * Bước 1:
     * Mở menu avatar.
     */

    const menuOpened = await openProfileMenu(page);

    if (!menuOpened) {
      console.log(
        '\n❌ Không mở được menu Profile.'
      );

      console.log(
        '👉 Bạn có thể mở menu bằng tay để kiểm tra.'
      );

      await page.pause();
      return;
    }

    /*
     * Bước 2:
     * Mở Select profile nếu cần.
     */

    const selectProfileOpened =
      await openSelectProfile(page);

    if (!selectProfileOpened) {
      console.log(
        '\n❌ Không mở được Select profile.'
      );

      await page.pause();
      return;
    }

    await page.waitForTimeout(1000);

    /*
     * Bước 3:
     * Chọn Page.
     */

    const switched = await switchToPage(page);

    if (!switched) {
      console.log(
        '\n❌ Không switch được sang Page.'
      );

      await page.pause();
      return;
    }

    /*
     * Bước 4:
     * Kiểm tra.
     */

    const verified = await verifyPage(page);

    if (verified) {
      console.log('\n========================================');
      console.log('🟢 HOÀN TẤT');
      console.log(`🟢 Đang dùng Page: ${PAGE_NAME}`);
      console.log('========================================');
    } else {
      console.log('\n⚠️ Click đã thực hiện nhưng chưa xác minh được.');
    }

    console.log(
      '\nBrowser sẽ được giữ mở.'
    );

    console.log(
      'Bạn có thể kiểm tra Facebook bằng mắt.'
    );

    await page.pause();

  } catch (error) {
    console.log('\n========================================');
    console.log('❌ CÓ LỖI');
    console.log('========================================');

    console.error(error);

    await page.pause();

  } finally {
    /*
     * Cố tình không đóng browser/context.
     * Giữ session Facebook mở để kiểm tra.
     */
  }
}

main();