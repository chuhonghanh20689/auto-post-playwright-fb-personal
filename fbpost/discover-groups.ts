import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function main() {
  const PROFILE_DIR = path.resolve('./fbpost/.browser-profile');
  const OUTPUT_FILE = path.resolve('./fbpost/data/groups.json');

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

  console.log('\n========================================');
  console.log('   FACEBOOK GROUP DISCOVERY');
  console.log('========================================\n');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  try {
    // Trang "Groups you've joined"
    await page.goto(
      'https://www.facebook.com/groups/joins/?nav_source=tab',
      {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      }
    );

    console.log('✅ Đã mở danh sách Groups');
    await page.waitForTimeout(5000);

    // Facebook báo tổng số group
    const bodyText = await page.locator('body').innerText();

    const totalMatch = bodyText.match(
      /All groups you've joined\s*\(([\d,]+)\)/
    );

    const expectedTotal = totalMatch
      ? parseInt(totalMatch[1].replace(/,/g, ''), 10)
      : null;

    if (expectedTotal) {
      console.log(`📊 Facebook báo có: ${expectedTotal} groups`);
    } else {
      console.log('⚠️ Không đọc được tổng số group từ trang.');
    }

    console.log('\n🔄 Bắt đầu scroll để load toàn bộ groups...\n');

    const groups = new Map<string, {
      name: string;
      url: string;
    }>();

    let previousCount = 0;
    let noChangeCount = 0;

    for (let round = 1; round <= 300; round++) {

      // Lấy tất cả link group hiện đang có trong DOM
      const links = await page.locator('a[href*="/groups/"]').evaluateAll(
        (elements) => {
          return elements.map((element) => {
            const anchor = element as HTMLAnchorElement;

            return {
              name: (anchor.textContent || '')
                .replace(/\s+/g, ' ')
                .trim(),

              url: anchor.href,
            };
          });
        }
      );

      // Lọc URL group dạng:
      // https://www.facebook.com/groups/123456789/
      for (const item of links) {
        let url = item.url
          .split('?')[0]
          .split('#')[0];

        // Bỏ slash cuối rồi thêm lại
        url = url.replace(/\/$/, '') + '/';

        const isRealGroup =
          /^https:\/\/www\.facebook\.com\/groups\/[^/]+\/$/.test(url);

        if (!isRealGroup) {
          continue;
        }

        // Bỏ các trang hệ thống
        const ignored = [
          'https://www.facebook.com/groups/feed/',
          'https://www.facebook.com/groups/discover/',
          'https://www.facebook.com/groups/joins/',
          'https://www.facebook.com/groups/',
        ];

        if (ignored.includes(url)) {
          continue;
        }

        groups.set(url, {
          name: item.name,
          url,
        });
      }

      const currentCount = groups.size;

      console.log(
        `🔄 Scroll ${round}: đã thu thập ${currentCount}` +
        (expectedTotal ? ` / ${expectedTotal}` : '')
      );

      // Nếu đạt đủ số Facebook báo
      if (expectedTotal && currentCount >= expectedTotal) {
        console.log('\n🎉 Đã thu thập đủ số group Facebook báo.');
        break;
      }

      // Kiểm tra có group mới không
      if (currentCount === previousCount) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
      }

      previousCount = currentCount;

      /*
       * Scroll xuống rất mạnh.
       * Facebook sẽ lazy-load thêm group.
       */
      await page.mouse.wheel(0, 1800);

      await page.waitForTimeout(1200);

      /*
       * Nếu không có group mới trong nhiều vòng liên tiếp,
       * thử scroll thêm bằng JS.
       */
      if (noChangeCount >= 5) {
        console.log(
          '⚠️ 5 vòng chưa có group mới → scroll mạnh hơn...'
        );

        await page.evaluate(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth',
          });
        });

        await page.waitForTimeout(2500);
        noChangeCount = 0;
      }

      /*
       * Nếu vẫn không tăng sau rất nhiều vòng,
       * coi như Facebook đã hết dữ liệu.
       */
      if (round >= 300) {
        console.log('\n⚠️ Đã đạt giới hạn 300 vòng scroll.');
        break;
      }
    }

    const finalGroups = Array.from(groups.values());

    // Lưu file
    fs.writeFileSync(
      OUTPUT_FILE,
      JSON.stringify(finalGroups, null, 2),
      'utf8'
    );

    console.log('\n========================================');
    console.log('             KẾT QUẢ');
    console.log('========================================');
    console.log(`Facebook báo: ${expectedTotal ?? 'không rõ'}`);
    console.log(`Đã lấy được:  ${finalGroups.length}`);
    console.log(`File: ${OUTPUT_FILE}`);
    console.log('========================================\n');

    if (
      expectedTotal &&
      finalGroups.length < expectedTotal
    ) {
      console.log(
        `⚠️ Còn thiếu khoảng ${
          expectedTotal - finalGroups.length
        } groups.`
      );

      console.log(
        'Facebook có thể đang lazy-load hoặc virtualize danh sách.'
      );
    }

    console.log('\n🟢 Browser vẫn mở.');
    console.log('🟢 Nhấn Ctrl+C để kết thúc.\n');

    await new Promise<void>(() => {});

  } catch (error) {
    console.error('\n❌ Lỗi:', error);
    console.log('\nBrowser vẫn được giữ mở.');
    await new Promise<void>(() => {});
  }
}

main();