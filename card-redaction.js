'use strict';

(function (root) {
  const TESSERACT_VERSION = '5.1.1';
  const TESSERACT_CDN = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}`;
  const TESSERACT_CORE_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0';
  const TESSDATA_CDN = 'https://tessdata.projectnaptha.com/4.0.0';
  let tesseractLoadPromise = null;

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const normalizeDigits = value => String(value || '').normalize('NFKC').replace(/[^0-9]/g, '');

  function passesLuhn(value) {
    const digits = normalizeDigits(value);
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  }

  function getBox(item) {
    const box = item?.bbox || item?.boundingBox || item?.box;
    if (!box) return null;
    const x0 = Number(box.x0 ?? box.left);
    const y0 = Number(box.y0 ?? box.top);
    const x1 = Number(box.x1 ?? (Number(box.left) + Number(box.width)));
    const y1 = Number(box.y1 ?? (Number(box.top) + Number(box.height)));
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
    return { x0, y0, x1, y1 };
  }

  function getOcrLines(data) {
    if (Array.isArray(data?.lines) && data.lines.length) return data.lines;
    const lines = [];
    (data?.blocks || []).forEach(block => {
      (block.paragraphs || []).forEach(paragraph => {
        (paragraph.lines || []).forEach(line => lines.push(line));
      });
    });
    if (lines.length) return lines;

    const words = (data?.words || []).map(word => ({ word, box: getBox(word) }))
      .filter(item => item.box)
      .sort((a, b) => ((a.box.y0 + a.box.y1) / 2) - ((b.box.y0 + b.box.y1) / 2) || a.box.x0 - b.box.x0);
    const grouped = [];
    words.forEach(item => {
      const center = (item.box.y0 + item.box.y1) / 2;
      let line = grouped.find(entry => Math.abs(center - entry.center) <= Math.max(entry.height, item.box.y1 - item.box.y0) * 0.55);
      if (!line) {
        line = { center, height: item.box.y1 - item.box.y0, words: [] };
        grouped.push(line);
      }
      line.words.push(item.word);
      line.height = Math.max(line.height, item.box.y1 - item.box.y0);
      line.center = line.words.reduce((sum, word) => {
        const box = getBox(word);
        return sum + (box.y0 + box.y1) / 2;
      }, 0) / line.words.length;
    });
    return grouped;
  }

  function lineTokens(line) {
    const words = Array.isArray(line?.words) && line.words.length
      ? line.words
      : (line?.text ? [line] : []);
    return words.map(word => ({ word, box: getBox(word), digits: normalizeDigits(word?.text) }))
      .filter(token => token.box && token.digits.length)
      .sort((a, b) => a.box.x0 - b.box.x0);
  }

  function candidateBoxesForLine(line, imageWidth, imageHeight) {
    const tokens = lineTokens(line);
    const candidates = [];
    for (let start = 0; start < tokens.length; start += 1) {
      let digits = '';
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let previous = null;
      for (let end = start; end < tokens.length; end += 1) {
        const token = tokens[end];
        const height = Math.max(token.box.y1 - token.box.y0, previous ? previous.box.y1 - previous.box.y0 : 0);
        if (previous) {
          const gap = token.box.x0 - previous.box.x1;
          if (gap > height * 1.35) break;
        }
        digits += token.digits;
        if (digits.length > 19) break;
        x0 = Math.min(x0, token.box.x0);
        y0 = Math.min(y0, token.box.y0);
        x1 = Math.max(x1, token.box.x1);
        y1 = Math.max(y1, token.box.y1);
        previous = token;
        if (digits.length >= 13 && passesLuhn(digits)) {
          const textHeight = Math.max(1, y1 - y0);
          const padX = textHeight * 0.36;
          const padY = textHeight * 0.22;
          candidates.push({
            x: clamp((x0 - padX) / imageWidth, 0, 1),
            y: clamp((y0 - padY) / imageHeight, 0, 1),
            width: clamp((x1 + padX) / imageWidth, 0, 1) - clamp((x0 - padX) / imageWidth, 0, 1),
            height: clamp((y1 + padY) / imageHeight, 0, 1) - clamp((y0 - padY) / imageHeight, 0, 1)
          });
          break;
        }
      }
    }
    return candidates;
  }

  function detectCardMasks(ocrData, imageWidth, imageHeight) {
    const width = Number(imageWidth);
    const height = Number(imageHeight);
    if (!(width > 0 && height > 0)) return [];
    const result = [];
    getOcrLines(ocrData).forEach(line => result.push(...candidateBoxesForLine(line, width, height)));
    const unique = [];
    result.forEach(mask => {
      const overlaps = unique.some(existing =>
        mask.x < existing.x + existing.width && mask.x + mask.width > existing.x
        && mask.y < existing.y + existing.height && mask.y + mask.height > existing.y
      );
      if (!overlaps) unique.push(mask);
    });
    return unique;
  }

  function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      const cleanup = () => URL.revokeObjectURL(url);
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        cleanup();
        if (!dimensions.width || !dimensions.height) reject(new Error('IMAGE_READ_FAILED'));
        else resolve(dimensions);
      };
      image.onerror = () => { cleanup(); reject(new Error('IMAGE_READ_FAILED')); };
      image.src = url;
    });
  }

  function createMaskedFile(file, masks, index = 0, quality = 0.94) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      const cleanup = () => URL.revokeObjectURL(url);
      image.onload = () => {
        try {
          const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('CANVAS_UNAVAILABLE');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          context.fillStyle = '#000000';
          (Array.isArray(masks) ? masks : []).forEach(mask => {
            const x = clamp(Number(mask.x) || 0, 0, 1);
            const y = clamp(Number(mask.y) || 0, 0, 1);
            const right = clamp(x + Math.max(0, Number(mask.width) || 0), x, 1);
            const bottom = clamp(y + Math.max(0, Number(mask.height) || 0), y, 1);
            if (right > x && bottom > y) {
              context.fillRect(Math.floor(x * canvas.width), Math.floor(y * canvas.height),
                Math.max(1, Math.ceil((right - x) * canvas.width)), Math.max(1, Math.ceil((bottom - y) * canvas.height)));
            }
          });
          canvas.toBlob(blob => {
            cleanup();
            if (!blob) { reject(new Error('IMAGE_EXPORT_FAILED')); return; }
            resolve(new File([blob], `receipt-masked-${String(index + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
          }, 'image/jpeg', quality);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      image.onerror = () => { cleanup(); reject(new Error('IMAGE_READ_FAILED')); };
      image.src = url;
    });
  }

  function loadTesseract() {
    if (root.Tesseract?.createWorker) return Promise.resolve(root.Tesseract);
    if (tesseractLoadPromise) return tesseractLoadPromise;
    if (!root.document) return Promise.reject(new Error('OCR_UNAVAILABLE'));
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = root.document.createElement('script');
      script.src = `${TESSERACT_CDN}/dist/tesseract.min.js`;
      script.async = true;
      script.onload = () => {
        if (root.Tesseract?.createWorker) resolve(root.Tesseract);
        else { tesseractLoadPromise = null; reject(new Error('OCR_UNAVAILABLE')); }
      };
      script.onerror = () => {
        tesseractLoadPromise = null;
        script.remove();
        reject(new Error('OCR_UNAVAILABLE'));
      };
      root.document.head.appendChild(script);
    });
    return tesseractLoadPromise;
  }

  async function prepareFiles(files, onProgress, signal) {
    if (!Array.isArray(files) || !files.length) return [];
    const checkCancelled = () => { if (signal?.aborted) throw new Error('CANCELLED'); };
    checkCancelled();
    const Tesseract = await loadTesseract();
    checkCancelled();
    let worker;
    const output = [];
    let abortHandler;
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        workerPath: `${TESSERACT_CDN}/dist/worker.min.js`,
        corePath: TESSERACT_CORE_CDN,
        langPath: TESSDATA_CDN,
        logger: message => {
          if (typeof onProgress === 'function' && message?.status === 'recognizing text') {
            onProgress({ phase: 'recognizing', ratio: Number(message.progress) || 0 });
          }
        },
        errorHandler: () => {}
      });
      checkCancelled();
      abortHandler = () => { try { worker?.terminate?.(); } catch (_) {} };
      signal?.addEventListener('abort', abortHandler, { once: true });
      await worker.setParameters({ tessedit_char_whitelist: '0123456789- ' });
      for (let index = 0; index < files.length; index += 1) {
        checkCancelled();
        if (typeof onProgress === 'function') onProgress({ phase: 'image', index, total: files.length, ratio: 0 });
        const dimensions = await getImageDimensions(files[index]);
        const { data } = await worker.recognize(files[index], {}, { text: false, blocks: true });
        checkCancelled();
        const masks = detectCardMasks(data, dimensions.width, dimensions.height);
        const maskedFile = await createMaskedFile(files[index], masks, index);
        output.push({ file: maskedFile, masks, cardCount: masks.length });
        if (typeof onProgress === 'function') onProgress({ phase: 'image', index, total: files.length, ratio: 1 });
      }
      return output;
    } finally {
      if (abortHandler) signal?.removeEventListener('abort', abortHandler);
      if (worker?.terminate) {
        try { await worker.terminate(); } catch (_) {}
      }
    }
  }

  const api = { normalizeDigits, passesLuhn, detectCardMasks, getImageDimensions, createMaskedFile, prepareFiles };
  root.CardRedaction = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
