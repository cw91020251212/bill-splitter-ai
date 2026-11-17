'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This test only runs against a local server.');
}
const previewPath = process.env.PREVIEW_PATH || path.join(__dirname, 'step-one-methods-preview-390.png');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
    });
    await page.goto(base.toString(), { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByTestId('receipt-camera').waitFor({ state: 'visible', timeout: 60000 });

    const intro = page.getByTestId('step-one-methods-intro');
    assert.equal((await intro.innerText()).trim(), '以下3種方法處理單據：', '提示句以醒目的阿拉伯數字 3 取代中文數字');
    const introMetrics = await intro.evaluate(node => {
      const number = node.querySelector('[data-testid="step-one-method-count"]');
      return {
        width: node.clientWidth,
        scrollWidth: node.scrollWidth,
        numberText: number?.innerText,
        numberSize: number ? parseFloat(getComputedStyle(number).fontSize) : 0,
        copySize: parseFloat(getComputedStyle(node).fontSize),
        numberWeight: number ? getComputedStyle(number).fontWeight : ''
      };
    });
    assert.equal(introMetrics.numberText, '3', '大號數字 3 有明確標記');
    assert(introMetrics.numberSize >= introMetrics.copySize * 2, `數字 3 至少是提示文字兩倍大：${JSON.stringify(introMetrics)}`);
    assert(introMetrics.numberWeight >= 700, `數字 3 使用粗體：${JSON.stringify(introMetrics)}`);
    assert(introMetrics.scrollWidth <= introMetrics.width, `提示句不會在 390px 手機寬度溢出：${JSON.stringify(introMetrics)}`);

    const badgeIds = ['method-badge-ai', 'method-badge-photo', 'method-badge-manual'];
    for (const [index, id] of badgeIds.entries()) {
      const badge = page.getByTestId(id);
      assert.equal(await badge.innerText(), String(index + 1), `方法 ${index + 1} 顯示正確數字`);
      const box = await badge.boundingBox();
      const style = await badge.evaluate(node => ({
        radius: getComputedStyle(node).borderTopLeftRadius,
        display: getComputedStyle(node).display,
        ariaHidden: node.getAttribute('aria-hidden')
      }));
      assert(box && Math.abs(box.width - box.height) <= 1 && box.width >= 18 && box.width <= 26, `方法 ${index + 1} 的編號是小圓章：${JSON.stringify({ box, style })}`);
      assert(style.ariaHidden === 'true' && (style.radius === '50%' || style.radius.includes('999')), `方法 ${index + 1} 圓章不干擾朗讀且保持圓形：${JSON.stringify(style)}`);
    }
    assert.equal(await page.getByTestId('toggle-receipt-text-import').isVisible(), true, '其他 AI 翻譯仍可操作');
    assert.equal(await page.getByTestId('receipt-camera').isVisible(), true, '拍照操作仍可見');
    assert.equal(await page.getByTestId('receipt-upload').isVisible(), true, '選圖操作仍可見');
    assert.equal(await page.getByTestId('start-manual').isVisible(), true, '手動輸入仍可操作');
    await page.screenshot({ path: previewPath, fullPage: true });

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert(overflow.document <= width && overflow.body <= width, `${width}px 手機畫面沒有橫向溢位：${JSON.stringify(overflow)}`);
      for (const id of badgeIds) assert.equal(await page.getByTestId(id).isVisible(), true, `${width}px 手機仍顯示 ${id}`);
    }
    console.log(`PASS: 390px 預覽已存至 ${previewPath}；阿拉伯數字 3 與三個圓形編號在 320px／390px 均可讀且沒有橫向溢位。`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
