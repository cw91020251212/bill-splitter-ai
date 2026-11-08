/*
 * Optional in-browser PaddleOCR.js route.
 * Images are decoded and recognized locally; the caller decides whether to
 * send the extracted text to a language model. The SDK is loaded only when
 * this route is first used, so the default Dots3-Note path stays lightweight.
 */
(function (root) {
  'use strict';

  if (root.PaddleReceiptOcr && typeof root.PaddleReceiptOcr.recognizeImages === 'function') return;

  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm';
  var enginePromise = null;

  function imageDataToBlob(image) {
    var binary = root.atob(image.data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: image.mimeType || 'image/jpeg' });
  }

  function itemPosition(item) {
    var poly = Array.isArray(item.poly) ? item.poly : [];
    if (!poly.length) return { x: null, y: null };
    var xs = poly.map(function (point) { return Number(point && point[0]) || 0; });
    var ys = poly.map(function (point) { return Number(point && point[1]) || 0; });
    return {
      x: xs.reduce(function (sum, value) { return sum + value; }, 0) / xs.length,
      y: ys.reduce(function (sum, value) { return sum + value; }, 0) / ys.length
    };
  }

  function linesFromResult(result) {
    var source = Array.isArray(result && result.items) ? result.items : [];
    var rows = source.map(function (item, index) {
      var pos = itemPosition(item);
      return { text: String(item && item.text || '').trim(), x: pos.x, y: pos.y, index: index };
    }).filter(function (item) { return item.text; });
    rows.sort(function (a, b) {
      if (a.y === null || b.y === null) return a.index - b.index;
      return (a.y - b.y) || ((a.x || 0) - (b.x || 0)) || (a.index - b.index);
    });

    var height = Number(result && result.image && result.image.height) || 1200;
    var rowTolerance = Math.max(8, Math.min(18, height * 0.009));
    var groups = [];
    rows.forEach(function (item) {
      var group = groups[groups.length - 1];
      if (!group || item.y === null || group.y === null || Math.abs(item.y - group.y) > rowTolerance) {
        group = { y: item.y, items: [] };
        groups.push(group);
      }
      group.items.push(item);
      if (item.y !== null) group.y = group.items.reduce(function (sum, entry) { return sum + entry.y; }, 0) / group.items.length;
    });
    return groups.map(function (group) {
      group.items.sort(function (a, b) { return (a.x || 0) - (b.x || 0); });
      return group.items.map(function (item) { return item.text; }).join(' ');
    }).filter(Boolean);
  }

  function loadEngine(onProgress) {
    if (!enginePromise) {
      if (typeof onProgress === 'function') onProgress('loading-sdk');
      enginePromise = import(SDK_URL).then(function (sdk) {
        if (!sdk || typeof sdk.PaddleOCR !== 'function') throw new Error('PaddleOCR.js SDK export was not found.');
        if (typeof onProgress === 'function') onProgress('loading-model');
        return sdk.PaddleOCR.create({
          lang: 'ch',
          ocrVersion: 'PP-OCRv5',
          ortOptions: { backend: 'wasm' }
        });
      }).catch(function (error) {
        enginePromise = null;
        throw error;
      });
    }
    return enginePromise;
  }

  async function recognizeImages(images, onProgress) {
    if (!Array.isArray(images) || images.length === 0) throw new Error('No receipt images were provided to local OCR.');
    var engine = await loadEngine(onProgress);
    if (typeof onProgress === 'function') onProgress('recognizing');
    var blobs = images.map(imageDataToBlob);
    var results = await engine.predict(blobs);
    var pages = Array.isArray(results) ? results : [];
    var text = pages.map(function (result, index) {
      var lines = linesFromResult(result);
      return lines.length ? '[Receipt ' + (index + 1) + ']\n' + lines.join('\n') : '';
    }).filter(Boolean).join('\n\n');
    if (!text.trim()) throw new Error('PaddleOCR.js returned no readable text.');
    return text;
  }

  root.PaddleReceiptOcr = {
    engine: 'PaddleOCR.js PP-OCRv5 WASM',
    recognizeImages: recognizeImages
  };
})(window);
