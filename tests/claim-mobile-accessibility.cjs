'use strict';
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This accessibility regression test only runs against a local server.');
}

function contrast(foreground, background) {
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      value /= 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await page.goto(new URL('claim.html', base).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href?.includes('ui-refresh.css')));
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'accessibility-fixture';
      fixture.className = 'page';
      fixture.innerHTML = `
        <section class="panel">
          <p id="hint" class="hint">認證碼提示</p>
          <p id="session-note" class="session-note">同一手機認領提示</p>
          <p id="identity-hint" class="hint identity-hint">身份確認提示</p>
          <div class="item-card"><p id="item-original" class="item-original">原有項目文字</p><p id="item-meta" class="item-meta">項目說明</p></div>
          <p id="claim-mode-hint" class="claim-mode-hint">認領方式說明</p>
          <p id="divider" class="reply-choice-divider">或</p>
          <p id="preview-subtitle" class="preview-subtitle">認領預覽說明</p>
          <details id="recovery-details" class="recovery-details"><summary>認證碼復原說明</summary></details>
          <p id="share-help" class="share-help">分享說明</p>
          <div class="code-input-row"><input class="name-input pin-input" aria-label="認證碼"><button id="text-action" class="text-action" type="button">隨機</button></div>
          <button id="selected-option" class="claim-mode-option" type="button" aria-pressed="true">共同分攤</button>
        </section>
        <section class="result-add-person-panel">
          <div class="result-add-person-inner">
            <div class="result-add-person-copy"><strong class="result-add-person-title">漏咗朋友？可補加另一位</strong><p id="new-friend-explanation" class="result-add-person-description">新朋友可用同一條連結填姓名和認帳；原有認帳不會被改。</p></div>
            <button class="language-toggle result-language-toggle" type="button">English</button>
            <button class="button primary" type="button">新增一位</button>
          </div>
        </section>`;
      document.body.append(fixture);
    });

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const sizes = await page.evaluate(() => {
        const ids = ['hint', 'session-note', 'identity-hint', 'item-original', 'item-meta', 'claim-mode-hint', 'divider', 'preview-subtitle', 'recovery-details', 'share-help', 'new-friend-explanation'];
        return {
          texts: Object.fromEntries(ids.map(id => [id, parseFloat(getComputedStyle(document.getElementById(id)).fontSize)])),
          action: (() => { const element = document.getElementById('text-action'); const rect = element.getBoundingClientRect(); return { fontSize: parseFloat(getComputedStyle(element).fontSize), height: rect.height }; })(),
          selected: (() => { const style = getComputedStyle(document.getElementById('selected-option')); return { color: style.color, background: style.backgroundColor }; })(),
          panelControls: [...document.querySelectorAll('#accessibility-fixture .result-add-person-panel button')].map(element => ({ text: element.innerText, height: element.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(element).fontSize) }))
        };
      });
      for (const [id, fontSize] of Object.entries(sizes.texts)) {
        assert.ok(fontSize >= 15, `${width}px: ${id} should be at least 15px, got ${fontSize}px`);
      }
      assert.ok(sizes.action.fontSize >= 15, `${width}px: text action should be at least 15px, got ${sizes.action.fontSize}px`);
      assert.ok(sizes.action.height >= 44, `${width}px: text action hit target should be at least 44px, got ${sizes.action.height}px`);
      assert.ok(contrast(sizes.selected.color, sizes.selected.background) >= 4.5, `${width}px: selected blue control contrast is ${contrast(sizes.selected.color, sizes.selected.background).toFixed(2)}:1`);
      for (const control of sizes.panelControls) {
        assert.ok(control.height >= 44, `${width}px: ${control.text} hit target should be at least 44px, got ${control.height}px`);
        assert.ok(control.fontSize >= 15, `${width}px: ${control.text} should be at least 15px, got ${control.fontSize}px`);
      }
      const hintContrast = await page.evaluate(() => {
        const element = document.getElementById('hint');
        const foreground = getComputedStyle(element).color;
        return ['#eaf3f9', '#dcebf5'].map(background => {
          const channel = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).map(value => {
            value /= 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          const lum = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
            value /= 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          const [a, b] = [lum(rgb(foreground)), lum(channel(background))].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        });
      });
      assert.ok(hintContrast.every(value => value >= 4.5), `${width}px: muted hint contrast should be at least 4.5:1, got ${hintContrast.map(x => x.toFixed(2)).join('/')}`);
    }
    console.log('PASS 390px and 320px claim view: 15px hint text, 44px touch targets, and readable contrast.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
