import type { Browser } from "playwright";

// One Chromium per worker process, launched the first time a report needs it and relaunched if
// it dies. A page is cheap; a browser is not, and a report queue that launches one per job spends
// more time starting browsers than rendering.

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

const CONCURRENCY = Number(process.env.PDF_CONCURRENCY ?? 2);
let inFlight = 0;
const waiting: (() => void)[] = [];

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (!launching) {
    const { chromium } = await import("playwright");
    launching = chromium
      .launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] })
      .then((launched) => {
        browser = launched;
        launching = null;
        launched.on("disconnected", () => {
          browser = null;
        });
        return launched;
      })
      .catch((error) => {
        launching = null;
        throw error;
      });
  }
  return launching;
}

/** Renders a self-contained HTML document to an A4 PDF. */
export async function renderPdf(html: string): Promise<Buffer> {
  await acquire();
  try {
    const instance = await getBrowser();
    const context = await instance.newContext();
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#6b7280;padding:0 15mm;text-align:right;">' +
          '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      return Buffer.from(pdf);
    } finally {
      await context.close();
    }
  } finally {
    release();
  }
}

/** Closes the browser on shutdown; the worker calls this from its SIGTERM handler. */
export async function closeBrowser(): Promise<void> {
  const instance = browser;
  browser = null;
  await instance?.close().catch(() => undefined);
}

function acquire(): Promise<void> {
  if (inFlight < CONCURRENCY) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release(): void {
  inFlight -= 1;
  waiting.shift()?.();
}
