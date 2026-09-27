import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const PUBLIC_DIR = path.join(projectRoot, "public");
const LOGOS_DIR = path.join(PUBLIC_DIR, "logos");
const MISSING_LOGOS_PATH = path.join(PUBLIC_DIR, "missing-logos.json");
const REPORT_PATH = path.join(PUBLIC_DIR, "missing-logos-investing-report.json");

const SEARCH_URL = "https://www.investing.com/search/?q=";
const MARKETS_KR = new Set(["KOSPI", "KOSDAQ", "KONEX", "K-OTC"]);

const DEFAULT_TIMEOUT = 30_000;
const BETWEEN_ITEM_DELAY_MS = { min: 600, max: 1600 };

function randomDelay() {
    const { min, max } = BETWEEN_ITEM_DELAY_MS;
    return min + Math.floor(Math.random() * (max - min));
}

function safeFileName(symbol) {
    return symbol.replace(/[^0-9A-Za-z._-]/g, "_");
}

function resolveExtension(contentType, fallback = "svg") {
    if (!contentType) return fallback;
    const type = contentType.toLowerCase();
    if (type.includes("svg")) return "svg";
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    if (type.includes("gif")) return "gif";
    if (type.includes("ico")) return "ico";
    return fallback;
}

async function ensureLogosDir() {
    if (!existsSync(LOGOS_DIR)) {
        await fs.mkdir(LOGOS_DIR, { recursive: true });
    }
}

async function loadMissingLogos() {
    const raw = await fs.readFile(MISSING_LOGOS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error("missing-logos.json 구조가 예상과 다릅니다. items 배열이 필요합니다.");
    }
    return parsed.items;
}

function filterItems(items, symbolsOption, limitOption) {
    let filtered = items;

    if (symbolsOption) {
        const wanted = new Set(
            symbolsOption
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => s.toUpperCase())
        );
        filtered = filtered.filter((item) => wanted.has(item.symbol.toUpperCase()));
    }

    if (typeof limitOption === "number" && Number.isFinite(limitOption)) {
        filtered = filtered.slice(0, limitOption);
    }

    return filtered;
}

async function extractInstrumentUrl(page, searchTerm) {
    const url = `${SEARCH_URL}${encodeURIComponent(searchTerm)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });

    await page.waitForTimeout(1_000);

    const mainLink = page.locator(".searchSectionMain a[href]").first();
    await mainLink.waitFor({ timeout: DEFAULT_TIMEOUT });

    return mainLink.evaluate((anchor) => anchor.href);
}

async function extractLogoMetadata(page) {
    await page.waitForSelector('img[src*="entities-logos"]', { timeout: DEFAULT_TIMEOUT });
    return page.evaluate(() => {
        const img = document.querySelector('img[src*="entities-logos"]');
        if (!img) return null;
        return {
            url: img.src,
            alt: img.alt || null,
        };
    });
}

async function downloadBuffer(request, url) {
    const response = await request.get(url, {
        timeout: DEFAULT_TIMEOUT,
        headers: {
            Accept: "image/svg+xml,image/png,image/*;q=0.8,*/*;q=0.5",
        },
    });

    if (!response.ok()) {
        throw new Error(`이미지 다운로드 실패 (HTTP ${response.status()})`);
    }

    const contentType = response.headers()["content-type"];
    const ext = resolveExtension(contentType);
    const buffer = await response.body();
    return { buffer, ext, contentType };
}

async function processItem(context, item, options) {
    const page = await context.newPage();
    const { request } = context;
    try {
        const searchTerm = item.searchName || item.symbol;
        const instrumentUrl = await extractInstrumentUrl(page, searchTerm);
        if (!instrumentUrl) {
            return {
                symbol: item.symbol,
                status: "failed",
                reason: "검색 결과에서 종목 URL을 찾지 못했습니다.",
            };
        }

        await page.goto(instrumentUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
        await page.waitForTimeout(800);

        const logoMeta = await extractLogoMetadata(page);
        if (!logoMeta?.url) {
            return {
                symbol: item.symbol,
                status: "failed",
                reason: "종목 페이지에서 로고 이미지를 찾지 못했습니다.",
            };
        }

        const { buffer, ext, contentType } = await downloadBuffer(request, logoMeta.url);
        const filename = `${safeFileName(item.symbol)}.${ext}`;
        const filePath = path.join(LOGOS_DIR, filename);
        await fs.writeFile(filePath, buffer);

        return {
            symbol: item.symbol,
            market: item.market ?? null,
            status: "downloaded",
            provider: "Investing.com",
            file: `logos/${filename}`,
            contentType,
            logoUrl: logoMeta.url,
            instrumentUrl,
        };
    } catch (error) {
        return {
            symbol: item.symbol,
            status: "failed",
            reason: error.message,
        };
    } finally {
        await page.close();
        await page.context().waitForTimeout(randomDelay());
    }
}

function parseArgs(argv) {
    const result = {
        symbols: null,
        limit: null,
    };

    for (const arg of argv) {
        if (arg.startsWith("--symbols=")) {
            result.symbols = arg.replace("--symbols=", "");
        } else if (arg.startsWith("--limit=")) {
            const value = Number(arg.replace("--limit=", ""));
            if (!Number.isNaN(value)) {
                result.limit = value;
            }
        }
    }

    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    await ensureLogosDir();
    const items = await loadMissingLogos();
    const targets = filterItems(items, args.symbols, args.limit);

    if (targets.length === 0) {
        console.log("처리할 대상 심볼이 없습니다.");
        return;
    }

    console.log(`🎯 대상 심볼 ${targets.length}개 처리 시작`);

    const browser = await chromium.launch({
        headless: true,
    });

    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1365, height: 768 },
        locale: "en-US",
        timezoneId: "America/New_York",
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
        });
    });

    const results = [];

    for (const item of targets) {
        console.log(`⏳ ${item.symbol} 처리 중...`);
        const outcome = await processItem(context, item, {});
        results.push(outcome);
        if (outcome.status === "downloaded") {
            console.log(`✅ ${item.symbol} 로고 저장 완료 (${outcome.file})`);
        } else {
            console.log(`⚠️  ${item.symbol} 실패: ${outcome.reason}`);
        }
    }

    await browser.close();

    const report = {
        generatedAt: new Date().toISOString(),
        total: results.length,
        downloaded: results.filter((r) => r.status === "downloaded"),
        failed: results.filter((r) => r.status !== "downloaded"),
    };

    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 4));
    console.log(`📄 보고서 저장 완료: ${path.relative(projectRoot, REPORT_PATH)}`);
    console.log(
        `요약: 성공 ${report.downloaded.length}건 / 실패 ${report.failed.length}건`
    );
}

main().catch((error) => {
    console.error("치명적인 오류 발생", error);
    process.exitCode = 1;
});

