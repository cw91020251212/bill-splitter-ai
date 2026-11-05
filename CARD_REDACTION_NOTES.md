# Receipt card-number redaction notes

## What the candidate does

Before receipt images can enter the system share sheet, the app runs OCR in a browser worker on the current device. It checks contiguous digit groups on the same OCR line for 13–19 digit Luhn-valid numbers, draws black rectangles onto newly generated JPEG copies, and displays each copy for review. The original receipt image stays unchanged in the existing local history. OCR text is used only in memory to find box coordinates; it is not written to local storage or sent in the share payload. A user can add or undo boxes. If OCR or image export fails, the app does not offer a way to share the originals from that review step.

This is local OCR plus a checksum rule, not a remote generative-AI service. The pinned Tesseract.js library, worker/core code, and English trained data may be downloaded from their configured CDNs on first use; the receipt image itself is passed to the browser worker and is not uploaded for recognition. First use therefore may require an internet connection. The implementation is capped at 4096 pixels on the longest side for the generated copy.

## Limits

Detection can miss numbers that are blurred, tiny, rotated, split across OCR lines, or otherwise misread; it may also flag a different Luhn-valid 13–19 digit number. It does not automatically identify names, addresses, expiry dates, CVVs, or other private information. The review is deliberate: inspect every image, and add a manual box when needed. Users should not treat automatic detection as a guarantee that a receipt contains no unmasked sensitive data.

## Technical reference

The browser worker setup, `createWorker`/`recognize` flow, worker configuration, and bounding-box output are based on the versioned Tesseract.js v5.1.1 API documentation:

- https://raw.githubusercontent.com/naptha/tesseract.js/v5.1.1/docs/api.md
- https://github.com/naptha/tesseract.js
