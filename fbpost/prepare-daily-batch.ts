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

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CAMPAIGNS_DIR = path.join(ROOT, "campaigns");

const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const BLOCKED_GROUPS_FILE = path.join(
  DATA_DIR,
  "blocked-groups.json"
);
const CAPTIONS_FILE = path.join(DATA_DIR, "captions.json");
const STATE_FILE = path.join(DATA_DIR, "posting-state.json");
const BATCH_FILE = path.join(DATA_DIR, "daily-batch.json");

const CAMPAIGN_CONFIG_FILE = path.join(
  ROOT,
  "config",
  "campaign-config.json"
);

const DAILY_LIMIT = 25;
const DEFAULT_IMAGES_PER_POST = 8;

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(`Không tìm thấy file:\n${file}`);
  }

  return JSON.parse(
    fs.readFileSync(file, "utf8")
  ) as T;
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function getCurrentCampaignName(): string {
  const config = readJson<{
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

  const allowedExtensions = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp"
  ]);

  const files = fs
    .readdirSync(imageFolder)
    .filter((file) =>
      allowedExtensions.has(
        path.extname(file).toLowerCase()
      )
    )
    .map((file) =>
      path.join(imageFolder, file)
    );

  if (files.length === 0) {
    throw new Error(
      `Không có ảnh hợp lệ trong:\n${imageFolder}`
    );
  }

  return files;
}

function loadPostingState(): PostingState {
  if (!fs.existsSync(STATE_FILE)) {
    const initialState: PostingState = {
      campaign: "",
      nextGroupIndex: 0,
      lastPreparedAt: null,
      lastPostedAt: null,
      totalPosted: 0
    };

    writeJson(
      STATE_FILE,
      initialState
    );

    return initialState;
  }

  return readJson<PostingState>(
    STATE_FILE
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

/*
 * Chọn đúng N ảnh cho MỘT bài.
 *
 * - Mỗi bài tự random lại từ toàn bộ folder.
 * - Trong cùng một bài: không trùng ảnh.
 * - Giữa các bài: được phép trùng ảnh.
 */
function selectImagesForPost(
  allImages: string[],
  imagesPerPost: number,
  randomImages: boolean
): string[] {
  if (imagesPerPost <= 0) {
    throw new Error(
      `imageCount phải > 0. Hiện tại: ${imagesPerPost}`
    );
  }

  if (
    allImages.length <
    imagesPerPost
  ) {
    throw new Error(
      `Folder có ${allImages.length} ảnh nhưng mỗi bài cần ${imagesPerPost} ảnh.`
    );
  }

  const candidates = randomImages
    ? shuffle(allImages)
    : [...allImages];

  return candidates.slice(
    0,
    imagesPerPost
  );
}

async function main(): Promise<void> {
  console.log(
    "\n=========================================="
  );
  console.log(
    "      PREPARE DAILY FACEBOOK BATCH"
  );
  console.log(
    "==========================================\n"
  );

  /*
   * 1. CURRENT CAMPAIGN
   */
  const campaignName =
    getCurrentCampaignName();

  console.log(
    `🎯 Campaign: ${campaignName}`
  );

  const campaign =
    loadCampaign(campaignName);

  console.log(
    `📌 ${campaign.name}`
  );

  /*
   * 2. IMAGE CONFIG
   *
   * imageCount = số ảnh cho MỖI bài.
   */
  const imagesPerPost =
    campaign.imageCount ??
    DEFAULT_IMAGES_PER_POST;

  const randomImages =
    campaign.randomImages ??
    true;

  console.log(
    `🖼️ Ảnh / bài: ${imagesPerPost}`
  );

  console.log(
    `🔀 Random: ${randomImages}`
  );

  /*
   * 3. GROUPS
   *
   * Chỉ đọc groups.json đã crawl sẵn.
   */
  const groups =
    readJson<Group[]>(
      GROUPS_FILE
    );

  if (groups.length === 0) {
    throw new Error(
      "groups.json đang rỗng."
    );
  }

  console.log(
    `👥 Tổng group: ${groups.length}`
  );

  /*
   * 4. CAPTIONS
   */
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
      `Hãy chạy generate-captions.ts một lần cho campaign mới trước khi đăng.`
    );
  }

  const captions =
    savedCaptions.captions;

  if (
    !Array.isArray(captions) ||
    captions.length < DAILY_LIMIT
  ) {
    throw new Error(
      `Cần ít nhất ${DAILY_LIMIT} caption cho campaign "${campaignName}", hiện có ${captions?.length ?? 0}.`
    );
  }

  console.log(
    `✍️ Caption: ${captions.length}`
  );

  console.log(
    `🕒 Caption generated: ${savedCaptions.generatedAt}`
  );

  /*
   * 5. ALL IMAGES
   */
  console.log(
    `🖼️ Folder ảnh:\n${campaign.imageFolder}`
  );

  const allImages =
    getImages(
      campaign.imageFolder
    );

  console.log(
    `🖼️ Tổng ảnh trong folder: ${allImages.length}`
  );

  if (
    allImages.length <
    imagesPerPost
  ) {
    throw new Error(
      `Không đủ ảnh: cần ${imagesPerPost}, có ${allImages.length}.`
    );
  }

  /*
   * 6. POSTING STATE
   */
  const state =
    loadPostingState();

  if (
    state.campaign !==
    campaignName
  ) {
    console.log(
      `\n🔄 Campaign đổi: ` +
      `${state.campaign || "(trống)"} → ${campaignName}`
    );

    state.campaign =
      campaignName;
    state.nextGroupIndex = 0;
    state.lastPreparedAt = null;
    state.lastPostedAt = null;
    state.totalPosted = 0;

    writeJson(
      STATE_FILE,
      state
    );
  }

  /*
   * 7. LỌC GROUP BỊ BLOCK VÀ CHỌN 25 GROUP HỢP LỆ
   *
   * groups.json luôn giữ nguyên.
   * blocked-groups.json chỉ là danh sách loại trừ.
   */
  const blockedGroups =
    loadBlockedGroups();

  const blockedUrls =
    new Set(
      blockedGroups.map(
        (group) => group.url
      )
    );

  let eligibleGroups =
    groups
      .map((group, index) => ({
        group,
        originalIndex: index
      }))
      .filter(
        (item) =>
          item.originalIndex >=
            state.nextGroupIndex &&
          !blockedUrls.has(
            item.group.url
          )
      );

  /*
   * Nếu đã chạy hết phần còn lại của groups.json:
   * - Bắt đầu một vòng mới từ group đầu tiên.
   * - Vẫn giữ blocked-groups.json làm danh sách loại trừ.
   * - Không reset totalPosted.
   */
  if (eligibleGroups.length === 0) {
    console.log(
      "\n🔄 Đã chạy hết vòng hiện tại."
    );

    console.log(
      `📌 nextGroupIndex hiện tại: ${state.nextGroupIndex}`
    );

    console.log(
      "🔁 Reset về group đầu tiên để bắt đầu vòng mới."
    );

    state.nextGroupIndex = 0;

    writeJson(
      STATE_FILE,
      state
    );

    eligibleGroups =
      groups
        .map((group, index) => ({
          group,
          originalIndex: index
        }))
        .filter(
          (item) =>
            !blockedUrls.has(
              item.group.url
            )
        );

    /*
     * Trường hợp tất cả group đều bị block.
     */
    if (eligibleGroups.length === 0) {
      console.log(
        "\n🚫 Không còn group hợp lệ nào."
      );

      console.log(
        `🚫 Group bị block: ${blockedGroups.length}`
      );

      return;
    }
  }

  const selectedEntries =
    eligibleGroups.slice(
      0,
      DAILY_LIMIT
    );

  const selectedGroups =
    selectedEntries.map(
      (item) => item.group
    );

  const selectedGroupIndices =
    selectedEntries.map(
      (item) => item.originalIndex
    );

  const startGroupIndex =
    selectedGroupIndices[0];

  const endGroupIndex =
    selectedGroupIndices[
      selectedGroupIndices.length - 1
    ];

  console.log(
    `\n🚫 Group bị block: ${blockedGroups.length}`
  );

  console.log(
    `✅ Group hợp lệ còn lại: ${eligibleGroups.length}`
  );

  console.log(
    `📦 Chọn ${selectedGroups.length} group hợp lệ cho batch hôm nay.`
  );

  console.log(
    `📍 Batch bắt đầu từ group ${startGroupIndex + 1}.`
  );

  if (
    selectedGroups.length <
    DAILY_LIMIT
  ) {
    console.log(
      `⚠️ Chỉ còn ${selectedGroups.length} group hợp lệ, không đủ ${DAILY_LIMIT}.`
    );
  }

  /*
   * 8. CHỌN 25 CAPTION
   */
  const selectedCaptions =
    shuffle(
      captions
    ).slice(
      0,
      selectedGroups.length
    );

  /*
   * 9. BUILD 25 POSTS
   *
   * MỖI POST tự lấy đúng 8 ảnh.
   */
  const posts: BatchPost[] =
    selectedGroups.map(
      (group, index) => {
        const caption =
          selectedCaptions[index];

        const images =
          selectImagesForPost(
            allImages,
            imagesPerPost,
            randomImages
          );

        return {
          index:
            index + 1,

          groupIndex:
            selectedGroupIndices[index],

          group,

          captionIndex:
            captions.indexOf(
              caption
            ),

          caption,

          images
        };
      }
    );

  /*
   * 10. SAVE DAILY BATCH
   */
  const batch: DailyBatch = {
    createdAt:
      new Date().toISOString(),

    campaign:
      campaignName,

    campaignName:
      campaign.name,

    imagesPerPost,

    startGroupIndex,

    endGroupIndex,

    posts
  };

  writeJson(
    BATCH_FILE,
    batch
  );

  /*
   * Chưa tăng nextGroupIndex.
   * Chỉ post-daily.ts được tăng sau khi post thành công.
   */
  state.lastPreparedAt =
    new Date().toISOString();

  writeJson(
    STATE_FILE,
    state
  );

  /*
   * 11. VERIFY
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
    `🎯 Campaign: ${campaign.name}`
  );

  console.log(
    `👥 Group index đầu: ${startGroupIndex + 1}`
  );

  console.log(
    `👥 Group index cuối: ${endGroupIndex + 1}`
  );

  console.log(
    `📝 Số bài: ${posts.length}`
  );

  console.log(
    `🖼️ Ảnh mỗi bài: ${imagesPerPost}`
  );

  console.log(
    `📄 Batch: ${BATCH_FILE}`
  );

  console.log(
    `🚫 Block list: ${BLOCKED_GROUPS_FILE}`
  );

  console.log(
    "\n📊 Kiểm tra 3 bài đầu:"
  );

  posts
    .slice(0, 3)
    .forEach((post) => {
      console.log(
        `\nBài ${post.index} — ${post.group.name}`
      );

      post.images.forEach(
        (image, imageIndex) => {
          console.log(
            `  ${imageIndex + 1}. ${path.basename(image)}`
          );
        }
      );
    });

  console.log(
    "\n✅ Mỗi bài đã được gán riêng 8 ảnh."
  );

  console.log(
    "👉 Chưa đăng Facebook."
  );

  console.log(
    "==========================================\n"
  );
}

main().catch((error) => {
  console.error(
    "\n❌ LỖI:\n"
  );
  console.error(error);
  process.exit(1);
});