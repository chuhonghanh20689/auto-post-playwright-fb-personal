import { chromium, BrowserContext, Locator, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

type Group = {
  name: string;
  url: string;
};

type BlockedGroup = {
  name: string;
  url: string;
  reason: string;
  blockedAt: string;
};

type Caption = {
  keyword: string;
  content: string;
  hashtags: string[];
  fullCaption: string;
};

type BatchPost = {
  index: number;
  groupIndex: number;
  group: Group;
  captionIndex: number;
  caption: Caption;
  images: string[];
};

type DailyBatch = {
  createdAt: string;
  campaign: string;
  campaignName: string;
  imagesPerPost: number;
  startGroupIndex: number;
  endGroupIndex: number;
  posts: BatchPost[];
};

type PostingState = {
  campaign: string;
  nextGroupIndex: number;
  lastPreparedAt: string | null;
  lastPostedAt: string | null;
  totalPosted: number;
};

/* ============================================================
   PATHS
============================================================ */

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const BATCH_FILE = path.join(
  DATA_DIR,
  "daily-batch.json"
);

const BLOCKED_GROUPS_FILE = path.join(
  DATA_DIR,
  "blocked-groups.json"
);

const STATE_FILE = path.join(
  DATA_DIR,
  "posting-state.json"
);

const PROFILE_DIR = path.join(
  ROOT,
  ".browser-profile"
);

/* ============================================================
   SETTINGS
============================================================ */

const TEST_MODE = false;

const MIN_DELAY_BETWEEN_POSTS_MS =
  5 * 60_000;

const MAX_DELAY_BETWEEN_POSTS_MS =
  10 * 60_000;

const ACTION_TIMEOUT = 15_000;

function getRandomPostDelayMs(): number {
  return (
    Math.floor(
      Math.random() *
        (
          MAX_DELAY_BETWEEN_POSTS_MS -
          MIN_DELAY_BETWEEN_POSTS_MS +
          1
        )
    ) +
    MIN_DELAY_BETWEEN_POSTS_MS
  );
}

/* ============================================================
   JSON / STATE HELPERS
============================================================ */

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Không tìm thấy file:\n${file}`
    );
  }

  return JSON.parse(
    fs.readFileSync(file, "utf8")
  ) as T;
}

function writeJson(
  file: string,
  data: unknown
): void {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function loadBlockedGroups(): BlockedGroup[] {
  if (!fs.existsSync(BLOCKED_GROUPS_FILE)) {
    return [];
  }

  const data = readJson<unknown>(
    BLOCKED_GROUPS_FILE
  );

  if (!Array.isArray(data)) {
    throw new Error(
      "blocked-groups.json phải là một mảng."
    );
  }

  return data as BlockedGroup[];
}

function saveBlockedGroups(
  groups: BlockedGroup[]
): void {
  writeJson(
    BLOCKED_GROUPS_FILE,
    groups
  );
}

function addBlockedGroup(
  group: Group,
  reason: string
): void {
  const blocked =
    loadBlockedGroups();

  const existingIndex =
    blocked.findIndex(
      (item) =>
        item.url === group.url
    );

  const record: BlockedGroup = {
    name: group.name,
    url: group.url,
    reason,
    blockedAt:
      new Date().toISOString()
  };

  if (existingIndex >= 0) {
    blocked[existingIndex] =
      record;
  } else {
    blocked.push(record);
  }

  saveBlockedGroups(
    blocked
  );

  console.log(
    `🚫 Đã đưa group vào blocked-groups.json: ${group.name}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(
    (resolve) => setTimeout(resolve, ms)
  );
}

/* ============================================================
   FACEBOOK PAGE HELPERS
============================================================ */

async function waitForFacebook(
  page: Page
): Promise<void> {
  await page
    .waitForLoadState(
      "domcontentloaded",
      { timeout: 30_000 }
    )
    .catch(() => {});
}

async function findVisibleText(
  page: Page,
  patterns: RegExp[]
): Promise<Locator | null> {
  for (const pattern of patterns) {
    const locator =
      page.getByText(pattern).last();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  return null;
}

/* ============================================================
   GROUP POST PERMISSION
============================================================ */

/*
 * Chỉ coi là BLOCK nếu Facebook hiển thị dấu hiệu rõ ràng
 * rằng tài khoản/Page không được phép tạo bài.
 *
 * Timeout / network / load lỗi không tự block group.
 */
async function detectPermanentPostingBlock(
  page: Page
): Promise<string | null> {
  const bodyText =
    await page
      .locator("body")
      .innerText()
      .catch(() => "");

  const normalized =
    bodyText
      .toLowerCase()
      .replace(/\s+/g, " ");

  const blockedPatterns: Array<{
    pattern: RegExp;
    reason: string;
  }> = [
    {
      pattern:
        /you can'?t post in this group/,
      reason:
        "Facebook báo tài khoản/Page không thể đăng bài trong group."
    },
    {
      pattern:
        /you can't post/,
      reason:
        "Facebook báo không được phép đăng bài."
    },
    {
      pattern:
        /only admins can post/,
      reason:
        "Group chỉ cho admin đăng bài."
    },
    {
      pattern:
        /only administrators can post/,
      reason:
        "Group chỉ cho quản trị viên đăng bài."
    },
    {
      pattern:
        /posting in this group is restricted/,
      reason:
        "Group đang hạn chế quyền đăng bài."
    },
    {
      pattern:
        /you don't have permission to post/,
      reason:
        "Tài khoản/Page không có quyền đăng bài."
    },
    {
      pattern:
        /you do not have permission to post/,
      reason:
        "Tài khoản/Page không có quyền đăng bài."
    },
    {
      pattern:
        /this group does not allow pages to post/,
      reason:
        "Group không cho Page đăng bài."
    },
    {
      pattern:
        /pages can't post/,
      reason:
        "Facebook báo Page không thể đăng bài trong group."
    },
    {
      pattern:
        /pages cannot post/,
      reason:
        "Facebook báo Page không thể đăng bài trong group."
    },
    {
      pattern:
        /page.*can't post/,
      reason:
        "Facebook báo Page không thể đăng bài trong group."
    },
    {
      pattern:
        /page.*cannot post/,
      reason:
        "Facebook báo Page không thể đăng bài trong group."
    }
  ];

  for (
    const item of
    blockedPatterns
  ) {
    if (
      item.pattern.test(
        normalized
      )
    ) {
      return item.reason;
    }
  }

  return null;
}

/*
 * Sau khi vào group, chờ trang ổn định rồi:
 * - có composer => OK
 * - có thông báo permission denied rõ ràng => BLOCK
 * - không có cả hai => lỗi tạm thời, KHÔNG block
 */
async function checkGroupPostAccess(
  page: Page
): Promise<
  | {
      status: "allowed";
    }
  | {
      status: "blocked";
      reason: string;
    }
> {
  const explicitBlock =
    await detectPermanentPostingBlock(
      page
    );

  if (explicitBlock) {
    return {
      status: "blocked",
      reason: explicitBlock
    };
  }

  /*
   * Page project:
   * Nếu Facebook không hiện composer, thử lại vài lần.
   * Nếu vẫn không có composer thì coi là group Page không
   * được phép đăng, ghi block và đi tiếp group sau.
   *
   * Điều này phù hợp với project này vì đây là workflow
   * dành riêng cho Page Đảo Bánh Quy.
   */
  for (let attempt = 1; attempt <= 3; attempt++) {
    const composer =
      await findComposer(page);

    if (composer) {
      return {
        status: "allowed"
      };
    }

    if (attempt < 3) {
      console.log(
        `⚠️ Chưa thấy Create post — kiểm tra lại (${attempt}/2)...`
      );

      await page.waitForTimeout(
        1_500
      );
    }
  }

  return {
    status: "blocked",
    reason:
      "Không tìm thấy Create post/composer sau nhiều lần kiểm tra; coi là Page không có quyền đăng trong group."
  };
}

/*
 * Một số lỗi xảy ra khi mở composer cũng là dấu hiệu Page
 * không được phép đăng. Không để chúng rơi vào catch chung
 * rồi dừng toàn chương trình.
 */
function isBlockedLikeError(
  error: unknown
): boolean {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const normalized =
    message.toLowerCase();

  return (
    normalized.includes(
      "không tìm thấy ô tạo bài viết"
    ) ||
    normalized.includes(
      "page không được phép đăng"
    ) ||
    normalized.includes(
      "không tìm thấy create post"
    )
  );
}

/* ============================================================
   COMPOSER
============================================================ */

async function findComposer(
  page: Page
): Promise<Locator | null> {
  const exactTexts = [
    "Write something...",
    "Create a post",
    "Tạo bài viết",
    "Bạn đang nghĩ gì",
  ];

  for (const text of exactTexts) {
    const locator =
      page.getByText(
        text,
        { exact: true }
      ).first();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  const selectors = [
    '[aria-label*="Create a post"]',
    '[aria-label*="Tạo bài viết"]',
    '[aria-label*="Bạn đang nghĩ gì"]',
    '[role="button"]:has-text("Write something")',
    "[role=\"button\"]:has-text(\"What's on your mind\")",
    '[role="button"]:has-text("Bạn đang nghĩ gì")',
  ];

  for (const selector of selectors) {
    const locator =
      page.locator(selector).first();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  return null;
}

async function openComposer(
  page: Page
): Promise<void> {
  const composer =
    await findComposer(page);

  if (!composer) {
    throw new Error(
      "Không tìm thấy ô tạo bài viết."
    );
  }

  await composer.click();

  await page.waitForTimeout(
    1_500
  );
}

/* ============================================================
   CAPTION
============================================================ */

async function findPostTextbox(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'div[role="textbox"]',
    "textarea",
  ];

  for (const selector of selectors) {
    const locator =
      page.locator(selector).last();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  return null;
}

async function fillCaption(
  page: Page,
  caption: string
): Promise<void> {
  const textbox =
    await findPostTextbox(page);

  if (!textbox) {
    throw new Error(
      "Không tìm thấy ô nhập caption."
    );
  }

  await textbox.click();
  await textbox.fill(caption);

  await page.waitForTimeout(
    700
  );
}

/*
 * Facebook có thể mở dropdown đề xuất Page khi gõ.
 * Ưu tiên click tiêu đề "Create post" / "Tạo bài viết"
 * để đóng dropdown; Escape là fallback.
 */
async function dismissComposerSuggestions(
  page: Page
): Promise<void> {
  const titleCandidates = [
    page.getByText(
      "Create post",
      { exact: true }
    ).last(),
    page.getByText(
      "Tạo bài viết",
      { exact: true }
    ).last(),
  ];

  for (const locator of titleCandidates) {
    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      await locator.click().catch(() => {});
      await page.waitForTimeout(600);
      return;
    }
  }

  await page.keyboard
    .press("Escape")
    .catch(() => {});

  await page.waitForTimeout(600);
}

/* ============================================================
   PHOTO / VIDEO
============================================================ */

async function findPhotoVideoButton(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label*="Photo/video"]',
    '[aria-label*="Photo / video"]',
    '[aria-label*="Ảnh/video"]',
    '[aria-label*="Ảnh / video"]',
  ];

  for (const selector of selectors) {
    const locator =
      page.locator(selector).last();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  const textPatterns = [
    /Photo\/video/i,
    /Ảnh\/video/i,
  ];

  const textLocator =
    await findVisibleText(
      page,
      textPatterns
    );

  if (textLocator) {
    return textLocator;
  }

  return null;
}

/*
 * Upload TOÀN BỘ 8 ảnh của một bài bằng một lần chọn file.
 * Playwright filechooser.setFiles() nhận được mảng path.
 */
async function uploadImages(
  page: Page,
  imagePaths: string[]
): Promise<void> {
  if (imagePaths.length === 0) {
    throw new Error(
      "Bài này không có ảnh."
    );
  }

  for (const imagePath of imagePaths) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(
        `Không tìm thấy ảnh:\n${imagePath}`
      );
    }
  }

  console.log(
    `🖼️ Upload ${imagePaths.length} ảnh...`
  );

  const button =
    await findPhotoVideoButton(page);

  if (!button) {
    throw new Error(
      "Không tìm thấy nút Photo/video."
    );
  }

  /*
   * Quan trọng:
   * bắt filechooser TRƯỚC khi click nút.
   */
  const chooserPromise =
    page
      .waitForEvent(
        "filechooser",
        {
          timeout: ACTION_TIMEOUT,
        }
      )
      .catch(() => null);

  await button.click({
    timeout: ACTION_TIMEOUT,
  });

  const chooser =
    await chooserPromise;

  if (chooser) {
    await chooser.setFiles(
      imagePaths
    );

    console.log(
      `✅ Đã gửi ${imagePaths.length} ảnh vào file chooser.`
    );

    await page.waitForTimeout(
      5_000
    );

    return;
  }

  /*
   * Fallback nếu Facebook không phát filechooser.
   */
  await page.waitForTimeout(700);

  const inputs =
    page.locator(
      'input[type="file"]'
    );

  const inputCount =
    await inputs.count();

  if (inputCount > 0) {
    await inputs
      .last()
      .setInputFiles(
        imagePaths
      );

    console.log(
      `✅ Đã gửi ${imagePaths.length} ảnh qua input[type=file].`
    );

    await page.waitForTimeout(
      5_000
    );

    return;
  }

  throw new Error(
    "Facebook không mở file picker/file input để upload ảnh."
  );
}

/* ============================================================
   POST BUTTON
============================================================ */

async function findPostButton(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Post"]',
    '[aria-label="Đăng"]',
    'div[role="button"]:has-text("Post")',
    'div[role="button"]:has-text("Đăng")',
  ];

  for (const selector of selectors) {
    const locator =
      page.locator(selector).last();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  return null;
}

async function publishPost(
  page: Page
): Promise<void> {
  const button =
    await findPostButton(page);

  if (!button) {
    throw new Error(
      "Không tìm thấy nút Post/Đăng."
    );
  }

  await button.click();

  await page.waitForTimeout(
    5_000
  );
}

/* ============================================================
   ONE POST
============================================================ */

async function postOne(
  page: Page,
  item: BatchPost
): Promise<{
  success: boolean;
  testStopped: boolean;
  blocked: boolean;
}> {
  console.log(
    "\n------------------------------------------"
  );

  console.log(
    `📝 Bài ${item.index}`
  );

  console.log(
    `👥 Group ${item.groupIndex + 1}`
  );

  console.log(
    `🔗 ${item.group.url}`
  );

  console.log(
    `🖼️ ${item.images.length} ảnh`
  );

  item.images.forEach(
    (image, index) => {
      console.log(
        `   ${index + 1}. ${path.basename(image)}`
      );
    }
  );

  /*
   * 1. Vào group
   */
  await page.goto(
    item.group.url,
    {
      waitUntil:
        "domcontentloaded",
      timeout: 45_000,
    }
  );

  await waitForFacebook(page);

  await page.waitForTimeout(
    3_000
  );

  /*
   * 2. Kiểm tra quyền đăng bài trong group.
   */
  const access =
    await checkGroupPostAccess(
      page
    );

  if (
    access.status === "blocked"
  ) {
    console.log(
      `🚫 Group bị chặn: ${access.reason}`
    );

    addBlockedGroup(
      item.group,
      access.reason
    );

    return {
      success: false,
      testStopped: false,
      blocked: true
    };
  }

  /*
   * 3. Mở Create post
   */
  await openComposer(page);

  /*
   * 3. Nhập caption
   */
  await fillCaption(
    page,
    item.caption.fullCaption
  );

  /*
   * 4. Đóng popup suggestion
   */
  await dismissComposerSuggestions(
    page
  );

  /*
   * 5. Upload toàn bộ ảnh
   */
  await uploadImages(
    page,
    item.images
  );

  /*
   * 6. Dừng ở test mode
   */
  if (TEST_MODE) {
    console.log(
      "\n🧪 TEST_MODE = true"
    );

    console.log(
      `⏸️ Đã chuẩn bị bài ${item.index} với ${item.images.length} ảnh.`
    );

    console.log(
      "👉 Không tự click Post."
    );

    return {
      success: false,
      testStopped: true,
      blocked: false,
    };
  }

  /*
   * 7. Post thật
   */
  await publishPost(page);

  console.log(
    "✅ Đã click Post."
  );

  return {
    success: true,
    testStopped: false,
    blocked: false,
  };
}

/* ============================================================
   MAIN
============================================================ */

async function main(): Promise<void> {
  console.log(
    "\n=========================================="
  );
  console.log(
    "          FACEBOOK DAILY POSTER"
  );
  console.log(
    "==========================================\n"
  );

  /*
   * 1. Đọc daily-batch.json
   */
  const batch =
    readJson<DailyBatch>(
      BATCH_FILE
    );

  console.log(
    `🎯 Campaign: ${batch.campaignName}`
  );

  console.log(
    `📦 Group ${batch.startGroupIndex + 1} → ${batch.endGroupIndex + 1}`
  );

  console.log(
    `📝 Số bài: ${batch.posts.length}`
  );

  console.log(
    `🖼️ Ảnh / bài: ${batch.imagesPerPost}`
  );

  /*
   * 2. Validate batch MỚI
   *
   * Nếu batch cũ được tạo bằng code 1 ảnh,
   * sẽ dừng ngay và yêu cầu chạy prepare lại.
   */
  if (
    !Number.isInteger(
      batch.imagesPerPost
    ) ||
    batch.imagesPerPost <= 0
  ) {
    throw new Error(
      "daily-batch.json đang là batch cũ hoặc không có imagesPerPost. " +
      "Hãy chạy lại prepare-daily-batch.ts trước."
    );
  }

  if (
    !Array.isArray(
      batch.posts
    ) ||
    batch.posts.length === 0
  ) {
    throw new Error(
      "daily-batch.json không có posts."
    );
  }

  for (const post of batch.posts) {
    if (
      !Array.isArray(post.images)
    ) {
      throw new Error(
        `Bài ${post.index} đang dùng format cũ image:string. ` +
        `Hãy chạy lại prepare-daily-batch.ts.`
      );
    }

    if (
      post.images.length !==
      batch.imagesPerPost
    ) {
      throw new Error(
        `Bài ${post.index} có ${post.images.length} ảnh, ` +
        `nhưng batch yêu cầu ${batch.imagesPerPost}.`
      );
    }
  }

  /*
   * 3. State
   */
  const state =
    readJson<PostingState>(
      STATE_FILE
    );

  if (
    state.campaign !==
    batch.campaign
  ) {
    throw new Error(
      `Campaign state (${state.campaign}) ` +
      `không khớp batch (${batch.campaign}).`
    );
  }

  /*
   * posting-state có thể đang nằm giữa batch nếu chương trình
   * được chạy tiếp sau khi đã đăng một phần batch.
   *
   * Không bắt buộc nextGroupIndex phải bằng startGroupIndex.
   * Thay vào đó, tìm đúng post theo groupIndex thực tế để resume.
   */

  /*
   * 4. Browser
   */
  console.log(
    "\n🌐 Đang mở browser..."
  );

  const context:
    BrowserContext =
    await chromium.launchPersistentContext(
      PROFILE_DIR,
      {
        headless: false,
        viewport: null,
        args: [
          "--start-maximized",
        ],
      }
    );

  const pages =
    context.pages();

  const page =
    pages.length > 0
      ? pages[0]
      : await context.newPage();

  /*
   * 5. Check Facebook session
   */
  await page.goto(
    "https://www.facebook.com/",
    {
      waitUntil:
        "domcontentloaded",
      timeout: 45_000,
    }
  );

  await waitForFacebook(page);

  await page.waitForTimeout(
    2_000
  );

  const loginDetected =
    await page
      .locator(
        'input[name="email"], input[name="pass"]'
      )
      .first()
      .isVisible()
      .catch(() => false);

  if (loginDetected) {
    console.log(
      "\n⚠️ Facebook chưa đăng nhập."
    );

    console.log(
      "👉 Đăng nhập/CAPTCHA bằng tay, sau đó chạy lại."
    );

    await context.close();
    return;
  }

  console.log(
    "✅ Facebook session OK."
  );

  /*
   * 6. Xác định bài cần chạy
   */
  /*
   * 6. Xác định bài cần chạy
   *
   * Resume theo groupIndex thực tế.
   * Không dùng phép trừ:
   *   nextGroupIndex - startGroupIndex
   * vì batch.posts có thể không liên tục.
   */
  const currentIndex =
    batch.posts.findIndex(
      (post) =>
        post.groupIndex ===
        state.nextGroupIndex
    );

  if (currentIndex < 0) {
    /*
     * Nếu state đã vượt quá toàn bộ batch
     * thì batch này đã xử lý xong.
     */
    const remainingPosts =
      batch.posts.filter(
        (post) =>
          post.groupIndex >=
          state.nextGroupIndex
      );

    if (remainingPosts.length === 0) {
      console.log(
        "\nℹ️ Batch này đã được xử lý hết."
      );

      console.log(
        `📌 nextGroupIndex = ${state.nextGroupIndex}`
      );

      console.log(
        `📈 Tổng bài đã đăng: ${state.totalPosted}`
      );

      await context.close();
      return;
    }

    throw new Error(
      `Không tìm thấy group ${state.nextGroupIndex} trong daily-batch.json. ` +
      `Kiểm tra lại batch/state trước khi chạy để tránh đăng nhầm group.`
    );
  }

  console.log(
    `▶️ Bắt đầu từ group ${state.nextGroupIndex + 1} ` +
    `(bài ${currentIndex + 1}/${batch.posts.length})`
  );


  /*
   * 7. Loop
   */
  for (
    let i = currentIndex;
    i < batch.posts.length;
    i++
  ) {
    const item =
      batch.posts[i];

    try {
      const result =
        await postOne(
          page,
          item
        );

      if (
        result.testStopped
      ) {
        console.log(
          "\n🧪 TEST kết thúc."
        );

        console.log(
          "Browser vẫn được giữ mở để bạn kiểm tra."
        );

        await page.pause();
        return;
      }

      /*
       * Nếu group bị block:
       * - không tính là bài đăng thành công;
       * - nhưng vẫn đánh dấu group đã xử lý để
       *   nó không được chọn lại ở lần chạy sau.
       */
      if (
        result.blocked
      ) {
        state.nextGroupIndex =
          item.groupIndex + 1;

        writeJson(
          STATE_FILE,
          state
        );

        console.log(
          `⏭️ Skip group bị block. nextGroupIndex = ${state.nextGroupIndex}`
        );

        /*
         * Không delay 5–10 phút cho một group bị block.
         * Chuyển ngay sang group hợp lệ tiếp theo.
         */
        continue;
      }

      /*
       * Chỉ cập nhật totalPosted sau khi post thành công.
       */
      state.nextGroupIndex =
        item.groupIndex + 1;

      state.totalPosted += 1;

      state.lastPostedAt =
        new Date().toISOString();

      writeJson(
        STATE_FILE,
        state
      );

      console.log(
        `📌 nextGroupIndex = ${state.nextGroupIndex}`
      );

      /*
       * Delay giữa các bài.
       */
      if (
        i <
        batch.posts.length - 1
      ) {
        const delayMs =
          getRandomPostDelayMs();

        const delayMinutes =
          (
            delayMs /
            60_000
          ).toFixed(1);

        console.log(
          `⏳ Chờ khoảng ${delayMinutes} phút trước bài tiếp theo...`
        );

        await sleep(
          delayMs
        );
      }
    } catch (error) {
      /*
       * Nếu lỗi thực chất là Page không có composer/quyền đăng:
       * ghi block + tăng state + tiếp tục group kế tiếp.
       */
      if (
        isBlockedLikeError(error)
      ) {
        const reason =
          error instanceof Error
            ? error.message
            : String(error);

        console.log(
          `🚫 Xác định group bị block: ${reason}`
        );

        addBlockedGroup(
          item.group,
          reason
        );

        state.nextGroupIndex =
          item.groupIndex + 1;

        writeJson(
          STATE_FILE,
          state
        );

        console.log(
          `⏭️ Bỏ qua group ${item.groupIndex + 1}, tiếp tục group kế tiếp.`
        );

        continue;
      }

      /*
       * Các lỗi khác:
       * - Không pause/dừng toàn bộ chương trình.
       * - Ghi nhận group hiện tại là lỗi.
       * - Chuyển sang group kế tiếp.
       */
      console.error(
        `\n❌ Lỗi tại bài ${item.index} - group ${item.groupIndex + 1}`
      );

      console.error(error);

      const reason =
        error instanceof Error
          ? error.message
          : String(error);

      addBlockedGroup(
        item.group,
        `Lỗi khi đăng bài: ${reason}`
      );

      state.nextGroupIndex =
        item.groupIndex + 1;

      writeJson(
        STATE_FILE,
        state
      );

      console.log(
        `⏭️ Bỏ qua group ${item.groupIndex + 1}, tiếp tục group kế tiếp.`
      );

      continue;
    }
  }

  /*
   * 8. Finish
   */
  console.log(
    "\n=========================================="
  );

  console.log(
    "              HOÀN TẤT"
  );

  console.log(
    "=========================================="
  );

  console.log(
    `🎯 Campaign: ${batch.campaignName}`
  );

  console.log(
    `✅ Đã xử lý ${batch.posts.length} group trong batch.`
  );

  console.log(
    `📈 Tổng bài đã đăng: ${state.totalPosted}`
  );

  await context.close();
}

main().catch(
  (error) => {
    console.error(
      "\n❌ FATAL ERROR:\n"
    );

    console.error(error);

    process.exit(1);
  }
);