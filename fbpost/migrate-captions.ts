import fs from "fs";
import path from "path";

type Caption = {
  keyword: string;
  content: string;
  hashtags: string[];
  fullCaption: string;
};

type CampaignConfig = {
  currentCampaign: string;
};

type CaptionStore = {
  campaign: string;
  generatedAt: string;
  captions: Caption[];
};

const ROOT = __dirname;
const CONFIG_FILE = path.join(
  ROOT,
  "config",
  "campaign-config.json"
);
const CAPTIONS_FILE = path.join(
  ROOT,
  "data",
  "captions.json"
);

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

function main(): void {
  const config =
    readJson<CampaignConfig>(
      CONFIG_FILE
    );

  const currentCampaign =
    config.currentCampaign?.trim();

  if (!currentCampaign) {
    throw new Error(
      "campaign-config.json không có currentCampaign."
    );
  }

  const raw =
    readJson<unknown>(
      CAPTIONS_FILE
    );

  /*
   * Nếu captions.json đã ở format mới,
   * không làm gì thêm.
   */
  if (
    raw &&
    !Array.isArray(raw) &&
    typeof raw === "object" &&
    "campaign" in raw &&
    "captions" in raw
  ) {
    const store =
      raw as CaptionStore;

    console.log(
      `✅ captions.json đã ở format mới: campaign=${store.campaign}`
    );

    if (
      store.campaign !==
      currentCampaign
    ) {
      console.log(
        `⚠️ Campaign hiện tại=${currentCampaign}, ` +
        `nhưng captions.json=${store.campaign}.`
      );
    }

    return;
  }

  /*
   * Legacy format: captions.json là mảng caption.
   *
   * Đây chỉ là bước migrate metadata, KHÔNG gọi Gemini.
   */
  if (!Array.isArray(raw)) {
    throw new Error(
      "captions.json không phải mảng caption hợp lệ."
    );
  }

  const captions =
    raw as Caption[];

  if (captions.length < 25) {
    throw new Error(
      `captions.json chỉ có ${captions.length} caption; cần ít nhất 25.`
    );
  }

  const store: CaptionStore = {
    campaign: currentCampaign,
    generatedAt:
      new Date().toISOString(),
    captions,
  };

  fs.writeFileSync(
    CAPTIONS_FILE,
    JSON.stringify(
      store,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "\n✅ Đã migrate captions.json mà KHÔNG gọi Gemini."
  );

  console.log(
    `🎯 Campaign: ${currentCampaign}`
  );

  console.log(
    `📝 Caption: ${captions.length}`
  );

  console.log(
    `📄 File: ${CAPTIONS_FILE}`
  );
}

try {
  main();
} catch (error) {
  console.error(
    "\n❌ Lỗi:\n"
  );
  console.error(error);
  process.exit(1);
}