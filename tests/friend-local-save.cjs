'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/tmp/ui-qa/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const SHARE_ID = 'S'.repeat(22);
const IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=';
const DATA = {
  version: 2,
  bill: { date: '2026-11-15', payer: 'Organizer', currency: 'HKD', sourceCurrency: 'HKD', billTotal: 100, sourceBillTotal: 100, paymentMethods: ['現金'] },
  participants: [{ name: 'Amy', total: 30, subtotal: 29.99, settlementRoundingAdjustment: 0.01 }, { name: 'Ben', total: 70, subtotal: 70 }],
  items: [{ id: '01', number: '01', name: '奶茶', quantity: 1, unit: '杯', sourceAmount: 100, allocatedAmount: 100,
    shares: [{ person: 'Amy', quantity: 1, amount: 30, unit: '杯', isActualUnit: true }, { person: 'Ben', quantity: 1, amount: 70, unit: '杯', isActualUnit: true }] }],
  adjustments: [], images: [{ mimeType: 'image/png', data: IMAGE }]
};

async function main() {
  const externalWrites = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = path.resolve(ROOT, `.${decodeURIComponent(url.pathname === '/' ? '/detailed-view.html' : url.pathname)}`);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { response.writeHead(404).end(); return; }
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type }); response.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/api/shares/') && route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', data: DATA, expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
      }
      if (url.pathname.includes('/api/shares/') || url.hostname.endsWith('.workers.dev') || url.hostname === 'ntfy.sh') {
        externalWrites.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${base}detailed-view.html?share=${SHARE_ID}&e=${Math.floor(Date.now() / 1000) + 86400}`);
    await page.locator('#preview-content').waitFor({ state: 'visible' });
    await page.locator('#member-select').selectOption({ label: 'Amy' });
    const personalDetails = await page.locator('#personal-details').innerText();
    assert.match(personalDetails, /尾數調整（HKD）/);
    assert.doesNotMatch(personalDetails, /換算分位調整/, 'same-currency rounding is not described as conversion');
    const saveButton = page.locator('#save-friend-bill');
    await saveButton.waitFor({ state: 'visible', timeout: 5000 });
    await saveButton.click();
    await page.locator('#save-friend-bill-status').getByText(/已保存|已儲存/).waitFor({ state: 'visible', timeout: 5000 });
    const record = await page.evaluate(id => new Promise((resolve, reject) => {
      const request = indexedDB.open('billSplitterFriendHistory', 1);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('bills')) { db.close(); resolve(null); return; }
        const tx = db.transaction('bills', 'readonly');
        const get = tx.objectStore('bills').get(id);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
      };
      request.onerror = () => reject(request.error);
    }), `${SHARE_ID}:Amy`);
    assert.ok(record, 'the chosen friend has a durable local record');
    assert.equal(record.name, 'Amy');
    assert.equal(record.total, 30);
    assert.equal(record.items.length, 1);
    assert.deepEqual(record.items[0].shares.map(share => share.person), ['Amy'], 'other friends’ claims are not copied into this person’s local record');
    assert.equal(record.images.length, 1, 'receipt image is stored with the local bill');
    assert.equal(record.images[0].data, IMAGE);
    await page.locator('#view-friend-history').click();
    await page.getByRole('heading', { name: '我的本機帳單' }).waitFor({ state: 'visible', timeout: 5000 });
    const historyText = await page.locator('main').innerText();
    assert.match(historyText, /Amy/);
    assert.match(historyText, /30/);
    assert.doesNotMatch(historyText, /Ben/, 'saved history does not show another friend');
    assert.equal(await page.locator('#friend-history-list img[alt="收據 1"]').count(), 1, 'original receipt image is available from local history');
    assert.deepEqual(externalWrites, [], 'no external mutation is sent');
    assert.deepEqual(errors, [], 'the page has no runtime errors');
    await context.close();
    console.log('PASS friend-local-save: selected personal bill and receipts persist in local IndexedDB; no external writes');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
