import { chromium, BrowserContext, Locator, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const FILE_VERSION = "PERSONAL_PROFILE_STORY_PREPOST_SAVE_V5";

type Caption = {
  keyword: string;
  content: string;
  hashtags: string[];
  fullCaption: string;
};

type SavedCaptions = {
  campaign: string;
  generatedAt: string;
  captions: Caption[];
};

type Campaign = {
  name: string;
  imageFolder: string;
  imageCount?: number;
  randomImages?: boolean;
  mainKeyword: string;
  primaryKeywords?: string[];
  productKeywords?: string[];
  audienceKeywords?: string[];
  angles?: string[];
  hashtags?: string[];
  secondaryOccasions?: string[];
  instruction?: string;
};

type PersonalPostingState = {
  campaign: string;
  nextCaptionIndex: number;
};

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CAMPAIGNS_DIR = path.join(ROOT, "campaigns");

const CAPTIONS_FILE = path.join(DATA_DIR, "captions.json");
const STATE_FILE = path.join(
  DATA_DIR,
  "personal-posting-state.json"
);

const CAMPAIGN_CONFIG_FILE = path.join(
  ROOT,
  "config",
  "campaign-config.json"
);
const TEST_MODE = false;
const ACTION_TIMEOUT = 15_000;

/*
 * Cùng profile Facebook đang dùng cho project hiện tại.
 * Không tạo profile/login mới.
 */
const PROFILE_DIR = path.join(
  ROOT,
  ".browser-profile"
);

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(`Không tìm thấy file:\n${file}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}



function shuffle<T>(array: T[]): T[] {
  const result = [...array];

  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() * (i + 1)
      );

    [result[i], result[j]] =
      [result[j], result[i]];
  }

  return result;
}

function getCurrentCampaignName(): string {
  const config =
    readJson<{
      currentCampaign?: string;
      campaign?: string;
      current?: string;
    }>(CAMPAIGN_CONFIG_FILE);

  const campaignName =
    config.currentCampaign ??
    config.campaign ??
    config.current;

  if (
    typeof campaignName === "string" &&
    campaignName.trim()
  ) {
    return campaignName.trim();
  }

  throw new Error(
    "Không xác định được currentCampaign trong campaign-config.json."
  );
}

function loadCampaign(
  campaignName: string
): Campaign {
  const file = path.join(
    CAMPAIGNS_DIR,
    `${campaignName}.json`
  );

  if (!fs.existsSync(file)) {
    throw new Error(
      `Không tìm thấy campaign:\n${file}`
    );
  }

  return readJson<Campaign>(file);
}

function getImages(
  imageFolder: string
): string[] {
  if (!fs.existsSync(imageFolder)) {
    throw new Error(
      `Không tìm thấy imageFolder:\n${imageFolder}`
    );
  }

  const allowedExtensions =
    new Set([
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".bmp"
    ]);

  const files =
    fs
      .readdirSync(imageFolder)
      .filter((file) =>
        allowedExtensions.has(
          path.extname(file).toLowerCase()
        )
      )
      .map((file) =>
        path.join(
          imageFolder,
          file
        )
      );

  if (files.length === 0) {
    throw new Error(
      `Không có ảnh hợp lệ trong:\n${imageFolder}`
    );
  }

  return files;
}

function loadState(
  campaignName: string
): PersonalPostingState {
  if (!fs.existsSync(STATE_FILE)) {
    const initialState: PersonalPostingState = {
      campaign: campaignName,
      nextCaptionIndex: 0
    };

    writeJson(
      STATE_FILE,
      initialState
    );

    return initialState;
  }

  const state =
    readJson<PersonalPostingState>(
      STATE_FILE
    );

  /*
   * Campaign đổi:
   * reset vòng caption về đầu.
   */
  if (
    state.campaign !==
    campaignName
  ) {
    console.log(
      `🔄 Campaign đổi: ${state.campaign || "(trống)"} → ${campaignName}`
    );

    state.campaign =
      campaignName;
    state.nextCaptionIndex = 0;

    writeJson(
      STATE_FILE,
      state
    );

    return state;
  }

  return state;
}

async function waitForFacebook(
  page: Page
): Promise<void> {
  const url =
    page.url().toLowerCase();

  if (
    url.includes("/login") ||
    url.includes("/checkpoint") ||
    url.includes("/two_step_verification")
  ) {
    throw new Error(
      "Facebook chưa ở trạng thái đăng nhập ổn định."
    );
  }

  await page.waitForTimeout(1_500);
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
   PERSONAL PROFILE COMPOSER
============================================================ */

async function findComposer(
  page: Page
): Promise<Locator | null> {
  const exactTexts = [
    "Write something...",
    "Create a post",
    "Tạo bài viết",
    "Bạn đang nghĩ gì",
    "What's on your mind?"
  ];

  for (const text of exactTexts) {
    const locator =
      page
        .getByText(
          text,
          { exact: true }
        )
        .last();

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
    '[aria-label*="What\'s on your mind"]',
    '[role="button"]:has-text("Write something")',
    '[role="button"]:has-text("What\'s on your mind")',
    '[role="button"]:has-text("Bạn đang nghĩ gì")'
  ];

  for (const selector of selectors) {
    const locator =
      page
        .locator(selector)
        .last();

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
      "Không tìm thấy ô tạo bài viết trên trang cá nhân."
    );
  }

  await composer.click({
    timeout: ACTION_TIMEOUT
  });

  await page.waitForTimeout(1_500);
}

async function findPostTextbox(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'div[role="textbox"]',
    "textarea"
  ];

  for (const selector of selectors) {
    const locator =
      page
        .locator(selector)
        .last();

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

  await page.waitForTimeout(700);
}

/*
 * Facebook có thể mở popup gợi ý sau khi nhập caption.
 * Đóng popup trước khi tìm Photo/video.
 */
async function dismissComposerSuggestions(
  page: Page
): Promise<void> {
  const titleCandidates = [
    page
      .getByText(
        "Create post",
        { exact: true }
      )
      .last(),

    page
      .getByText(
        "Tạo bài viết",
        { exact: true }
      )
      .last()
  ];

  for (
    const locator of titleCandidates
  ) {
    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      await locator
        .click()
        .catch(() => {});

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
    '[aria-label*="Ảnh / video"]'
  ];

  for (const selector of selectors) {
    const locator =
      page
        .locator(selector)
        .last();

    if (
      await locator
        .isVisible()
        .catch(() => false)
    ) {
      return locator;
    }
  }

  return await findVisibleText(
    page,
    [
      /Photo\/video/i,
      /Ảnh\/video/i
    ]
  );
}

async function uploadImages(
  page: Page,
  imagePaths: string[]
): Promise<void> {
  if (
    imagePaths.length === 0
  ) {
    throw new Error(
      "Bài này không có ảnh."
    );
  }

  for (
    const imagePath of imagePaths
  ) {
    if (
      !fs.existsSync(imagePath)
    ) {
      throw new Error(
        `Không tìm thấy ảnh:\n${imagePath}`
      );
    }
  }

  console.log(
    `🖼️ Upload ${imagePaths.length} ảnh...`
  );

  const button =
    await findPhotoVideoButton(
      page
    );

  if (!button) {
    throw new Error(
      "Không tìm thấy nút Photo/video."
    );
  }

  /*
   * Bắt filechooser trước khi click.
   */
  const chooserPromise =
    page
      .waitForEvent(
        "filechooser",
        {
          timeout:
            ACTION_TIMEOUT
        }
      )
      .catch(
        () => null
      );

  await button.click({
    timeout:
      ACTION_TIMEOUT
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
   * Fallback input[type=file].
   */
  await page.waitForTimeout(
    700
  );

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
   POST
============================================================ */

async function findPostButton(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Post"]',
    '[aria-label="Đăng"]',
    'div[role="button"]:has-text("Post")',
    'div[role="button"]:has-text("Đăng")'
  ];

  for (const selector of selectors) {
    const locator =
      page
        .locator(selector)
        .last();

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

class PostClickUncertainError extends Error {
  constructor(message: string) {
    super(
      `POST_CLICK_UNCERTAIN: ${message}`
    );
    this.name =
      "PostClickUncertainError";
  }
}

async function findNextButton(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Next"]',
    '[aria-label="Tiếp"]',
    '[aria-label="Tiếp theo"]',
    'div[role="button"]:has-text("Next")',
    'div[role="button"]:has-text("Tiếp")',
    'button:has-text("Next")',
    'button:has-text("Tiếp")'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (
      await locator.isVisible().catch(() => false) &&
      await locator.isEnabled().catch(() => true)
    ) {
      return locator;
    }
  }

  return await findVisibleText(page, [
    /^Next$/i,
    /^Tiếp$/i,
    /^Tiếp theo$/i
  ]);
}

async function clickNextAfterUpload(
  page: Page
): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const next = await findNextButton(page);
    if (next) {
      console.log("➡️ Ảnh đã upload. Click Next...");
      await next.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(2_000);
      console.log("✅ Đã click Next.");
      return;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    "Không tìm thấy nút Next/Tiếp sau khi upload 4 ảnh."
  );
}


/* ============================================================
   SHARE TO STORY — ENABLE BEFORE POST
   ============================================================ */

async function getShareToStoryRow(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label*="Share to story"]',
    '[aria-label*="Share to your story"]',
    '[aria-label*="Chia sẻ lên tin"]',
    '[aria-label*="Chia sẻ lên Story"]',
    'div[role="button"]:has-text("Share to story")',
    'div[role="button"]:has-text("Share to Story")',
    'div[role="button"]:has-text("Chia sẻ lên tin")',
    'div[role="button"]:has-text("Chia sẻ lên Story")',
    'button:has-text("Share to story")',
    'button:has-text("Share to Story")',
    'button:has-text("Chia sẻ lên tin")',
    'button:has-text("Chia sẻ lên Story")'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (
      await locator.isVisible().catch(() => false) &&
      await locator.isEnabled().catch(() => true)
    ) {
      return locator;
    }
  }

  return await findVisibleText(page, [
    /^Share to story$/i,
    /^Share to Story$/i,
    /^Chia sẻ lên tin$/i,
    /^Chia sẻ lên Story$/i,
    /^Chia sẻ lên story$/i
  ]);
}

async function shareToStoryIsOn(
  page: Page
): Promise<boolean> {
  const positiveSelectors = [
    '[role="switch"][aria-checked="true"]',
    'input[type="checkbox"]:checked',
    '[aria-checked="true"]'
  ];

  for (const selector of positiveSelectors) {
    if (
      await page.locator(selector).count() > 0 &&
      await page.locator(selector).last().isVisible().catch(() => false)
    ) {
      return true;
    }
  }

  const onText = await findVisibleText(page, [
    /^On$/i,
    /^Bật$/i,
    /^Đã bật$/i
  ]);

  if (onText) {
    return true;
  }

  return false;
}

async function enableShareToStoryBeforePost(
  page: Page
): Promise<void> {
  console.log("📲 Kiểm tra Share to story trước khi Post...");

  const deadline = Date.now() + 20_000;

  let row: Locator | null = null;

  while (Date.now() < deadline) {
    row = await getShareToStoryRow(page);
    if (row) break;
    await page.waitForTimeout(500);
  }

  if (!row) {
    throw new Error(
      "Không tìm thấy mục 'Share to story' trong Post settings."
    );
  }

  console.log("📲 Mở Share to story settings...");
  await row.click({ timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(1_000);

  /*
   * Facebook hiện tại của b mở một dialog:
   *
   *   Share to story?
   *   ○ Share only this post
   *   ● Always share posts to story
   *   ○ Don't share post to story
   *                         Save
   *
   * Với UI này không cần tìm switch chung chung.
   * Chỉ cần đảm bảo "Always share posts to story" được chọn,
   * rồi click Save.
   */

  const alwaysSharePatterns = [
    /^Always share posts to story$/i,
    /^Luôn chia sẻ bài viết lên tin$/i,
    /^Luôn chia sẻ bài viết lên Story$/i
  ];

  let alwaysShareOption: Locator | null = null;
  const optionDeadline = Date.now() + 15_000;

  while (Date.now() < optionDeadline) {
    alwaysShareOption = await findVisibleText(
      page,
      alwaysSharePatterns
    );

    if (alwaysShareOption) break;

    await page.waitForTimeout(400);
  }

  if (!alwaysShareOption) {
    throw new Error(
      "Không tìm thấy lựa chọn 'Always share posts to story' trong dialog Share to story."
    );
  }

  // Click đúng dòng "Always share..." nếu radio chưa được chọn.
  const ariaChecked =
    await alwaysShareOption.getAttribute("aria-checked");
  const ariaSelected =
    await alwaysShareOption.getAttribute("aria-selected");

  const parentChecked =
    await alwaysShareOption
      .locator("xpath=..")
      .getAttribute("aria-checked")
      .catch(() => null);

  const parentSelected =
    await alwaysShareOption
      .locator("xpath=..")
      .getAttribute("aria-selected")
      .catch(() => null);

  const alreadySelected =
    ariaChecked === "true" ||
    ariaSelected === "true" ||
    parentChecked === "true" ||
    parentSelected === "true";

  if (!alreadySelected) {
    console.log(
      "📲 'Always share posts to story' chưa chọn → click..."
    );

    await alwaysShareOption.click({
      timeout: ACTION_TIMEOUT
    });

    await page.waitForTimeout(600);
  } else {
    console.log(
      "✅ 'Always share posts to story' đã được chọn sẵn."
    );
  }

  /*
   * Nút Save/Lưu của đúng dialog.
   * Không dùng selector chung chung kiểu Share/Chia sẻ.
   */
  const savePatterns = [
    /^Save$/i,
    /^Lưu$/i
  ];

  let saveButton: Locator | null = null;
  const saveDeadline = Date.now() + 15_000;

  while (Date.now() < saveDeadline) {
    saveButton = await findVisibleText(
      page,
      savePatterns
    );

    if (saveButton) break;

    await page.waitForTimeout(400);
  }

  if (!saveButton) {
    throw new Error(
      "Không tìm thấy nút Save/Lưu trong dialog Share to story."
    );
  }

  console.log("💾 Click Save để lưu Share to story...");
  await saveButton.click({
    timeout: ACTION_TIMEOUT
  });

  /*
   * Chờ dialog Share to story? đóng hẳn.
   */
  const closeDeadline = Date.now() + 15_000;

  while (Date.now() < closeDeadline) {
    const dialogOption = await findVisibleText(
      page,
      alwaysSharePatterns
    );

    if (!dialogOption) {
      console.log(
        "✅ Đã lưu Share to story. Quay lại Post settings."
      );
      return;
    }

    await page.waitForTimeout(400);
  }

  throw new Error(
    "Đã click Save nhưng dialog Share to story chưa đóng."
  );
}

async function publishPost(
  page: Page
): Promise<void> {
  let button: Locator | null = null;
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    button = await findPostButton(page);
    if (button) break;
    await page.waitForTimeout(500);
  }

  if (!button) {
    throw new Error(
      "Không tìm thấy nút Post/Đăng trong composer sau khi upload ảnh."
    );
  }

  try {
    await button.click({
      timeout: ACTION_TIMEOUT
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    throw new PostClickUncertainError(reason);
  }

  const closeDeadline = Date.now() + 30_000;

  while (Date.now() < closeDeadline) {
    const composer = await findComposer(page);
    if (!composer) return;
    await page.waitForTimeout(750);
  }

  throw new PostClickUncertainError(
    "Đã click Post nhưng không xác nhận được composer đã đóng."
  );
}

/* ============================================================
   SHARE LATEST POST TO STORY
============================================================ */

async function findStoryOption(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Share to your story"]',
    '[aria-label="Share to Story"]',
    '[aria-label="Share to story"]',
    '[aria-label="Chia sẻ lên tin"]',
    '[aria-label="Chia sẻ lên Story"]',
    'div[role="menuitem"]:has-text("Share to your story")',
    'div[role="menuitem"]:has-text("Share to Story")',
    'div[role="menuitem"]:has-text("Chia sẻ lên tin")',
    'div[role="button"]:has-text("Share to your story")',
    'div[role="button"]:has-text("Chia sẻ lên tin")',
    'button:has-text("Share to your story")',
    'button:has-text("Chia sẻ lên tin")'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (
      await locator.isVisible().catch(() => false) &&
      await locator.isEnabled().catch(() => true)
    ) {
      return locator;
    }
  }

  return await findVisibleText(page, [
    /^Share to your story$/i,
    /^Share to Story$/i,
    /^Share to story$/i,
    /^Chia sẻ lên tin$/i,
    /^Chia sẻ lên Story$/i,
    /^Chia sẻ lên story$/i
  ]);
}

async function findPostMoreMenuButton(
  page: Page
): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Actions for this post"]',
    '[aria-label="More options"]',
    '[aria-label="More"]',
    '[aria-label="Hành động cho bài viết này"]',
    '[aria-label="Tùy chọn khác"]',
    'div[role="button"][aria-haspopup="menu"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (
      await locator.isVisible().catch(() => false) &&
      await locator.isEnabled().catch(() => true)
    ) {
      return locator;
    }
  }

  return null;
}

async function findShareButtonOnLatestPost(
  page: Page
): Promise<Locator | null> {
  const articles = page.locator('div[role="article"]');
  const count = await articles.count();

  if (count === 0) return null;

  const article = articles.last();
  const selectors = [
    '[aria-label="Share"]',
    '[aria-label="Chia sẻ"]',
    'div[role="button"]:has-text("Share")',
    'div[role="button"]:has-text("Chia sẻ")',
    'button:has-text("Share")',
    'button:has-text("Chia sẻ")'
  ];

  for (const selector of selectors) {
    const locator = article.locator(selector).last();
    if (
      await locator.isVisible().catch(() => false) &&
      await locator.isEnabled().catch(() => true)
    ) {
      return locator;
    }
  }

  return null;
}

async function legacyShareLatestPostToStory(
  page: Page
): Promise<void> {
  console.log("📲 Bắt đầu Share bài vừa đăng lên Story...");

  // Sau khi Post, quay lại profile để chắc chắn bài mới nhất đã render.
  await page.waitForTimeout(3_500);
  await page.goto("https://www.facebook.com/me", {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  await waitForFacebook(page);
  await page.waitForTimeout(3_000);

  // Ưu tiên tìm trực tiếp option Share to Story nếu Facebook đang hiển thị.
  let storyOption = await findStoryOption(page);

  if (!storyOption) {
    // Cách Facebook thường dùng: mở menu ... của bài mới nhất.
    const moreButton = await findPostMoreMenuButton(page);
    if (moreButton) {
      console.log("📲 Mở menu bài viết mới nhất...");
      await moreButton.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(1_000);
      storyOption = await findStoryOption(page);
    }
  }

  if (!storyOption) {
    // Một số layout có nút Share dưới bài viết thay vì menu ...
    const shareButton = await findShareButtonOnLatestPost(page);
    if (shareButton) {
      console.log("📲 Mở menu Share của bài viết...");
      await shareButton.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(1_000);
      storyOption = await findStoryOption(page);
    }
  }

  if (!storyOption) {
    throw new Error(
      "Đã đăng bài nhưng không tìm thấy tùy chọn 'Share to your story / Chia sẻ lên tin'."
    );
  }

  console.log("📲 Click Share to your story...");
  await storyOption.click({ timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(2_000);

  // Story composer: nút xác nhận thường là Share/Chia sẻ.
  const confirmSelectors = [
    '[aria-label="Share"]',
    '[aria-label="Chia sẻ"]',
    '[aria-label="Share to story"]',
    '[aria-label="Share to your story"]',
    '[aria-label="Chia sẻ lên tin"]',
    'div[role="button"]:has-text("Share")',
    'div[role="button"]:has-text("Chia sẻ")',
    'button:has-text("Share")',
    'button:has-text("Chia sẻ")'
  ];

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const selector of confirmSelectors) {
      const locator = page.locator(selector).last();
      if (
        await locator.isVisible().catch(() => false) &&
        await locator.isEnabled().catch(() => true)
      ) {
        console.log("📲 Click xác nhận Share Story...");
        await locator.click({ timeout: ACTION_TIMEOUT });
        await page.waitForTimeout(2_500);
        console.log("✅ Đã Share bài lên Story.");
        return;
      }
    }

    const textButton = await findVisibleText(page, [
      /^Share$/i,
      /^Chia sẻ$/i,
      /^Share to story$/i,
      /^Share to your story$/i,
      /^Chia sẻ lên tin$/i
    ]);

    if (textButton) {
      await textButton.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(2_500);
      console.log("✅ Đã Share bài lên Story.");
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    "Đã mở Story nhưng không tìm thấy nút Share/Chia sẻ để xác nhận."
  );
}

/*
 * Những lỗi xảy ra trước khi click Post.
 * Có thể bỏ qua bài hiện tại và tiếp tục bài kế tiếp.
 */
function isSafePrePublishError(
  error: unknown
): boolean {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  if (
    message.includes(
      "POST_CLICK_UNCERTAIN:"
    )
  ) {
    return false;
  }

  const normalized =
    message.toLowerCase();

  const patterns = [
    "không tìm thấy ô tạo bài viết",
    "không tìm thấy ô nhập caption",
    "không tìm thấy nút photo/video",
    "không tìm thấy nút photo",
    "file picker",
    "filechooser",
    "file input",
    "setinputfiles",
    "upload",
    "element is not attached",
    "element is not visible",
    "intercepts pointer events",
    "waiting for",
    "timeout",
    "execution context was destroyed",
    "navigation"
  ];

  return patterns.some(
    (pattern) =>
      normalized.includes(pattern)
  );
}

/* ============================================================
   ONE PERSONAL POST
============================================================ */

async function postOne(
  page: Page,
  caption: Caption,
  images: string[],
  postNumber: number
): Promise<void> {
  console.log(
    "\n------------------------------------------"
  );

  console.log(
    `📝 Facebook cá nhân — 1 bài trong lần chạy này`
  );

  console.log(
    `🖼️ ${images.length} ảnh`
  );

  images.forEach(
    (image, index) => {
      console.log(
        `   ${index + 1}. ${path.basename(image)}`
      );
    }
  );

  /*
   * Luôn mở trang cá nhân thật.
   */
  await page.goto(
    "https://www.facebook.com/me",
    {
      waitUntil:
        "domcontentloaded",
      timeout: 45_000
    }
  );

  await waitForFacebook(
    page
  );

  await page.waitForTimeout(
    2_500
  );

  /*
   * Mở composer.
   */
  await openComposer(
    page
  );

  /*
   * Caption.
   */
  await fillCaption(
    page,
    caption.fullCaption
  );

  /*
   * Đóng popup gợi ý trước khi click Photo/video.
   */
  await dismissComposerSuggestions(
    page
  );

  /*
   * Upload đủ 4 ảnh trong một lần.
   */
  await uploadImages(
    page,
    images
  );

  await clickNextAfterUpload(page);

  // Facebook hiện dùng Post settings sau bước Next.
  // Bật Share to story TRƯỚC khi click Post.
  await enableShareToStoryBeforePost(page);

  /*
   * TEST_MODE chỉ dùng khi cần kiểm tra UI.
   */
  if (TEST_MODE) {
    console.log(
      "\n🧪 TEST_MODE = true"
    );

    console.log(
      "⏸️ Đã chuẩn bị bài nhưng KHÔNG click Post."
    );

    await page.pause();

    return;
  }

  /*
   * Chỉ tới đây mới click Post.
   */
  await publishPost(
    page
  );

  console.log(
    "✅ Đã click Post."
  );
}

/* ============================================================
   MAIN
============================================================ */

async function main(): Promise<void> {
  console.log(
    "\n=========================================="
  );

  console.log(`🔧 Version: ${FILE_VERSION}`);

  console.log(
    "       FACEBOOK PERSONAL PROFILE POSTER"
  );

  console.log(
    "==========================================\n"
  );

  const campaignName =
    getCurrentCampaignName();

  const campaign =
    loadCampaign(
      campaignName
    );

  console.log(
    `🎯 Campaign: ${campaign.name}`
  );

  const savedCaptions =
    readJson<SavedCaptions>(
      CAPTIONS_FILE
    );

  if (
    savedCaptions.campaign !==
    campaignName
  ) {
    throw new Error(
      `Campaign hiện tại là "${campaignName}" nhưng captions.json đang thuộc campaign "${savedCaptions.campaign}". ` +
      "Hãy chạy BAT campaign-aware để generate caption mới trước."
    );
  }

  if (
    !Array.isArray(
      savedCaptions.captions
    ) ||
    savedCaptions.captions.length === 0
  ) {
    throw new Error(
      "captions.json không có caption."
    );
  }

  const captions =
    savedCaptions.captions;

  const imagesPerPost = 4;

  const randomImages =
    campaign.randomImages ??
    true;

  const allImages =
    getImages(
      campaign.imageFolder
    );

  if (
    allImages.length <
    imagesPerPost
  ) {
    throw new Error(
      `Không đủ ảnh: cần ${imagesPerPost}, có ${allImages.length}.`
    );
  }

  console.log(
    `🖼️ Tổng ảnh: ${allImages.length}`
  );

  console.log(
    `🖼️ Ảnh / bài: ${imagesPerPost}`
  );

  console.log(
    `🔀 Random ảnh: ${randomImages}`
  );

  const state =
    loadState(
      campaignName
    );

  /*
   * Chỉ mở browser một lần.
   * Mỗi lần chạy chỉ đăng một bài.
   */
  const context:
    BrowserContext =
    await chromium.launchPersistentContext(
      PROFILE_DIR,
      {
        headless: false,
        viewport: null,
        args: [
          "--start-maximized"
        ]
      }
    );

  try {
    const pages =
      context.pages();

    const page =
      pages.length > 0
        ? pages[0]
        : await context.newPage();

    /*
     * Check session.
     */
    await page.goto(
      "https://www.facebook.com/me",
      {
        waitUntil:
          "domcontentloaded",
        timeout: 45_000
      }
    );

    await waitForFacebook(
      page
    );

    const loginDetected =
      await page
        .locator(
          'input[name="email"], input[name="pass"]'
        )
        .first()
        .isVisible()
        .catch(
          () => false
        );

    if (loginDetected) {
      console.log(
        "\n⚠️ Facebook chưa đăng nhập."
      );

      console.log(
        "👉 Đăng nhập bằng tay rồi chạy lại."
      );

      return;
    }

    console.log(
      "✅ Facebook session OK."
    );

    console.log(
      `📅 Hôm nay: ${new Date().toISOString().slice(0, 10)}`
    );
const captionIndex =
      state.nextCaptionIndex % captions.length;

    const caption = captions[captionIndex];

    const selectedImages = randomImages
      ? shuffle(allImages).slice(0, 4)
      : allImages.slice(0, 4);

    console.log(
      `\n✍️ Caption ${captionIndex + 1}/${captions.length}`
    );
    console.log(
      "🖼️ Personal profile: chọn đúng 4 ảnh cho bài này."
    );

    await postOne(
      page,
      caption,
      selectedImages,
      1
    );

    state.nextCaptionIndex =
      (captionIndex + 1) % captions.length;
writeJson(
      STATE_FILE,
      state
    );

    console.log(
      "🎉 Đăng bài Facebook cá nhân thành công."
    );

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
      `🎯 Campaign: ${campaign.name}`
    );
console.log(
      "==========================================\n"
    );
  } finally {
    await context.close();
  }
}

main().catch(
  (error) => {
    console.error(
      "\n❌ FATAL ERROR:\n"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);