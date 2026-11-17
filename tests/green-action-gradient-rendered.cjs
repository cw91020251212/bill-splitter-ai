'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) {
  throw new Error('This rendered-pixel regression test only runs against a local server.');
}
const screenshotDir = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'green-action-gradient-rendered');
const widths = [320, 390, 430];

function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'screenshot must be PNG');
  let width, height, bitDepth, colorType;
  const data = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, 'expected an 8-bit Chromium screenshot');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported screenshot PNG color type ${colorType}`);
  const rowBytes = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceOffset++];
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above :
        filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : NaN;
      assert.ok(Number.isFinite(predictor), `unsupported PNG filter ${filter}`);
      row[x] = (raw[sourceOffset++] + predictor) & 255;
    }
    row.copy(pixels, y * rowBytes);
    previous = row;
  }
  return { width, height, channels, pixels, rowBytes };
}

function averagePatch(image, x, y) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let py = Math.max(0, y - 1); py <= Math.min(image.height - 1, y + 1); py++) {
    for (let px = Math.max(0, x - 1); px <= Math.min(image.width - 1, x + 1); px++) {
      const i = py * image.rowBytes + px * image.channels;
      for (let c = 0; c < 3; c++) sums[c] += image.pixels[i + c];
      count++;
    }
  }
  return sums.map(value => Math.round(value / count));
}
function linear(value) {
  value /= 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance(rgb) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}
function whiteContrast(rgb) {
  return 1.05 / (luminance(rgb) + 0.05);
}
function hue(rgb) {
  const [r, g, b] = rgb.map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (!delta) return 0;
  let h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

async function assertRenderedDirection(button, label) {
  const style = await button.evaluate(node => {
    const css = getComputedStyle(node);
    return { color: css.color, textFill: css.webkitTextFillColor, image: css.backgroundImage, textShadow: css.textShadow, boxShadow: css.boxShadow };
  });

  const image = decodePng(await button.screenshot({ animations: 'disabled', caret: 'hide' }));
  const insetX = Math.min(10, Math.max(7, Math.floor(image.width / 4)));
  const insetY = Math.min(10, Math.max(7, Math.floor(image.height / 4)));
  const lowerLeft = averagePatch(image, insetX, image.height - insetY);
  const upperRight = averagePatch(image, image.width - insetX, insetY);
  const lowerL = luminance(lowerLeft), upperL = luminance(upperRight);
  const contrastLL = whiteContrast(lowerLeft), contrastUR = whiteContrast(upperRight);
  const metrics = JSON.stringify({ lowerLeft, upperRight, luminanceDelta: +(upperL - lowerL).toFixed(3), contrastLL: +contrastLL.toFixed(2), contrastUR: +contrastUR.toFixed(2), hueLL: +hue(lowerLeft).toFixed(1), hueUR: +hue(upperRight).toFixed(1) });
  assert.ok(lowerL + 0.07 <= upperL, `${label}: rendered lower-left must be visibly darker than upper-right (${metrics})`);
  const channelIncrease = upperRight.map((value, index) => value - lowerLeft[index]);
  assert.ok(channelIncrease.every(value => value >= 35), `${label}: all rendered RGB channels must brighten toward the upper-right (${metrics})`);
  assert.match(style.image, /^linear-gradient\(/, `${label}: clickable green button must render a gradient`);
  for (const stop of ['rgb(15, 107, 66) 0%', 'rgb(31, 154, 100) 50%', 'rgb(98, 210, 154) 100%']) {
    assert.ok(style.image.includes(stop), `${label}: computed gradient must include the original logo stop ${stop} (${style.image})`);
  }
  assert.equal(style.color, 'rgb(255, 255, 255)', `${label}: button label must be white`);
  assert.equal(style.textFill, 'rgb(255, 255, 255)', `${label}: rendered text fill must be white`);
  assert.notEqual(style.textShadow, 'none', `${label}: white label must retain its shadow`);
  assert.notEqual(style.boxShadow, 'none', `${label}: green button must retain its shadow`);
  return metrics;
}

async function assertRenderedSolidBrand(button, label) {
  const style = await button.evaluate(node => {
    const css = getComputedStyle(node);
    return { background: css.backgroundColor, image: css.backgroundImage, color: css.color, textFill: css.webkitTextFillColor, textShadow: css.textShadow, boxShadow: css.boxShadow };
  });
  const image = decodePng(await button.screenshot({ animations: 'disabled', caret: 'hide' }));
  const insetX = Math.min(10, Math.max(7, Math.floor(image.width / 4)));
  const insetY = Math.min(10, Math.max(7, Math.floor(image.height / 4)));
  const lowerLeft = averagePatch(image, insetX, image.height - insetY);
  const upperRight = averagePatch(image, image.width - insetX, insetY);
  const metrics = JSON.stringify({ lowerLeft, upperRight, background: style.background, image: style.image });
  assert.equal(style.background, 'rgb(29, 138, 91)', `${label}: R170 menu control uses the solid brand-green background (${metrics})`);
  assert.equal(style.image, 'none', `${label}: R170 menu control intentionally has no gradient (${metrics})`);
  for (const patch of [lowerLeft, upperRight]) {
    assert.ok(patch.every((value, index) => Math.abs(value - [29, 138, 91][index]) <= 2), `${label}: rendered pixels match the solid brand-green background (${metrics})`);
  }
  assert.equal(style.color, 'rgb(255, 255, 255)', `${label}: button label must be white`);
  assert.equal(style.textFill, 'rgb(255, 255, 255)', `${label}: rendered text fill must be white`);
  assert.equal(style.textShadow, 'none', `${label}: R170 menu control intentionally has no text shadow`);
  assert.notEqual(style.boxShadow, 'none', `${label}: menu control must retain its shadow`);
  return metrics;
}

async function assertRenderedSoftActiveStep(button, label) {
  const style = await button.evaluate(node => {
    const css = getComputedStyle(node);
    const number = getComputedStyle(node.querySelector('.step-nav-number'));
    const text = getComputedStyle(node.querySelector('span:nth-child(2)'));
    return { background: css.backgroundColor, image: css.backgroundImage, color: css.color, textFill: css.webkitTextFillColor, textShadow: css.textShadow, boxShadow: css.boxShadow, numberColor: number.color, numberFill: number.webkitTextFillColor, textColor: text.color, textFillLabel: text.webkitTextFillColor };
  });
  const image = decodePng(await button.screenshot({ animations: 'disabled', caret: 'hide' }));
  const insetX = Math.min(10, Math.max(7, Math.floor(image.width / 4)));
  const insetY = Math.min(10, Math.max(7, Math.floor(image.height / 4)));
  const lowerLeft = averagePatch(image, insetX, image.height - insetY);
  const upperRight = averagePatch(image, image.width - insetX, insetY);
  const metrics = JSON.stringify({ lowerLeft, upperRight, background: style.background, fill: style.textFill });
  assert.equal(style.background, 'rgb(231, 244, 236)', `${label}: normal active step keeps the approved soft-green background (${metrics})`);
  assert.equal(style.image, 'none', `${label}: normal active step has no gradient (${metrics})`);
  for (const patch of [lowerLeft, upperRight]) {
    assert.ok(patch.every((value, index) => Math.abs(value - [231, 244, 236][index]) <= 2), `${label}: rendered pixels match the soft-green background (${metrics})`);
  }
  for (const key of ['color', 'textFill', 'numberColor', 'numberFill', 'textColor', 'textFillLabel']) {
    assert.equal(style[key], 'rgb(18, 102, 66)', `${label}: active-step text uses readable dark green (${key}: ${style[key]})`);
  }
  assert.equal(style.textShadow, 'none', `${label}: dark text does not use the white-state shadow`);
  assert.equal(style.boxShadow, 'none', `${label}: normal active step retains the calm flat treatment`);
  return metrics;
}

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, locale: 'zh-HK' });
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
      const release = await page.locator('meta[name="bill-app-release"]').getAttribute('content');
      assert.equal(release, 'v182-step-one-method-badges-20261117', `served page must be the R170 candidate, not a stale local preview (${release})`);
      const themeHref = await page.locator('link[rel="stylesheet"][href*="theme.css"]').getAttribute('href');
      assert.ok(themeHref?.includes(release), `theme.css must use the same R170 cache token (${themeHref})`);
      assert.equal(await page.getByTestId('app-version-label').innerText(), 'R170');
      await page.getByTestId('receipt-camera').waitFor({ state: 'visible', timeout: 60000 });
      await page.screenshot({ path: path.join(screenshotDir, `green-actions-${width}.png`), fullPage: true, animations: 'disabled' });

      const buttons = page.locator('#root button.green-action:not(:disabled), #root button.bg-brand-600:not(:disabled), #root button[class*="bg-emerald-700"]:not(:disabled)');
      const tested = [];
      for (let i = 0; i < await buttons.count(); i++) {
        const button = buttons.nth(i);
        if (!(await button.isVisible())) continue;
        const keep = await button.evaluate(node => !node.closest('.claim-await-share') &&
          !node.className.toString().includes('bg-slate-800') && !node.className.toString().includes('!bg-amber'));
        if (!keep) continue;
        const testId = await button.getAttribute('data-testid') || (await button.innerText()).trim().replace(/\s+/g, ' ').slice(0, 36);
        tested.push(testId);
        const label = `${width}px ${testId}`;
        if (testId === 'header-action-menu-toggle') {
          await page.mouse.move(0, 0);
          const normal = await assertRenderedSolidBrand(button, `${label} normal`);
          await button.hover();
          const hover = await assertRenderedSolidBrand(button, `${label} hover`);
          await page.mouse.down();
          const active = await assertRenderedSolidBrand(button, `${label} pressed`);
          await page.mouse.move(0, 0);
          await page.mouse.up();
          console.log(`${label}: approved R170 solid brand control; normal ${normal}; hover ${hover}; pressed ${active}`);
          continue;
        }
        await page.mouse.move(0, 0);
        const normal = await assertRenderedDirection(button, `${label} normal`);
        await button.hover();
        const hover = await assertRenderedDirection(button, `${label} hover`);
        await page.mouse.down();
        const active = await assertRenderedDirection(button, `${label} pressed`);
        await page.mouse.move(0, 0);
        await page.mouse.up();
        console.log(`${label}: normal ${normal}; hover ${hover}; pressed ${active}`);
      }
      for (const expected of ['header-action-menu-toggle', 'copy-prompt-open-google-ai', 'receipt-camera']) {
        assert.ok(tested.includes(expected), `${width}px: expected representative green button ${expected}; found ${tested.join(', ')}`);
      }
      console.log(`${width}px screenshots saved; tested ${tested.length} visible green buttons: ${tested.join(', ')}`);

      // Render the active result-step CSS state without running bill calculations.
      await page.locator('#root main[data-current-step]').evaluate(node => node.setAttribute('data-current-step', '4'));
      await page.waitForTimeout(250); // Let the step-nav's 150ms color/shadow transition settle before checking computed styles.
      const resultStep = page.locator('#root:has(main[data-current-step="4"]) .step-nav button:nth-child(4)');
      const resultLabel = `${width}px active result-step tab`;
      await page.mouse.move(0, 0);
      const resultNormal = await assertRenderedSoftActiveStep(resultStep, `${resultLabel} normal`);
      const resultNumberColor = await resultStep.locator('.step-nav-number').evaluate(node => getComputedStyle(node).color);
      assert.equal(resultNumberColor, 'rgb(18, 102, 66)', `${resultLabel}: the step number must be readable on the pale active background`);
      await resultStep.hover();
      await page.waitForTimeout(250);
      const resultHover = await assertRenderedDirection(resultStep, `${resultLabel} hover`);
      const resultHoverNumberColor = await resultStep.locator('.step-nav-number').evaluate(node => getComputedStyle(node).webkitTextFillColor);
      assert.equal(resultHoverNumberColor, 'rgb(255, 255, 255)', `${resultLabel}: hovered gradient step number remains white`);
      await page.mouse.down();
      await page.waitForTimeout(250);
      const resultPressed = await assertRenderedDirection(resultStep, `${resultLabel} pressed`);
      const resultPressedNumberColor = await resultStep.locator('.step-nav-number').evaluate(node => getComputedStyle(node).webkitTextFillColor);
      assert.equal(resultPressedNumberColor, 'rgb(255, 255, 255)', `${resultLabel}: pressed gradient step number remains white`);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      console.log(`${resultLabel}: normal ${resultNormal}; hover ${resultHover}; pressed ${resultPressed}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
