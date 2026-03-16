/**
 * 爬取理財咩角專欄瀏覽量最高的 N 篇文章（含文章內容），輸出為 JSON 檔案
 *
 * 原理：
 *   1. 網站使用 Apollo GraphQL + Next.js 動態分頁
 *   2. 逐頁點擊，從 Apollo cache 收集文章 metadata（含瀏覽數）
 *      並從 DOM 連結取得完整 URL（含 slug）
 *   3. 排序後取 Top N，逐一訪問文章頁，從 __NEXT_DATA__ 提取正文
 *   4. 結果寫入 output/top-articles-{timestamp}.json
 *
 * 使用方式：
 *   node scripts/scrape-top-articles.js          # 預設 Top 5
 *   node scripts/scrape-top-articles.js 10       # Top 10
 *   node scripts/scrape-top-articles.js --top 3  # Top 3
 *
 * 初次使用需安裝 Playwright browser：
 *   npx playwright install chromium
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_URL = 'https://www.sinotrade.com.tw/richclub/Financialfreedom';
const OUTPUT_DIR = join(__dirname, '..', 'output');

function parseTopN(args) {
  const flagIdx = args.indexOf('--top');
  if (flagIdx !== -1 && args[flagIdx + 1]) return parseInt(args[flagIdx + 1], 10);
  const num = args.find(a => /^\d+$/.test(a));
  return num ? parseInt(num, 10) : 5;
}

/** 將 HTML 轉為純文字（移除標籤、還原常見 HTML 實體、清理空白） */
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(h[1-6]|p|li|div|blockquote|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 從 Apollo cache 提取所有已載入的文章 metadata */
async function extractFromCache(page) {
  return page.evaluate(() => {
    const cache = window.__APOLLO_CLIENT__?.cache?.extract() ?? {};
    return Object.entries(cache)
      .filter(([k]) => k.startsWith('ContentPayload:'))
      .map(([, v]) => {
        let totalView = v?.media?.totalView;
        if (totalView === undefined && v?.media?.__ref) {
          totalView = cache[v.media.__ref]?.totalView;
        }
        if (!v?.title || totalView === undefined) return null;
        return { id: v._id, title: v.title, totalView };
      })
      .filter(Boolean);
  });
}

/** 從 DOM 收集文章連結（id → fullUrl 的 Map） */
async function extractUrlMap(page) {
  return page.evaluate(() => {
    const map = {};
    document.querySelectorAll('a[href*="/richclub/Financialfreedom/"]').forEach(a => {
      // id 是 URL 最後一段的 24 碼 hex
      const m = a.href.match(/([0-9a-f]{24})(?:[^/]*)?$/i);
      if (m && !map[m[1]]) map[m[1]] = a.href;
    });
    return map;
  });
}

async function getTotalPages(page) {
  return page.evaluate(() => {
    let max = 1;
    document.querySelectorAll('button').forEach(btn => {
      const n = parseInt(btn.textContent.trim(), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return max;
  });
}

async function goToPage(page, pageNum) {
  const beforeIds = await page.evaluate(() => {
    const cache = window.__APOLLO_CLIENT__?.cache?.extract() ?? {};
    return Object.keys(cache).filter(k => k.startsWith('ContentPayload:')).sort().join(',');
  });

  await page.evaluate((target) => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim() === String(target) && !btn.disabled) {
        btn.click();
        return;
      }
    }
  }, pageNum);

  await page.waitForFunction(
    (before) => {
      const cache = window.__APOLLO_CLIENT__?.cache?.extract() ?? {};
      const current = Object.keys(cache).filter(k => k.startsWith('ContentPayload:')).sort().join(',');
      return current !== before;
    },
    beforeIds,
    { timeout: 6000 }
  ).catch(() => page.waitForTimeout(1500));
}

/** 訪問文章頁，取得完整文章資料 */
async function fetchArticleContent(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  return page.evaluate(() => {
    const post = window.__NEXT_DATA__?.props?.pageProps?.post;
    if (!post) return null;
    return {
      title: post.title,
      paragraph: post.paragraph ?? null,
      contentHtml: post.content?.all ?? null,
      author: post.author?.name?.CN ?? post.author?.name?.EN ?? null,
      pubDate: post.pubDate ? new Date(Number(post.pubDate)).toISOString() : null,
      updatedAt: post.updatedAt ? new Date(Number(post.updatedAt)).toISOString() : null,
      totalView: post.media?.totalView ?? null,
      keywords: (post.keywords ?? []).map(k => k?.name?.CN ?? k?.name?.EN).filter(Boolean),
    };
  });
}

async function main() {
  const topN = parseTopN(process.argv.slice(2));
  if (isNaN(topN) || topN < 1) {
    console.error('錯誤：請輸入有效的正整數，例如：node scripts/scrape-top-articles.js 10');
    process.exit(1);
  }

  console.log(`啟動瀏覽器（目標：Top ${topN}）...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-TW',
  });
  const page = await context.newPage();

  // ── Step 1：遍歷所有列表頁，收集 metadata + URL ──
  console.log(`\n開啟列表頁：${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

  const totalPages = await getTotalPages(page);
  console.log(`共 ${totalPages} 頁，開始逐頁載入...\n`);

  const urlMap = await extractUrlMap(page); // 第 1 頁的 URL

  for (let p = 2; p <= totalPages; p++) {
    const before = await extractFromCache(page).then(a => a.length);
    process.stdout.write(`載入第 ${p}/${totalPages} 頁...`);
    await goToPage(page, p);
    const after = await extractFromCache(page).then(a => a.length);
    Object.assign(urlMap, await extractUrlMap(page));
    console.log(` (累計 ${after} 篇${after === before ? '，此頁已預載' : ''})`);
  }

  const allArticles = await extractFromCache(page);

  // 去重、排序、取 Top N
  const uniqueMap = new Map();
  for (const a of allArticles) {
    if (!uniqueMap.has(a.id) || a.totalView > uniqueMap.get(a.id).totalView) {
      uniqueMap.set(a.id, a);
    }
  }
  const topArticles = Array.from(uniqueMap.values())
    .sort((a, b) => b.totalView - a.totalView)
    .slice(0, topN);

  console.log(`\n共擷取 ${uniqueMap.size} 篇（去重後），取 Top ${topN}\n`);

  // ── Step 2：逐一訪問文章頁，取得正文 ──
  const results = [];

  for (let i = 0; i < topArticles.length; i++) {
    const meta = topArticles[i];
    const url = urlMap[meta.id];

    if (!url) {
      console.warn(`⚠️  #${i + 1} 找不到文章 URL（id: ${meta.id}），略過`);
      continue;
    }

    process.stdout.write(`抓取 #${i + 1}：${meta.title.substring(0, 30)}...`);
    const detail = await fetchArticleContent(page, url);

    if (!detail) {
      console.log(' ❌ 抓取失敗');
      continue;
    }

    const contentText = htmlToText(detail.contentHtml);
    results.push({
      rank: i + 1,
      id: meta.id,
      title: detail.title,
      url,
      totalView: meta.totalView,
      author: detail.author,
      pubDate: detail.pubDate,
      updatedAt: detail.updatedAt,
      paragraph: detail.paragraph,
      keywords: detail.keywords,
      content: contentText,
    });

    console.log(` ✓ (${contentText.length} 字)`);
  }

  await browser.close();

  // ── Step 3：寫出 JSON ──
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = join(OUTPUT_DIR, `top-articles-${timestamp}.json`);

  const output = {
    scrapedAt: new Date().toISOString(),
    sourceUrl: TARGET_URL,
    topN,
    articles: results,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  理財咩角｜最多人瀏覽 Top ${topN} 文章`);
  console.log(`${'='.repeat(50)}\n`);

  results.forEach(a => {
    console.log(`#${a.rank}  瀏覽數：${a.totalView.toLocaleString('zh-TW')}`);
    console.log(`    標題：${a.title}`);
    console.log(`    連結：${a.url}`);
    console.log();
  });

  console.log(`結果已儲存至：${outputPath}`);
}

main().catch(err => {
  console.error('執行錯誤：', err.message);
  process.exit(1);
});
