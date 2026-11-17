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
const badgeSpecs = [
  { id: 'method-badge-ai', panel: '[data-testid="receipt-text-import"]', text: '[data-testid="receipt-text-import-title"]' },
  { id: 'method-badge-photo', panel: '[data-testid="scan-start"] .upload-dropzone', text: '[data-testid="receipt-upload-prompt"] h3' },
  { id: 'method-badge-manual', panel: '[data-testid="start-manual"]', text: null }
];
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

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
    assert.equal(await page.getByTestId('toggle-receipt-text-import').isVisible(), true, '其他 AI 翻譯仍可操作');
    assert.equal(await page.getByTestId('receipt-camera').isVisible(), true, '拍照操作仍可見');
    assert.equal(await page.getByTestId('receipt-upload').isVisible(), true, '選圖操作仍可見');
    assert.equal(await page.getByTestId('start-manual').isVisible(), true, '手動輸入仍可操作');

    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert(overflow.document <= width && overflow.body <= width, `${width}px 手機畫面沒有橫向溢位：${JSON.stringify(overflow)}`);
      const introMetrics = await intro.evaluate(node => {
        const number = node.querySelector('[data-testid="step-one-method-count"]');
        const style = number ? getComputedStyle(number) : null;
        return {
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
          numberText: number?.innerText,
          numberSize: style ? parseFloat(style.fontSize) : 0,
          copySize: parseFloat(getComputedStyle(node).fontSize),
          numberWeight: style?.fontWeight || '',
          color: style?.color || '',
          verticalAlign: style?.verticalAlign || '',
          marginLeft: style ? parseFloat(style.marginInlineStart) : 0,
          marginRight: style ? parseFloat(style.marginInlineEnd) : 0
        };
      });
      assert.equal(introMetrics.numberText, '3', `${width}px：大號數字 3 有明確標記`);
      assert(introMetrics.numberSize >= introMetrics.copySize * 2, `${width}px：數字 3 至少是提示文字兩倍大：${JSON.stringify(introMetrics)}`);
      assert(introMetrics.numberWeight >= 700, `${width}px：數字 3 使用粗體：${JSON.stringify(introMetrics)}`);
      assert.equal(introMetrics.color, 'rgb(29, 78, 137)', `${width}px：數字 3 使用既有藍色 accent：${JSON.stringify(introMetrics)}`);
      assert.equal(introMetrics.verticalAlign, 'baseline', `${width}px：數字 3 底線與中文字對齊：${JSON.stringify(introMetrics)}`);
      assert(introMetrics.marginLeft >= 1 && introMetrics.marginRight >= 1, `${width}px：數字 3 與兩側中文字有自然間距：${JSON.stringify(introMetrics)}`);
      assert(introMetrics.scrollWidth <= introMetrics.width, `${width}px：提示句不溢出：${JSON.stringify(introMetrics)}`);

      const badgeOffsets = [];
      for (const [index, spec] of badgeSpecs.entries()) {
        const badge = page.getByTestId(spec.id);
        assert.equal(await badge.innerText(), String(index + 1), `${width}px：方法 ${index + 1} 顯示正確數字`);
        const panel = page.locator(spec.panel);
        const metrics = await panel.evaluate((owner, id) => {
          const node = owner.querySelector(`[data-testid="${id}"]`);
          const rect = node.getBoundingClientRect();
          const ownerRect = owner.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            x: rect.left - ownerRect.left,
            y: rect.top - ownerRect.top,
            width: rect.width,
            height: rect.height,
            position: style.position,
            offsetParentMatches: node.offsetParent === owner,
            radius: style.borderTopLeftRadius,
            ariaHidden: node.getAttribute('aria-hidden')
          };
        }, spec.id);
        assert(metrics.position === 'absolute' && metrics.offsetParentMatches, `${width}px：${spec.id} 固定錨定於自己的方法面板：${JSON.stringify(metrics)}`);
        assert(metrics.x >= 8 && metrics.y >= 8, `${width}px：${spec.id} 與面板邊緣保持內縮：${JSON.stringify(metrics)}`);
        assert(Math.abs(metrics.width - metrics.height) <= 1 && metrics.width >= 18 && metrics.width <= 26, `${width}px：方法 ${index + 1} 的編號是小圓章：${JSON.stringify(metrics)}`);
        assert(metrics.ariaHidden === 'true' && (metrics.radius === '50%' || metrics.radius.includes('999')), `${width}px：${spec.id} 圓章不干擾朗讀且保持圓形：${JSON.stringify(metrics)}`);
        if (spec.text) {
          const pageTextBox = await page.locator(spec.text).boundingBox();
          const panelBox = await panel.boundingBox();
          const textBox = pageTextBox && { x: pageTextBox.x - panelBox.x, y: pageTextBox.y - panelBox.y, width: pageTextBox.width, height: pageTextBox.height };
          assert(textBox && !overlaps(metrics, textBox), `${width}px：${spec.id} 不遮住面板標題：${JSON.stringify({ badge: metrics, textBox })}`);
        } else {
          const textBox = await badge.evaluate(node => {
            const textNode = [...node.parentElement.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const rect = range.getBoundingClientRect();
            return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
          });
          const panelBox = await panel.boundingBox();
          assert(!overlaps(metrics, { x: textBox.x - panelBox.x, y: textBox.y - panelBox.y, width: textBox.width, height: textBox.height }), `${width}px：手動輸入圓章不遮住標題：${JSON.stringify({ badge: metrics, textBox })}`);
        }
        badgeOffsets.push({ x: metrics.x, y: metrics.y });
      }
      assert(Math.max(...badgeOffsets.map(item => item.x)) - Math.min(...badgeOffsets.map(item => item.x)) <= 2, `${width}px：三個圓章的左側內縮一致：${JSON.stringify(badgeOffsets)}`);
      assert(Math.max(...badgeOffsets.map(item => item.y)) - Math.min(...badgeOffsets.map(item => item.y)) <= 2, `${width}px：三個圓章位於各自面板同一左上位置：${JSON.stringify(badgeOffsets)}`);
      const widthPreviewPath = path.join(path.dirname(previewPath), `step-one-methods-preview-${width}.png`);
      await page.screenshot({ path: widthPreviewPath, fullPage: true });
    }
    console.log(`PASS: 320px／390px／430px 預覽已存至 ${path.dirname(previewPath)}；數字 3 的顏色、比例、基線、間距及三個圓章的位置／避讓均通過。`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
