'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This test only runs against a local server.');
}
const outputDir = process.env.TEST_OUTPUT_DIR || '/tmp/r135-compact-receipt-upload';
const expectedSteps = ['睇單', '認帳', '運算', '結果'];
const expectedAriaSteps = ['上載並分析單據', '核對項目和認帳', '分帳運算', '最終結果'];
const receiptJson = {
  items: [
    { name: '魚蛋', nameEn: 'Fish balls', original: '魚蛋', ja: '', price: 25, qty: 2, totalQty: 2, unit: '碗', total: 50 },
    { name: '奶茶', nameEn: 'Milk tea', original: '奶茶', ja: '', price: 18, qty: 1, totalQty: 1, unit: '杯', total: 18 }
  ],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 68
};

async function initialize(page) {
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
}

async function assertNoOverflow(page, width, label) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth, null, { timeout: 5000 });
  await page.waitForTimeout(100);
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.equal(size.viewport, width, `${label}: requested viewport width`);
  assert.ok(size.document <= width && size.body <= width, `${label}: no horizontal overflow (${JSON.stringify(size)})`);
}

async function assertOriginalFirstStep(page, width, height) {
  const label = `${width}×${height}`;
  const nav = page.locator('.step-nav');
  assert.equal(await nav.isVisible(), true, `${label}: original four-step navigation is visible`);
  const navInfo = await nav.locator('button[data-step]').evaluateAll(nodes => nodes.map(node => ({
    step: node.dataset.step,
    label: node.innerText.replace(/^\d+\s*/, '').trim(),
    ariaLabel: node.getAttribute('aria-label'),
    width: Math.round(node.getBoundingClientRect().width),
    height: Math.round(node.getBoundingClientRect().height),
    inline: Math.abs(
      (node.children[0].getBoundingClientRect().top + node.children[0].getBoundingClientRect().height / 2) -
      (node.children[1].getBoundingClientRect().top + node.children[1].getBoundingClientRect().height / 2)
    ) <= 2
  })));
  assert.deepEqual(navInfo.map(item => item.label), expectedSteps, `${label}: concise step labels are present`);
  assert.equal(navInfo.length, 4, `${label}: all four step buttons remain`);
  assert(navInfo.every(item => item.width >= 44 && item.height >= 44 && item.height <= 56), `${label}: buttons are touchable and compact (${JSON.stringify(navInfo)})`);
  assert(navInfo.every((item, index) => item.inline && item.ariaLabel.includes(expectedAriaSteps[index])), `${label}: number and short label share a row while full labels remain accessible (${JSON.stringify(navInfo)})`);
  const progress = page.getByTestId('step-progress');
  assert.equal(await progress.isVisible(), true, `${label}: progress bar is visible above the step buttons`);
  assert.equal(await progress.getAttribute('aria-valuenow'), '1', `${label}: progress bar reports Step 1`);
  assert.equal(await progress.getAttribute('aria-valuemax'), '4', `${label}: progress bar reports four total stages`);
  assert.equal(await page.getByTestId('app-version-label').innerText(), 'R144', `${label}: R144 is loaded`);

  const keyCard = page.locator('.api-settings-card');
  assert.equal(await keyCard.isVisible(), true, `${label}: original Key status/action card is visible`);
  assert.match(await keyCard.innerText(), /尚未設定免費鎖匙/);
  assert.match(await keyCard.innerText(), /相片／文字需 Key/);
  assert.equal(await page.getByTestId('open-free-key-settings').isVisible(), true, `${label}: the Key card opens the existing setup route`);
  const keyHelpToggle = page.getByTestId('toggle-key-guidance');
  assert.equal(await keyHelpToggle.getAttribute('aria-expanded'), 'false', `${label}: Key explanation starts collapsed`);
  assert.equal(await page.getByTestId('key-guidance-content').isVisible().catch(() => false), false, `${label}: model help does not sit above the upload`);
  assert((await keyHelpToggle.boundingBox()).height >= 44, `${label}: Key help control is at least 44px high`);
  await keyHelpToggle.click();
  assert.equal(await page.getByTestId('key-guidance-content').isVisible(), true, `${label}: application and no-key alternatives are explained`);
  assert.equal(await page.getByTestId('scan-model-settings').isVisible(), true, `${label}: model choice is grouped under Key guidance`);
  assert.equal(await page.getByTestId('scan-model-select').isVisible(), true, `${label}: original model selector remains available`);
  assert.equal(await page.getByTestId('toggle-scan-model-description').getAttribute('aria-expanded'), 'false', `${label}: model details start collapsed`);
  await keyHelpToggle.click();
  assert.equal(await keyHelpToggle.getAttribute('aria-expanded'), 'false', `${label}: Key explanation can be collapsed again`);

  assert.equal(await page.getByTestId('receipt-camera').isVisible(), true, `${label}: camera action remains`);
  assert.equal(await page.getByTestId('receipt-upload').isVisible(), true, `${label}: image selection remains`);
  const uploadLayout = await page.evaluate(() => {
    const zone = document.querySelector('.upload-dropzone-compact').getBoundingClientRect();
    const camera = document.querySelector('[data-testid="receipt-camera"]').getBoundingClientRect();
    const upload = document.querySelector('[data-testid="receipt-upload"]').getBoundingClientRect();
    return { zoneHeight: Math.round(zone.height), cameraHeight: Math.round(camera.height), uploadHeight: Math.round(upload.height), rowDelta: Math.abs(camera.top - upload.top) };
  });
  assert(uploadLayout.cameraHeight >= 48 && uploadLayout.uploadHeight >= 48 && uploadLayout.rowDelta <= 2, `${label}: camera and image controls stay side by side with accessible targets (${JSON.stringify(uploadLayout)})`);
  if (width < 640) {
    assert.match(await page.getByTestId('receipt-upload-prompt').innerText(), /最多選 5 張圖片/, `${label}: compact prompt states the five-image limit`);
    assert.match(await page.getByTestId('receipt-upload-prompt').innerText(), /收據／帳單圖片/, `${label}: compact prompt identifies receipt and bill images`);
    assert.equal(await page.locator('.upload-dropzone-compact .w-20.h-20').isVisible().catch(() => false), false, `${label}: the large decorative receipt circle is hidden on mobile`);
    assert.equal(await page.getByTestId('receipt-image-choice-or').innerText(), '或', `${label}: the two image actions remain clear alternatives`);
    assert(uploadLayout.zoneHeight <= 180, `${label}: empty receipt picker stays compact (${JSON.stringify(uploadLayout)})`);
  } else {
    assert.equal(await page.locator('.upload-dropzone-compact .w-20.h-20').isVisible(), true, `${label}: desktop retains the original receipt illustration`);
    assert.match(await page.locator('.upload-dropzone-compact').innerText(), /選擇單據圖片/, `${label}: desktop retains the original prompt`);
  }
  assert.equal(await page.getByTestId('start-manual').isVisible(), true, `${label}: manual-entry action remains`);
  const methodsIntro = page.getByTestId('step-one-methods-intro');
  assert.equal((await methodsIntro.innerText()).trim(), '以下三種方法處理單據：', `${label}: the Step 1 instructions are concise`);
  const introMetrics = await methodsIntro.evaluate(node => ({ height: node.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(node).fontSize), width: node.clientWidth, scrollWidth: node.scrollWidth }));
  assert(introMetrics.height <= introMetrics.fontSize * 1.6 && introMetrics.fontSize >= 14 && introMetrics.scrollWidth <= introMetrics.width, `${label}: the methods prompt fits on one readable line (${JSON.stringify(introMetrics)})`);
  const heroOrder = await page.evaluate(() => {
    const top = selector => document.querySelector(selector).getBoundingClientRect().top;
    return {
      upload: top('.upload-dropzone'),
      key: top('.api-settings-card'),
      ai: top('[data-testid="receipt-text-import"]'),
      manual: top('[data-testid="start-manual"]')
    };
  });
  assert(heroOrder.upload < heroOrder.key && heroOrder.key < heroOrder.ai && heroOrder.ai < heroOrder.manual, `${label}: upload is the Step 1 hero, ahead of key help and the other paths (${JSON.stringify(heroOrder)})`);
  const cameraBox = await page.getByTestId('receipt-camera').boundingBox();
  assert(cameraBox.y >= 0 && cameraBox.y + cameraBox.height <= height, `${label}: the photo action is on the first screen`);
  const aiHeading = page.getByTestId('toggle-receipt-text-import');
  assert.equal(await aiHeading.isVisible(), true, `${label}: other-AI translation option is discoverable`);
  assert.equal(await aiHeading.getAttribute('aria-expanded'), 'false', `${label}: other-AI translation starts collapsed`);
  await aiHeading.click();
  assert.equal(await aiHeading.getAttribute('aria-expanded'), 'true', `${label}: other-AI translation can be opened`);
  assert.equal(await page.getByTestId('receipt-text-import-title').getAttribute('aria-label'), '其他 AI 翻譯', `${label}: title is concise and accessible`);
  assert.match(await aiHeading.innerText(), /AI.*翻譯/);
  assert.match(await aiHeading.innerText(), /提示詞＋賬單＝專用翻譯檔（\.json）/);
  const inlineAIExamples = await page.evaluate(() => {
    const title = document.querySelector('[data-testid="receipt-text-import-title"]');
    const referenceHeading = document.querySelector('[data-testid="receipt-upload-prompt"] h3');
    const examples = document.querySelector('[data-testid="external-ai-provider-examples"]');
    const row = document.querySelector('[data-testid="receipt-text-import-title-row"]');
    const card = document.querySelector('[data-testid="receipt-text-import"]');
    const toggle = document.querySelector('[data-testid="toggle-receipt-text-import"]');
    const input = document.querySelector('[data-testid="receipt-text-draft"]');
    const titleRect = title.getBoundingClientRect();
    const examplesRect = examples.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const chevron = document.querySelector('[data-testid="receipt-text-import-toggle-icon"]').getBoundingClientRect();
    const chevronSvg = document.querySelector('[data-testid="receipt-text-import-toggle-icon"] svg');
    const cardRect = card.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    return { text: examples.innerText, titleTop: titleRect.top, titleBottom: titleRect.bottom, examplesTop: examplesRect.top, examplesBottom: examplesRect.bottom, titleRight: titleRect.right, examplesLeft: examplesRect.left, examplesRight: examplesRect.right, examplesClientWidth: examples.clientWidth, examplesScrollWidth: examples.scrollWidth, rowRight: rowRect.right, chevronTop: chevron.top, chevronBottom: chevron.bottom, chevronRight: chevron.right, chevronWidth: chevron.width, chevronHeight: chevron.height, chevronStrokeWidth: parseFloat(getComputedStyle(chevronSvg).strokeWidth), cardTop: cardRect.top, cardRight: cardRect.right, toggleRight: toggleRect.right, inputRight: inputRect.right, titleFont: parseFloat(getComputedStyle(title).fontSize), referenceFont: parseFloat(getComputedStyle(referenceHeading).fontSize), titleWeight: parseInt(getComputedStyle(title).fontWeight, 10), referenceWeight: parseInt(getComputedStyle(referenceHeading).fontWeight, 10), examplesFont: parseFloat(getComputedStyle(examples).fontSize), rowHeight: rowRect.height };
  });
  assert.equal(inlineAIExamples.text, '（Google AI 模式、豆包等）', `${label}: provider examples retain both full-width parentheses`);
  assert(inlineAIExamples.titleWeight === inlineAIExamples.referenceWeight && inlineAIExamples.titleWeight >= 700, `${label}: heading retains the regular bold upload-heading weight (${JSON.stringify(inlineAIExamples)})`);
  assert(inlineAIExamples.titleFont >= 15 && (width < 360 ? inlineAIExamples.titleFont < inlineAIExamples.referenceFont : inlineAIExamples.titleFont === inlineAIExamples.referenceFont), `${label}: compact title sizing is limited to the narrow 320px layout (${JSON.stringify(inlineAIExamples)})`);
  const sameLine = Math.min(inlineAIExamples.titleBottom, inlineAIExamples.examplesBottom) - Math.max(inlineAIExamples.titleTop, inlineAIExamples.examplesTop) >= inlineAIExamples.examplesFont * 0.6;
  assert(sameLine && inlineAIExamples.examplesLeft >= inlineAIExamples.titleRight - 1, `${label}: provider examples stay on the title row without overlapping it (${JSON.stringify(inlineAIExamples)})`);
  assert(inlineAIExamples.examplesRight >= inlineAIExamples.rowRight - 1, `${label}: examples align to the right edge of the full text row (${JSON.stringify(inlineAIExamples)})`);
  if (width < 640) {
    assert(inlineAIExamples.chevronTop >= inlineAIExamples.cardTop - 1 && inlineAIExamples.chevronTop <= inlineAIExamples.cardTop + 8, `${label}: chevron stays at the card's top edge (${JSON.stringify(inlineAIExamples)})`);
    assert(inlineAIExamples.toggleRight <= inlineAIExamples.inputRight + 1 && inlineAIExamples.inputRight - inlineAIExamples.toggleRight <= 1 && inlineAIExamples.chevronRight <= inlineAIExamples.inputRight + 1, `${label}: chevron and its toggle hit area do not cross the input's right edge (${JSON.stringify(inlineAIExamples)})`);
    assert(inlineAIExamples.chevronWidth === 20 && inlineAIExamples.chevronHeight === 20 && inlineAIExamples.chevronStrokeWidth === 2, `${label}: chevron retains the app's standard 20px size and stroke (${JSON.stringify(inlineAIExamples)})`);
  }
  assert(inlineAIExamples.chevronBottom <= Math.min(inlineAIExamples.titleTop, inlineAIExamples.examplesTop) + 1, `${label}: upper-right chevron does not overlap the heading or provider text (${JSON.stringify(inlineAIExamples)})`);
  assert(inlineAIExamples.examplesScrollWidth <= inlineAIExamples.examplesClientWidth && inlineAIExamples.rowHeight <= 55, `${label}: the complete examples fit in one line without clipping or overflow (${JSON.stringify(inlineAIExamples)})`);
  assert.equal(await page.getByTestId('external-ai-steps').isVisible(), true, `${label}: AI translation steps are visible`);
  assert((await aiHeading.boundingBox()).height >= 44, `${label}: AI guide toggle is at least 44px high`);
  await assertNoOverflow(page, width, `${label} first step`);
  await page.screenshot({ path: path.join(outputDir, `step1-${width}x${height}.png`), fullPage: false });
  await aiHeading.click();
  assert.equal(await aiHeading.getAttribute('aria-expanded'), 'false', `${label}: other-AI translation returns to its compact row`);
  console.log(`PASS original Step 1 ${label}: four progress labels, Key path, camera/photo, AI translation heading and manual entry`);
}

async function assertKeyApplicationRoute(page) {
  await page.getByTestId('open-free-key-settings').click();
  const keyLink = page.getByTestId('get-free-api-key');
  await keyLink.waitFor({ state: 'visible' });
  assert.match(await keyLink.innerText(), /取得免費金鑰/);
  assert.equal(await page.getByTestId('settings-key-video-link').isVisible(), true, 'the existing OpenRouter Key video link is available in Settings');
  await page.getByTestId('settings-key-video-link').click();
  await page.getByTestId('openrouter-video-card').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('openrouter-video-card').innerText(), /示範申請及設定 OpenRouter API Key/);
  await page.getByTestId('header-back-button').click();
  await page.getByTestId('receipt-camera').waitFor({ state: 'visible' });
  console.log('PASS Key card → Settings → free Key application link and tutorial → return to app');
}

async function assertDisclosurePreferences(page) {
  const keyToggle = page.getByTestId('toggle-key-guidance');
  const aiToggle = page.getByTestId('toggle-receipt-text-import');
  assert.equal(await keyToggle.getAttribute('aria-expanded'), 'false', 'Key options start compact');
  assert.equal(await aiToggle.getAttribute('aria-expanded'), 'false', 'AI guide starts compact');
  await keyToggle.click();
  const modelToggle = page.getByTestId('toggle-scan-model-description');
  assert.equal(await page.getByTestId('scan-model-select').isVisible(), true, 'opening the Key arrow restores the model selector');
  assert.equal(await modelToggle.getAttribute('aria-expanded'), 'false', 'model details stay collapsed until asked');
  await modelToggle.click();
  assert.equal(await page.getByTestId('scan-model-description').isVisible(), true, 'model details can be opened inside the group');
  await keyToggle.click();
  assert.equal(await keyToggle.getAttribute('aria-expanded'), 'false', 'Key arrow collapses the whole settings group');
  assert.equal(await page.getByTestId('scan-model-settings').isVisible().catch(() => false), false, 'model selector and description hide with Key guidance');
  assert.equal(await page.evaluate(() => localStorage.getItem('billSplitterUiDisclosureV1.key-guidance-r133')), 'closed', 'Key arrow stores the combined group state');
  assert.equal(await page.evaluate(() => localStorage.getItem('billSplitterUiDisclosureV1.receipt-ai-import-r133')), 'closed', 'AI guide collapse is stored locally');
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.getByTestId('receipt-camera').waitFor({ state: 'visible' });
  assert.equal(await keyToggle.getAttribute('aria-expanded'), 'false', 'combined Key/model collapse persists after reload');
  assert.equal(await aiToggle.getAttribute('aria-expanded'), 'false', 'AI guide collapse persists after reload');
  assert.equal(await page.getByTestId('key-guidance-content').isVisible().catch(() => false), false, 'collapsed Key group stays hidden after reload');
  assert.equal(await page.getByTestId('scan-model-settings').isVisible().catch(() => false), false, 'collapsed model options stay hidden after reload');
  assert.equal(await page.getByTestId('receipt-text-draft').isVisible().catch(() => false), false, 'collapsed AI content stays hidden after reload');
  await keyToggle.click();
  assert.equal(await page.getByTestId('scan-model-select').isVisible(), true, 'reopened group still exposes the model selector');
  assert.equal(await modelToggle.getAttribute('aria-expanded'), 'true', 'opened model details persist inside the group');
  await modelToggle.click();
  assert.equal(await modelToggle.getAttribute('aria-expanded'), 'false', 'model details remain independently collapsible');
  assert.equal(await page.evaluate(() => localStorage.getItem('billSplitterUiDisclosureV1.model-description-r133')), 'closed', 'model-details choice is stored locally');
  await keyToggle.click();
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.getByTestId('receipt-camera').waitFor({ state: 'visible' });
  assert.equal(await keyToggle.getAttribute('aria-expanded'), 'false', 'combined Key/model group remains collapsed after a second reload');
  await keyToggle.click();
  assert.equal(await modelToggle.getAttribute('aria-expanded'), 'false', 'separate model-details choice also persists in the nested group');
  await modelToggle.click();
  assert.equal(await modelToggle.getAttribute('aria-expanded'), 'true', 'model description can be reopened');
  assert.equal(await page.evaluate(() => localStorage.getItem('billSplitterUiDisclosureV1.model-description-r133')), 'open', 'reopening model details is remembered locally');
  await aiToggle.click();
  assert.equal(await aiToggle.getAttribute('aria-expanded'), 'true', 'AI guide can be reopened independently');
  assert.equal(await page.evaluate(() => localStorage.getItem('billSplitterUiDisclosureV1.receipt-ai-import-r133')), 'open', 'reopening AI guide is remembered locally');
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.getByTestId('receipt-camera').waitFor({ state: 'visible' });
  assert.equal(await keyToggle.getAttribute('aria-expanded'), 'true', 'reopened combined group survives reload');
  assert.equal(await aiToggle.getAttribute('aria-expanded'), 'true', 'reopened AI guide survives reload');
  assert.equal(await modelToggle.getAttribute('aria-expanded'), 'true', 'reopened nested model description survives reload');
  console.log('PASS selective disclosures: compact defaults, local manual collapse, reload, reopen and reload');
}

async function assertOriginalStep2Order(page, width) {
  const heading = page.getByTestId('toggle-receipt-text-import');
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  await page.getByTestId('receipt-text-draft').fill(JSON.stringify(receiptJson));
  await page.getByTestId('submit-receipt-text').click();
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
  assert.equal(await page.getByTestId('step-progress').getAttribute('aria-valuenow'), '2', 'progress advances to Step 2');
  assert.match(await page.getByTestId('verify-summary').innerText(), /2項.*68/);

  const positions = await page.evaluate(() => {
    const top = selector => document.querySelector(selector)?.getBoundingClientRect().top + window.scrollY;
    return {
      summary: top('[data-testid="verify-summary"]'),
      activity: top('[data-testid="activity-settings"]'),
      firstItem: top('[data-testid="verify-item"]'),
      share: top('[data-testid="claim-share-block"]')
    };
  });
  assert(positions.summary < positions.activity, `R127 places the total before activity settings (${JSON.stringify(positions)})`);
  assert(positions.activity < positions.firstItem, `R127 shows activity/link settings before the full item list (${JSON.stringify(positions)})`);
  assert(positions.firstItem < positions.share, `R127 keeps friend-link sharing after item review (${JSON.stringify(positions)})`);
  assert.equal(await page.getByTestId('claim-activity-name').isVisible(), true, 'activity name remains directly available');
  assert.equal(await page.getByTestId('claim-expiry-days').isVisible(), true, 'link validity remains directly available');
  assert.equal(await page.getByTestId('manual-claim-entry-option').isVisible(), true, 'manual claim remains available in Step 2');
  await assertNoOverflow(page, width, 'R127 Step 2');
  await page.screenshot({ path: path.join(outputDir, `step2-${width}x844.png`), fullPage: false });
  console.log(`PASS original Step 2 ${width}px: total → activity/link settings → item list → sharing (${JSON.stringify(positions)})`);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let externalApiRequests = 0;
  try {
    for (const [width, height] of [[320, 844], [390, 844], [320, 700]]) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`${width}×${height}: ${error.message}`));
      await page.route('https://openrouter.ai/**', async route => { externalApiRequests += 1; await route.abort(); });
      await page.route('https://**/*.workers.dev/**', async route => { externalApiRequests += 1; await route.abort(); });
      await initialize(page);
      await assertOriginalFirstStep(page, width, height);
      if (width === 320 && height === 844) {
        await assertDisclosurePreferences(page);
        await assertKeyApplicationRoute(page);
      }
      if (width === 390) await assertOriginalStep2Order(page, width);
      await context.close();
    }

    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const desktop = await desktopContext.newPage();
    desktop.on('pageerror', error => failures.push(`desktop: ${error.message}`));
    await initialize(desktop);
    await assertOriginalFirstStep(desktop, 1280, 900);
    await assertOriginalStep2Order(desktop, 1280);
    await desktopContext.close();

    assert.equal(externalApiRequests, 0, 'the test never contacts external AI or Worker APIs');
    assert.deepEqual(failures, [], failures.join('\n'));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
