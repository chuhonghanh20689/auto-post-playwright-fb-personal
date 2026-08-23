import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

/* =========================================================
   CONFIG
========================================================= */

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("❌ Không tìm thấy GEMINI_API_KEY trong .env");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: API_KEY,
});

const TOTAL_CAPTIONS = 25;
const BATCH_SIZE = 5;
const MODEL = "gemini-3.6-flash";

/* =========================================================
   PATHS
========================================================= */

const CONFIG_DIR = path.join(
  __dirname,
  "config"
);

const CAMPAIGN_CONFIG_FILE = path.join(
  CONFIG_DIR,
  "campaign-config.json"
);

const CAMPAIGNS_DIR = path.join(
  __dirname,
  "campaigns"
);

const OUTPUT_DIR = path.join(
  __dirname,
  "data"
);

const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  "captions.json"
);

const HISTORY_FILE = path.join(
  OUTPUT_DIR,
  "captions-history.json"
);

/* =========================================================
   FOOTER
   Gemini KHÔNG được viết phần này.
========================================================= */

const FOOTER = `--------------------------------------------
Đảo bánh quy
📞 0859796267
Zalo: 0945918855
ADD1: 58 Nam Tràng, Trúc Bạch, Ba Đình, Hà Nội
ADD2: 444/8/8 Thụy Khuê, Tây Hồ, Hà Nội
ADD3: 24 Quan Nhân, Thanh Xuân, Hà Nội`;

/* =========================================================
   TYPES
========================================================= */

interface CampaignConfig {
  currentCampaign: string;
}

interface CampaignData {
  name: string;
  mainKeyword: string;

  primaryKeywords: string[];

  productKeywords: string[];

  audienceKeywords: string[];

  angles: string[];

  hashtags: string[];

  secondaryOccasions: string[];

  instruction: string;
}

interface GeneratedCaption {
  keyword: string;
  content: string;
  hashtags: string[];
  fullCaption: string;
}

interface SavedCaptions {
  campaign: string;
  generatedAt: string;
  captions: GeneratedCaption[];
}

/* =========================================================
   LOAD CAMPAIGN CONFIG
========================================================= */

function loadCampaignConfig(): CampaignConfig {

  if (
    !fs.existsSync(
      CAMPAIGN_CONFIG_FILE
    )
  ) {
    throw new Error(
      `❌ Không tìm thấy file:

${CAMPAIGN_CONFIG_FILE}`
    );
  }

  try {

    const raw =
      fs.readFileSync(
        CAMPAIGN_CONFIG_FILE,
        "utf-8"
      );

    const config =
      JSON.parse(
        raw
      ) as CampaignConfig;

    if (
      !config.currentCampaign ||
      typeof config.currentCampaign !== "string"
    ) {
      throw new Error(
        'campaign-config.json phải có dạng: {"currentCampaign":"20-10"}'
      );
    }

    return config;

  } catch (error) {

    throw new Error(
      `❌ Không đọc được campaign-config.json.\n${error}`
    );
  }
}

/* =========================================================
   LOAD CAMPAIGN DATA
========================================================= */

function loadCampaignData(
  campaignId: string
): CampaignData {

  const campaignFile =
    path.join(
      CAMPAIGNS_DIR,
      `${campaignId}.json`
    );

  if (
    !fs.existsSync(
      campaignFile
    )
  ) {
    throw new Error(
      `❌ Không tìm thấy campaign:

${campaignFile}

Hãy kiểm tra currentCampaign trong:

${CAMPAIGN_CONFIG_FILE}`
    );
  }

  try {

    const raw =
      fs.readFileSync(
        campaignFile,
        "utf-8"
      );

    const campaign =
      JSON.parse(
        raw
      ) as CampaignData;

    if (
      !campaign.name
    ) {
      throw new Error(
        "Campaign thiếu field: name"
      );
    }

    if (
      !campaign.mainKeyword
    ) {
      throw new Error(
        "Campaign thiếu field: mainKeyword"
      );
    }

    if (
      !Array.isArray(
        campaign.primaryKeywords
      ) ||
      campaign.primaryKeywords.length === 0
    ) {
      throw new Error(
        "Campaign thiếu primaryKeywords."
      );
    }

    if (
      !Array.isArray(
        campaign.productKeywords
      ) ||
      campaign.productKeywords.length === 0
    ) {
      throw new Error(
        "Campaign thiếu productKeywords."
      );
    }

    if (
      !Array.isArray(
        campaign.audienceKeywords
      ) ||
      campaign.audienceKeywords.length === 0
    ) {
      throw new Error(
        "Campaign thiếu audienceKeywords."
      );
    }

    if (
      !Array.isArray(
        campaign.angles
      ) ||
      campaign.angles.length === 0
    ) {
      throw new Error(
        "Campaign thiếu angles."
      );
    }

    if (
      !Array.isArray(
        campaign.hashtags
      ) ||
      campaign.hashtags.length === 0
    ) {
      throw new Error(
        "Campaign thiếu hashtags."
      );
    }

    if (
      !Array.isArray(
        campaign.secondaryOccasions
      )
    ) {
      campaign.secondaryOccasions = [];
    }

    if (
      !campaign.instruction
    ) {
      campaign.instruction = "";
    }

    return campaign;

  } catch (error) {

    throw new Error(
      `❌ Không đọc được campaign ${campaignId}.json.\n${error}`
    );
  }
}

/* =========================================================
   LOAD HISTORY
========================================================= */

function loadHistory(): GeneratedCaption[] {

  if (
    !fs.existsSync(
      HISTORY_FILE
    )
  ) {
    return [];
  }

  try {

    const raw =
      fs.readFileSync(
        HISTORY_FILE,
        "utf-8"
      );

    const parsed =
      JSON.parse(
        raw
      );

    if (
      !Array.isArray(
        parsed
      )
    ) {
      return [];
    }

    return parsed;

  } catch {

    console.log(
      "⚠️ Không đọc được captions-history.json."
    );

    console.log(
      "⚠️ Sẽ bắt đầu history mới."
    );

    return [];
  }
}

/* =========================================================
   SAVE HISTORY
========================================================= */

function saveHistory(
  captions: GeneratedCaption[]
) {

  if (
    !fs.existsSync(
      OUTPUT_DIR
    )
  ) {
    fs.mkdirSync(
      OUTPUT_DIR,
      {
        recursive: true
      }
    );
  }

  /*
   * Giữ tối đa 100 caption gần nhất.
   */
  const limitedHistory =
    captions.slice(
      -100
    );

  fs.writeFileSync(
    HISTORY_FILE,
    JSON.stringify(
      limitedHistory,
      null,
      2
    ),
    "utf-8"
  );

  console.log(
    `💾 Đã lưu history: ${limitedHistory.length} caption`
  );
}

/* =========================================================
   JSON SCHEMA
========================================================= */

const responseSchema = {

  type: "object",

  properties: {

    captions: {

      type: "array",

      items: {

        type: "object",

        properties: {

          keyword: {
            type: "string",

            description:
              "Primary keyword hoặc keyword SEO chính được sử dụng trong caption."
          },

          content: {
            type: "string",

            description:
              "Caption Facebook tiếng Việt tự nhiên, dài vừa phải, có SEO nhưng không nhồi keyword."
          },

          hashtags: {

            type: "array",

            items: {
              type: "string"
            },

            description:
              "3 đến 5 hashtag liên quan."
          }
        },

        required: [
          "keyword",
          "content",
          "hashtags"
        ]
      }
    }
  },

  required: [
    "captions"
  ]
};

/* =========================================================
   GENERATE BATCH
========================================================= */

async function generateBatch(
  batchNumber: number,
  count: number,
  campaign: CampaignData,
  existingCaptions: GeneratedCaption[]
): Promise<GeneratedCaption[]> {

  console.log(
    `\n🤖 Đang tạo batch ${batchNumber} — ${count} caption...`
  );

  const previousExamples =
    existingCaptions
      .slice(-30)
      .map(
        (item) =>
          `Keyword: ${item.keyword}
Content: ${item.content}
Hashtags: ${item.hashtags.join(" ")}`
      )
      .join("\n\n");

  const prompt = `

Bạn đang viết nội dung Facebook cho shop ĐẢO BÁNH QUY.

Hãy tạo ${count} caption khác nhau.

==================================================
CAMPAIGN HIỆN TẠI
==================================================

Tên campaign:
${campaign.name}

Keyword chính:
${campaign.mainKeyword}

==================================================
NHÓM 1 — PRIMARY KEYWORDS
==================================================

Đây là nhóm keyword quan trọng nhất.

${campaign.primaryKeywords
  .map(
    (keyword) => `- ${keyword}`
  )
  .join("\n")}

Quy tắc:

- Mỗi caption nên sử dụng 1–2 primary keywords.
- Primary keyword có thể được lặp lại 2 lần trong caption
  nếu nghe tự nhiên.
- Không cần nhét tất cả primary keywords vào một bài.

==================================================
NHÓM 2 — PRODUCT KEYWORDS
==================================================

${campaign.productKeywords
  .map(
    (keyword) => `- ${keyword}`
  )
  .join("\n")}

Quy tắc:

- Mỗi caption nên sử dụng khoảng 2–4 product keywords.
- Có thể lặp lại một product keyword quan trọng
  nếu phù hợp.
- Không liệt kê keyword thành danh sách.
- Keyword phải nằm trong câu tự nhiên.

==================================================
NHÓM 3 — AUDIENCE KEYWORDS
==================================================

${campaign.audienceKeywords
  .map(
    (keyword) => `- ${keyword}`
  )
  .join("\n")}

Quy tắc:

- Mỗi caption chọn 1–2 audience keywords nếu phù hợp.
- Không cần caption nào cũng phải có audience keyword.
- Luân phiên đối tượng giữa các caption.

==================================================
CONTENT ANGLES
==================================================

${campaign.angles
  .map(
    (angle) => `- ${angle}`
  )
  .join("\n")}

==================================================
HASHTAGS
==================================================

${campaign.hashtags
  .map(
    (hashtag) => `- ${hashtag}`
  )
  .join("\n")}

==================================================
CÁC DỊP PHỤ
==================================================

${
  campaign.secondaryOccasions.length > 0
    ? campaign.secondaryOccasions
        .map(
          (occasion) => `- ${occasion}`
        )
        .join("\n")
    : "- Không có"
}

==================================================
INSTRUCTION CỦA CAMPAIGN
==================================================

${campaign.instruction}

==================================================
ĐỘ DÀI
==================================================

Caption không được quá ngắn.

Phần content nên khoảng:

- 4–7 câu
- hoặc khoảng 500–800 ký tự

Có thể dài hơn một chút nếu nội dung tự nhiên.

Không phải caption nào cũng có đúng cùng một số câu.

Luân phiên:

- 4 câu
- 5 câu
- 6 câu
- 7 câu

để các bài không giống nhau.

==================================================
SEO
==================================================

Mục tiêu là có nhiều keyword liên quan trong cùng
một caption nhưng vẫn phải đọc tự nhiên.

Ưu tiên cấu trúc:

PRIMARY KEYWORD
+
PRODUCT KEYWORDS
+
AUDIENCE KEYWORD nếu phù hợp

Ví dụ:

"20/10 nếu đang tìm quà tặng 20/10 cho mẹ, bạn gái
hoặc đồng nghiệp thì có thể tham khảo các set bánh quy
vẽ bên mình.

Bên mình có bánh quy vẽ 20/10 với nhiều mẫu hoa,
icing cookie và bánh quy handmade được trang trí thủ công.

Các set bánh quy 20/10 có thể chọn mẫu và số lượng
theo nhu cầu làm quà."

Đây là kiểu SEO mong muốn.

Keyword có thể xuất hiện nhiều lần.

Nhưng:

KHÔNG được viết:

"quà 20/10, quà tặng 20/10, bánh quy 20/10,
bánh quy vẽ 20/10, quà 20/10..."

Keyword phải nằm trong câu hoàn chỉnh.

==================================================
GIỌNG VĂN
==================================================

Viết như người bán hàng thật đăng Facebook group.

Giọng:

- tự nhiên
- trực tiếp
- thân thiện
- rõ ràng
- hơi đời thường
- giống shop nhỏ tự đăng bài
- không quá chuyên nghiệp
- không quá trau chuốt

Có thể dùng:

- "bên mình"
- "shop"
- "mình"
- "ạ"
- "nhé"
- "ai đang tìm..."
- "nếu đang cần..."
- "có thể tham khảo..."
- "shop có..."
- "inbox shop..."

Nhưng không được lặp một câu trong mọi caption.

==================================================
KHÔNG ĐƯỢC VIẾT VĂN HOA
==================================================

Tuyệt đối hạn chế hoặc tránh các câu:

- "trao gửi yêu thương"
- "gửi trọn yêu thương"
- "món quà chứa đựng yêu thương"
- "ngọt ngào và ý nghĩa"
- "một chút ngọt ngào cho ngày đặc biệt"
- "thay bạn gửi lời yêu thương"
- "món quà nhỏ nhưng mang cả tấm lòng"
- "chạm đến trái tim"
- "đong đầy cảm xúc"
- "ghi dấu khoảnh khắc"
- "lưu giữ những kỷ niệm"
- "không chỉ là một món quà"
- "đặc biệt hơn bao giờ hết"

Không viết theo phong cách brochure.

==================================================
EMOJI
==================================================

Mỗi caption tối đa 1–2 emoji.

Không cần emoji nếu không phù hợp.

==================================================
SẢN PHẨM
==================================================

Shop có:

- bánh quy vẽ
- bánh quy vẽ hình
- icing cookie
- bánh quy handmade
- bánh quy trang trí
- bánh quy hoa
- set bánh quy
- set quà tặng

Có thể đề cập:

- vẽ thủ công
- nhiều mẫu
- nhiều chủ đề
- đóng túi riêng từng chiếc
- phù hợp làm quà
- có thể chọn mẫu
- có thể chọn số lượng
- inbox shop để xem thêm mẫu

Không được tự bịa:

- giá
- giảm giá
- freeship
- thành phần
- chứng nhận
- giải thưởng
- tồn kho
- thời gian giao hàng
- thông tin không được cung cấp.

==================================================
CAMPAIGN
==================================================

Campaign hiện tại phải là trọng tâm.

Ví dụ campaign là 20/10:

Phần lớn caption phải có ý rõ ràng về:

- 20/10
- quà 20/10
- nhu cầu tìm quà
- người nhận quà
- bánh làm quà 20/10

Không nhất thiết caption nào cũng bắt đầu bằng "20/10".

Không nhất thiết caption nào cũng phải dùng
đúng cụm "quà tặng 20/10".

Nhưng đọc caption phải hiểu sản phẩm đang được
gợi ý cho campaign hiện tại.

Các dịp phụ chỉ được nhắc nhẹ.

==================================================
ĐA DẠNG
==================================================

${count} caption phải khác nhau.

Luân phiên:

- cách mở bài
- keyword
- audience
- content angle
- số câu
- độ dài
- CTA
- cách mô tả sản phẩm

Không được tạo 5 bài cùng một form rồi chỉ thay keyword.

==================================================
CAPTION CŨ
==================================================

Không được copy hoặc paraphrase quá gần những caption:

${
  previousExamples ||
  "(Chưa có caption cũ.)"
}

==================================================
FOOTER
==================================================

Không viết:

- số điện thoại
- Zalo
- địa chỉ
- footer

Footer sẽ được code tự động thêm.

==================================================
OUTPUT
==================================================

Chỉ trả về JSON đúng schema.

Phải tạo đủ ${count} caption.
`;

  try {

    const response =
      await ai.interactions.create({

        model: MODEL,

        input: prompt,

        response_format: {

          type: "text",

          mime_type:
            "application/json",

          schema:
            responseSchema
        }
      });

    if (
      !response.output_text
    ) {
      throw new Error(
        "Gemini không trả về output_text."
      );
    }

    const parsed =
      JSON.parse(
        response.output_text
      );

    if (
      !parsed.captions ||
      !Array.isArray(
        parsed.captions
      )
    ) {
      throw new Error(
        "JSON trả về không có mảng captions."
      );
    }

    /*
     * Keyword hợp lệ bao gồm cả 3 nhóm.
     */
    const allowedKeywords =
      new Set([
        ...campaign.primaryKeywords,
        ...campaign.productKeywords,
        ...campaign.audienceKeywords
      ]);

    const result:
      GeneratedCaption[] =
      parsed.captions

        .map(
          (item: any) => {

            const keyword =
              String(
                item.keyword || ""
              ).trim();

            const content =
              String(
                item.content || ""
              ).trim();

            const hashtags =
              Array.isArray(
                item.hashtags
              )
                ? item.hashtags
                    .map(
                      (h: any) =>
                        String(h).trim()
                    )
                    .filter(
                      Boolean
                    )
                : [];

            return {
              keyword,
              content,
              hashtags,
              fullCaption: ""
            };
          }
        )

        .filter(
          (
            item: GeneratedCaption
          ) =>
            item.keyword &&
            item.content &&
            allowedKeywords.has(
              item.keyword
            )
        );

    return result;

  } catch (error) {

    console.error(
      `❌ Lỗi khi tạo batch ${batchNumber}:`
    );

    console.error(
      error
    );

    return [];
  }
}

/* =========================================================
   REMOVE DUPLICATES
========================================================= */

function removeDuplicates(
  captions: GeneratedCaption[]
): GeneratedCaption[] {

  const seen =
    new Set<string>();

  const result:
    GeneratedCaption[] = [];

  for (
    const caption of captions
  ) {

    const normalized =
      caption.content
        .toLowerCase()
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      seen.has(
        normalized
      )
    ) {
      continue;
    }

    seen.add(
      normalized
    );

    result.push(
      caption
    );
  }

  return result;
}

/* =========================================================
   REMOVE HISTORY DUPLICATES
========================================================= */

function removeHistoryDuplicates(
  captions: GeneratedCaption[],
  history: GeneratedCaption[]
): GeneratedCaption[] {

  const historySet =
    new Set(
      history.map(
        (item) =>
          item.content
            .toLowerCase()
            .replace(
              /\s+/g,
              " "
            )
            .trim()
      )
    );

  return captions.filter(
    (caption) => {

      const normalized =
        caption.content
          .toLowerCase()
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      return !historySet.has(
        normalized
      );
    }
  );
}

/* =========================================================
   BUILD FULL CAPTION
========================================================= */

function buildFullCaption(
  caption: GeneratedCaption
): GeneratedCaption {

  const hashtagText =
    caption.hashtags.join(
      " "
    );

  const fullCaption =
`${caption.content}

${hashtagText}

${FOOTER}`;

  return {
    ...caption,
    fullCaption
  };
}

/* =========================================================
   SAVE CAPTIONS
========================================================= */

function saveCaptions(
  campaignId: string,
  captions: GeneratedCaption[]
) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(
      OUTPUT_DIR,
      {
        recursive: true
      }
    );
  }

  const output: SavedCaptions = {
    campaign: campaignId,
    generatedAt: new Date().toISOString(),
    captions
  };

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf-8"
  );

  console.log(
    `\n💾 Đã lưu captions cho campaign "${campaignId}":`
  );

  console.log(
    OUTPUT_FILE
  );
}

/* =========================================================
   MAIN
========================================================= */

async function main() {

  console.log(
    "\n============================================"
  );

  console.log(
    "       GEMINI CAPTION GENERATOR"
  );

  console.log(
    "============================================"
  );

  /*
   * 1. Đọc current campaign
   */

  const config =
    loadCampaignConfig();

  console.log(
    `🎯 Current campaign: ${config.currentCampaign}`
  );

  /*
   * 2. Đọc campaign JSON
   */

  const campaign =
    loadCampaignData(
      config.currentCampaign
    );

  console.log(
    `📢 Campaign: ${campaign.name}`
  );

  console.log(
    `⭐ Main keyword: ${campaign.mainKeyword}`
  );

  console.log(
    `🎯 Primary keywords: ${campaign.primaryKeywords.length}`
  );

  console.log(
    `📦 Product keywords: ${campaign.productKeywords.length}`
  );

  console.log(
    `👥 Audience keywords: ${campaign.audienceKeywords.length}`
  );

  console.log(
    `💡 Angles: ${campaign.angles.length}`
  );

  console.log(
    `#️⃣ Hashtags: ${campaign.hashtags.length}`
  );

  console.log(
    `\n📌 Caption mỗi lần chạy: ${TOTAL_CAPTIONS}`
  );

  /*
   * 3. Load history
   */

  const history =
    loadHistory();

  console.log(
    `📚 Caption trong history: ${history.length}`
  );

  /*
   * 4. Generate 25 captions
   */

  let captions:
    GeneratedCaption[] = [];

  let batchNumber = 1;

  while (
    captions.length <
    TOTAL_CAPTIONS
  ) {

    const remaining =
      TOTAL_CAPTIONS -
      captions.length;

    const count =
      Math.min(
        BATCH_SIZE,
        remaining
      );

    const previous = [
      ...history,
      ...captions
    ];

    const batch =
      await generateBatch(
        batchNumber,
        count,
        campaign,
        previous
      );

    if (
      batch.length === 0
    ) {

      console.log(
        `⚠️ Batch ${batchNumber} không tạo được caption.`
      );

      console.log(
        "🔄 Thử lại..."
      );

      batchNumber++;

      if (
        batchNumber > 20
      ) {

        console.log(
          "❌ Đã thử quá nhiều lần."
        );

        break;
      }

      continue;
    }

    /*
     * Loại caption trùng trong batch.
     */

    let cleanBatch =
      removeDuplicates(
        batch
      );

    /*
     * Loại caption đã có trong history.
     */

    cleanBatch =
      removeHistoryDuplicates(
        cleanBatch,
        [
          ...history,
          ...captions
        ]
      );

    captions.push(
      ...cleanBatch
    );

    console.log(
      `✅ Đã có ${captions.length}/${TOTAL_CAPTIONS} caption.`
    );

    batchNumber++;

    /*
     * Nghỉ giữa request.
     */

    if (
      captions.length <
      TOTAL_CAPTIONS
    ) {

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            1500
          )
      );
    }
  }

  /*
   * Chỉ lấy đúng 25.
   */

  captions =
    captions
      .slice(
        0,
        TOTAL_CAPTIONS
      )
      .map(
        buildFullCaption
      );

  /*
   * Không đủ 25 => không coi là thành công.
   */

  if (
    captions.length <
    TOTAL_CAPTIONS
  ) {

    console.log(
      `\n❌ Chỉ tạo được ${captions.length}/${TOTAL_CAPTIONS} caption.`
    );

    console.log(
      "❌ Không nên dùng batch này để đăng."
    );

    return;
  }

  /*
   * Save current batch.
   */

  saveCaptions(
    config.currentCampaign,
    captions
  );

  /*
   * Save history.
   */

  const updatedHistory = [
    ...history,
    ...captions
  ];

  saveHistory(
    updatedHistory
  );

  /*
   * Keyword statistics.
   */

  console.log(
    "\n📊 Phân bổ keyword:"
  );

  const keywordStats:
    Record<string, number> =
    {};

  for (
    const caption of captions
  ) {

    keywordStats[
      caption.keyword
    ] =
      (
        keywordStats[
          caption.keyword
        ] || 0
      ) + 1;
  }

  console.log(
    "\n--- PRIMARY ---"
  );

  for (
    const keyword of
    campaign.primaryKeywords
  ) {

    console.log(
      `- ${keyword}: ${
        keywordStats[
          keyword
        ] || 0
      }`
    );
  }

  console.log(
    "\n--- PRODUCT ---"
  );

  for (
    const keyword of
    campaign.productKeywords
  ) {

    console.log(
      `- ${keyword}: ${
        keywordStats[
          keyword
        ] || 0
      }`
    );
  }

  console.log(
    "\n--- AUDIENCE ---"
  );

  for (
    const keyword of
    campaign.audienceKeywords
  ) {

    console.log(
      `- ${keyword}: ${
        keywordStats[
          keyword
        ] || 0
      }`
    );
  }

  /*
   * Done.
   */

  console.log(
    "\n============================================"
  );

  console.log(
    "                 HOÀN TẤT"
  );

  console.log(
    "============================================"
  );

  console.log(
    `🎯 Campaign: ${campaign.name}`
  );

  console.log(
    `⭐ Main keyword: ${campaign.mainKeyword}`
  );

  console.log(
    `✅ Caption: ${captions.length}`
  );

  console.log(
    `💾 Output: ${OUTPUT_FILE}`
  );

  console.log(
    `📚 History: ${HISTORY_FILE}`
  );

  console.log(
    `\n👉 captions.json đã được gắn campaign: ${config.currentCampaign}`
  );

  console.log(
    "👉 Chưa đăng Facebook — chỉ mới tạo content."
  );
}

/* =========================================================
   RUN
========================================================= */

main().catch(
  (error) => {

    console.error(
      "\n❌ Lỗi không xử lý được:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);