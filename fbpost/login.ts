import { chromium } from 'playwright';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const username = process.env.FB_USERNAME;
const password = process.env.FB_PASSWORD;

if (!username || !password) {
  throw new Error(
    'Không tìm thấy FB_USERNAME hoặc FB_PASSWORD trong file .env'
  );
}

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      '\nFacebook đang yêu cầu bạn xác minh. Xử lý xong rồi nhấn ENTER...\n',
      () => {
        rl.close();
        resolve();
      }
    );
  });
}

async function main() {
  const context = await chromium.launchPersistentContext(
    './fbpost/.browser-profile',
    {
      headless: false,
      viewport: null,
    }
  );

  const page =
    context.pages().length > 0
      ? context.pages()[0]
      : await context.newPage();

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
  });

  // Nếu profile đã đăng nhập thì không login lại
  const loginForm = page.locator('input[name="email"]');

  if (await loginForm.isVisible().catch(() => false)) {
    console.log('Facebook chưa đăng nhập. Đang tự điền tài khoản...');

    await page.locator('input[name="email"]').fill(username);
    await page.locator('input[name="pass"]').fill(password);

    await page.getByRole('button', { name: /log in/i }).click();

    console.log('Đã gửi thông tin đăng nhập.');
  } else {
    console.log('Facebook có vẻ đã đăng nhập. Không login lại.');
  }

  // Chờ Facebook xử lý
  await page.waitForTimeout(5000);

  const currentUrl = page.url();

  console.log('\nURL hiện tại:');
  console.log(currentUrl);

  // Nếu Facebook đưa tới bước xác minh thì dừng để người dùng xử lý
  if (
    currentUrl.includes('checkpoint') ||
    currentUrl.includes('two_step') ||
    currentUrl.includes('login')
  ) {
    console.log('\nFacebook đang yêu cầu xác minh.');
    await waitForEnter();
  }

  console.log('\n====================================');
  console.log('Facebook session đang được giữ lại.');
  console.log('Profile: ./fbpost/.browser-profile');
  console.log('====================================');

  // Giữ browser mở
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});