# PaddleOCR.js PP-OCRv5 Mobile assets

These official Paddle model archives power the free, on-device OCR route. The app fetches them only when a user first runs local OCR. Together they are 21,544,960 bytes (about 21.5 MB); the service worker caches same-origin assets at runtime for later use.

| Model | Archive | Size | SHA-256 |
|---|---|---:|---|
| `PP-OCRv5_mobile_det` | `PP-OCRv5_mobile_det_onnx_infer.tar` | 4,843,520 bytes | `781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30` |
| `PP-OCRv5_mobile_rec` | `PP-OCRv5_mobile_rec_onnx_infer.tar` | 16,701,440 bytes | `f7e792bc836f36e7ef895ad47c426d75b0b75b1650caa6d63fe9418441ffba8c` |

Both are standard uncompressed ustar archives containing the `inference.onnx` and `inference.yml` files required by PaddleOCR.js. Their `model_name` values match the names above. They were obtained from Paddle's official model archive endpoints:

- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar
- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar

PaddleOCR's Apache License 2.0 is included in [`LICENSE.txt`](./LICENSE.txt). The app uses the models locally; only extracted OCR text is sent to the selected OpenRouter model for structuring.
