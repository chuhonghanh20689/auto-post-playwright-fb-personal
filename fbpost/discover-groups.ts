import { chromium, Page, Locator } from "@playwright/test";
import fs from "fs";
import path from "path";

type Group = {
  name: string;
  url: string;
};

const PROFILE_DIR = path.resolve(
  "./fbpost/.browser-profile"
);

const OUTPUT_FILE = path.resolve(
  "./fbpost/data/groups.json"
);

const GROUPS_URL =
  "https://www.facebook.com/groups/joins/?nav_source=tab";

// Facebook PERSONAL account only.
// This file intentionally does NOT switch Page/profile.

const BAD_EXACT = new Set([
  "view group",
  "join",
  "joined",
  "invite",
  "share",
  "more",
  "see more",
  "see all",
  "groups",
  "group",
  "join group",
  "joined group",
  "invite members",
  "more options",
  "public group",
  "private group",
  "facebook",
  "home",
  "groups you've joined",
  "your groups",
]);

function cleanText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function isBadName(value: string): boolean {
  const s = cleanText(value);

  if (!s || s.length < 2 || s.length > 200) {
    return true;
  }

  const lower = s.toLowerCase();

  if (BAD_EXACT.has(lower)) {
    return true;
  }

  if (/^view\s+group$/i.test(s)) {
    return true;
  }

  if (/^you\s+last\s+visited$/i.test(s)) {
    return true;
  }

  if (/^(last\s+active|last\s+visited)\b/i.test(s)) {
    return true;
  }

  if (
    /^(about|members?|photos?|files?|events?|posts?)$/i.test(
      s
    )
  ) {
    return true;
  }

  if (
    /^\d[\d,.]*\s*(members?|people)$/i.test(
      s
    )
  ) {
    return true;
  }

  if (/^(public|private)\s+group$/i.test(s)) {
    return true;
  }

  if (
    /^(joined|join|invite|share|more|see more|see all)$/i.test(
      s
    )
  ) {
    return true;
  }

  if (
    /^\d+\s*(new|posts?|notifications?)$/i.test(
      s
    )
  ) {
    return true;
  }

  if (
    /^(a|an)\s+(day|week|month|year)s?\s+ago$/i.test(
      s
    )
  ) {
    return true;
  }

  if (
    /^\d+\s+(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/i.test(
      s
    )
  ) {
    return true;
  }

  if (/^(today|yesterday|just now)$/i.test(s)) {
    return true;
  }

  return false;
}

function usefulName(value: string): boolean {
  return !isBadName(value);
}

function normalizeGroupUrl(
  rawUrl: string
): string | null {
  try {
    const u = new URL(rawUrl);

    if (
      u.hostname !== "facebook.com" &&
      u.hostname !== "www.facebook.com"
    ) {
      return null;
    }

    const match = u.pathname.match(
      /^\/groups\/([^/]+)\/?$/i
    );

    if (!match) {
      return null;
    }

    const slug = match[1];

    if (
      [
        "feed",
        "discover",
        "joins",
        "joined",
        "notifications",
        "search",
      ].includes(slug.toLowerCase())
    ) {
      return null;
    }

    return `https://www.facebook.com/groups/${slug}/`;
  } catch {
    return null;
  }
}

async function waitForLogin(
  page: Page
): Promise<void> {
  const url = page.url();

  if (
    url.includes("/login") ||
    url.includes("/checkpoint") ||
    url.includes("/two_step_verification")
  ) {
    throw new Error(
      "Facebook chưa ở trạng thái đăng nhập ổn định. Hãy login/xác minh rồi chạy lại."
    );
  }
}

async function extractVisibleGroups(
  page: Page
): Promise<Array<{ url: string; candidates: string[] }>> {
  const anchors =
    await page
      .locator('a[href*="/groups/"]')
      .all();

  const results: Array<{
    url: string;
    candidates: string[];
  }> = [];

  for (const anchor of anchors) {
    const href =
      await anchor.getAttribute("href");

    if (!href) {
      continue;
    }

    const normalizedUrl =
      normalizeGroupUrl(href);

    if (!normalizedUrl) {
      continue;
    }

    const candidates: string[] = [];

    const addCandidate = (
      value: string | null | undefined
    ): void => {
      if (!value) {
        return;
      }

      const cleaned =
        cleanText(value);

      if (
        usefulName(cleaned) &&
        !candidates.includes(cleaned)
      ) {
        candidates.push(cleaned);
      }
    };

    addCandidate(
      await anchor.getAttribute("aria-label")
    );

    addCandidate(
      await anchor.getAttribute("title")
    );

    let current: Locator = anchor;

    for (
      let level = 0;
      level < 8;
      level++
    ) {
      current =
        current.locator("xpath=..");

      if (
        (await current.count()) === 0
      ) {
        break;
      }

      const cardText =
        cleanText(
          await current
            .innerText()
            .catch(() => "")
        );

      if (
        cardText.length < 20 ||
        cardText.length > 1200
      ) {
        continue;
      }

      const groupLinkCount =
        await current
          .locator('a[href*="/groups/"]')
          .count()
          .catch(() => 0);

      if (
        groupLinkCount < 1 ||
        groupLinkCount > 4
      ) {
        continue;
      }

      const headings =
        await current
          .locator(
            'h1,h2,h3,h4,[role="heading"]'
          )
          .allTextContents()
          .catch(() => []);

      for (const heading of headings) {
        addCandidate(heading);
      }

      const images =
        await current
          .locator("img[alt]")
          .all()
          .catch(() => []);

      for (const image of images) {
        addCandidate(
          await image.getAttribute("alt")
        );

        addCandidate(
          await image.getAttribute("title")
        );
      }

      const lines =
        cardText
          .split(/\r?\n/)
          .map(cleanText)
          .filter(Boolean);

      for (const line of lines) {
        addCandidate(line);

        if (candidates.length >= 5) {
          break;
        }
      }

      const cardLinks =
        await current
          .locator('a[href*="/groups/"]')
          .all()
          .catch(() => []);

      for (const cardLink of cardLinks) {
        addCandidate(
          await cardLink.getAttribute("aria-label")
        );

        addCandidate(
          await cardLink.getAttribute("title")
        );
      }

      break;
    }

    results.push({
      url: normalizedUrl,
      candidates,
    });
  }

  return results;
}

function saveNamedGroups(
  groups: Map<string, Group>
): number {
  const named =
    Array.from(
      groups.values()
    ).filter((group) =>
      usefulName(group.name)
    );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      named,
      null,
      2
    ),
    "utf8"
  );

  return named.length;
}

async function main(): Promise<void> {
  console.log(
    "\n========================================"
  );
  console.log(
    "🚀 FACEBOOK PERSONAL GROUP DISCOVERY"
  );
  console.log(
    "========================================"
  );
  console.log(
    `📁 Profile: ${PROFILE_DIR}`
  );
  console.log(
    "👤 Identity: FACEBOOK CÁ NHÂN"
  );
  console.log(
    "🚫 Không switch Page/profile"
  );
  console.log(
    "🚫 Không mở từng group để lấy tên"
  );

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    { recursive: true }
  );

  const context =
    await chromium.launchPersistentContext(
      PROFILE_DIR,
      {
        headless: false,
        viewport: null,
        args: [
          "--disable-blink-features=AutomationControlled",
        ],
      }
    );

  const page =
    context.pages()[0] ||
    await context.newPage();

  try {
    console.log("\n🌐 Mở Facebook...");

    await page.goto(
      "https://www.facebook.com/",
      {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      }
    );

    await page.waitForTimeout(3_500);
    await waitForLogin(page);

    console.log(
      "🌐 Mở danh sách Groups đã tham gia..."
    );

    await page.goto(
      GROUPS_URL,
      {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      }
    );

    await page.waitForTimeout(4_500);
    await waitForLogin(page);

    const bodyText =
      await page
        .locator("body")
        .innerText();

    const totalMatch =
      bodyText.match(
        /All groups you've joined\s*\(?\s*([\d,]+)/i
      );

    const expectedTotal =
      totalMatch
        ? Number(
            totalMatch[1]
              .replace(/,/g, "")
          )
        : null;

    if (expectedTotal) {
      console.log(
        `📊 Facebook báo: ${expectedTotal} groups`
      );
    } else {
      console.log(
        "⚠️ Không đọc được tổng số group từ Facebook."
      );
    }

    const groups =
      new Map<string, Group>();

    let previousCount = 0;
    let noChange = 0;

    console.log(
      "\n🔄 Bắt đầu scroll và lấy tên TRỰC TIẾP TỪ DOM...\n"
    );

    for (
      let round = 1;
      round <= 300;
      round++
    ) {
      const visible =
        await extractVisibleGroups(page);

      for (const item of visible) {
        const url =
          normalizeGroupUrl(
            item.url
          );

        if (!url) {
          continue;
        }

        const candidate =
          item.candidates.find(
            usefulName
          ) || "";

        const existing =
          groups.get(url);

        if (!existing) {
          groups.set(
            url,
            {
              name: candidate,
              url,
            }
          );
        } else if (
          !usefulName(existing.name) &&
          usefulName(candidate)
        ) {
          existing.name =
            candidate;
        }
      }

      const count =
        groups.size;

      const namedCount =
        Array.from(
          groups.values()
        ).filter((group) =>
          usefulName(group.name)
        ).length;

      console.log(
        `🔄 Scroll ${round}: ${count}` +
        `${
          expectedTotal
            ? ` / ${expectedTotal}`
            : ""
        } URLs | ${namedCount} có tên`
      );

      if (
        round % 10 === 0 &&
        namedCount > 0
      ) {
        const saved =
          saveNamedGroups(
            groups
          );

        console.log(
          `💾 Auto-save: ${saved} groups`
        );
      }

      if (
        expectedTotal &&
        count >= expectedTotal
      ) {
        console.log(
          "\n🎉 Đã thu thập đủ số URL Facebook báo."
        );
        break;
      }

      if (
        count === previousCount
      ) {
        noChange++;
      } else {
        noChange = 0;
      }

      previousCount =
        count;

      if (noChange >= 8) {
        console.log(
          "⚠️ 8 vòng không tăng → scroll mạnh hơn..."
        );

        await page.mouse.wheel(
          0,
          5000
        );

        await page.waitForTimeout(
          1600
        );

        noChange = 0;
      } else {
        await page.mouse.wheel(
          0,
          2500
        );

        await page.waitForTimeout(
          900
        );
      }
    }

    const allGroups =
      Array.from(
        groups.values()
      );

    const named =
      allGroups.filter(
        (group) =>
          usefulName(group.name)
      );

    const unnamed =
      allGroups.filter(
        (group) =>
          !usefulName(group.name)
      );

    console.log(
      "\n========================================"
    );
    console.log(
      "              KẾT QUẢ"
    );
    console.log(
      "========================================"
    );

    console.log(
      `📦 Tổng URL group: ${allGroups.length}`
    );

    console.log(
      `✅ Có tên lấy trực tiếp từ DOM: ${named.length}`
    );

    console.log(
      `⚠️ Không có tên trong DOM: ${unnamed.length}`
    );

    if (
      unnamed.length
    ) {
      console.log(
        "\n⚠️ Một số URL không có tên rõ ràng trong DOM:"
      );

      unnamed
        .slice(0, 30)
        .forEach((group) =>
          console.log(
            `   ${group.url}`
          )
        );
    }

    if (
      named.length === 0
    ) {
      throw new Error(
        "Không lấy được tên group nào từ DOM. Không ghi đè groups.json."
      );
    }

    fs.writeFileSync(
      OUTPUT_FILE,
      JSON.stringify(
        named,
        null,
        2
      ),
      "utf8"
    );

    console.log(
      `\n💾 Đã ghi ${named.length} groups vào:`
    );

    console.log(
      OUTPUT_FILE
    );

    console.log(
      "\n🔎 10 GROUP ĐẦU:"
    );

    named
      .slice(0, 10)
      .forEach(
        (group, index) => {
          console.log(
            `${index + 1}. ${group.name}`
          );

          console.log(
            `   ${group.url}`
          );
        }
      );

    console.log(
      "\n🟢 Discovery hoàn tất."
    );

    await context.close();
  } catch (error) {
    console.error(
      "\n❌ DISCOVERY ERROR"
    );

    console.error(error);

    await context
      .close()
      .catch(() => {});

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
