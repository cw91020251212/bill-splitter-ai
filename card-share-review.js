'use strict';

(function (root) {
  const h = React.createElement;

  function CardShareReview({ files, onCancel, onShare }) {
    const [phase, setPhase] = React.useState('scanning');
    const [prepared, setPrepared] = React.useState([]);
    const [imageIndex, setImageIndex] = React.useState(0);
    const [drawEnabled, setDrawEnabled] = React.useState(false);
    const [drag, setDrag] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [scanIndex, setScanIndex] = React.useState(0);
    const [previewUrl, setPreviewUrl] = React.useState('');
    const [imageLoadedVersion, setImageLoadedVersion] = React.useState(0);
    const generationRef = React.useRef(0);
    const controllerRef = React.useRef(null);
    const drawEnabledRef = React.useRef(false);
    const dragRef = React.useRef(null);
    const imageRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const bi = (zh, en) => root.BillI18n?.language === 'en' ? en : zh;

    const runScan = async controller => {
      const generation = ++generationRef.current;
      setPhase('scanning');
      setError('');
      setPrepared([]);
      setImageIndex(0);
      setScanIndex(0);
      try {
        const output = await root.CardRedaction.prepareFiles(files, progress => {
          if (generation !== generationRef.current || controller.signal.aborted) return;
          if (Number.isInteger(progress?.index)) setScanIndex(progress.index);
        }, controller.signal);
        if (generation !== generationRef.current || controller.signal.aborted) return;
        setPrepared(output);
        setPhase('ready');
      } catch (_) {
        if (generation === generationRef.current && !controller.signal.aborted) {
          setError(bi('無法完成本機卡號掃描；為免分享原圖，今次未有分享。請檢查網絡後重試。', 'On-device card scanning could not finish. The original was not shared. Check your connection and try again.'));
          setPhase('error');
        }
      }
    };

    React.useEffect(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      runScan(controller);
      return () => {
        controller.abort();
        generationRef.current += 1;
      };
    }, [files]);

    React.useEffect(() => {
      const file = phase === 'ready' ? prepared[imageIndex]?.file : null;
      if (!file) return undefined;
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [phase, prepared, imageIndex]);

    React.useEffect(() => {
      if (phase !== 'ready') return undefined;
      const image = imageRef.current;
      const canvas = canvasRef.current;
      if (!image || !canvas || !image.complete || !image.naturalWidth) return undefined;
      const drawMasks = () => {
        const rect = image.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        canvas.style.left = '0px';
        canvas.style.top = '0px';
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        const ratio = Math.max(1, Math.min(2, root.devicePixelRatio || 1));
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#000000';
        (prepared[imageIndex]?.masks || []).forEach(mask => {
          context.fillRect(mask.x * rect.width, mask.y * rect.height, mask.width * rect.width, mask.height * rect.height);
        });
        if (drag) {
          const x = Math.min(drag.startX, drag.currentX);
          const y = Math.min(drag.startY, drag.currentY);
          context.fillRect(x * rect.width, y * rect.height, Math.abs(drag.currentX - drag.startX) * rect.width, Math.abs(drag.currentY - drag.startY) * rect.height);
        }
      };
      drawMasks();
      root.addEventListener('resize', drawMasks);
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(drawMasks) : null;
      observer?.observe(image);
      return () => {
        root.removeEventListener('resize', drawMasks);
        observer?.disconnect();
      };
    }, [phase, prepared, imageIndex, drag, imageLoadedVersion, previewUrl]);

    React.useEffect(() => {
      setDrawEnabled(false);
      drawEnabledRef.current = false;
      setDrag(null);
      dragRef.current = null;
    }, [imageIndex]);

    React.useEffect(() => {
      const onKeyDown = event => { if (event.key === 'Escape') close(); };
      root.addEventListener('keydown', onKeyDown);
      return () => root.removeEventListener('keydown', onKeyDown);
    }, [onCancel]);

    const close = () => {
      controllerRef.current?.abort();
      onCancel();
    };

    const retryScan = () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      runScan(controller);
    };

    const toggleDraw = () => {
      const next = !drawEnabledRef.current;
      drawEnabledRef.current = next;
      setDrawEnabled(next);
    };

    const getPoint = event => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return null;
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      };
    };

    const updateMasks = async masks => {
      const current = prepared[imageIndex];
      if (!current || busy) return;
      const generation = generationRef.current;
      setBusy(true);
      setError('');
      setPrepared(previous => previous.map((entry, index) => index === imageIndex ? { ...entry, masks } : entry));
      try {
        const redactedFile = await root.CardRedaction.createMaskedFile(files[imageIndex], masks, imageIndex);
        if (generation === generationRef.current) {
          setPrepared(previous => previous.map((entry, index) => index === imageIndex ? { ...entry, file: redactedFile, masks } : entry));
        }
      } catch (_) {
        if (generation === generationRef.current) setError(bi('無法更新遮蓋副本；請重試製作或撤銷上一框。', 'Could not update the redacted copy. Retry creating it or undo the last box.'));
      } finally {
        if (generation === generationRef.current) setBusy(false);
      }
    };

    const onPointerDown = event => {
      if (!drawEnabledRef.current || busy || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const point = getPoint(event);
      if (!point) return;
      event.preventDefault();
      const next = { pointerId: event.pointerId, startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
      dragRef.current = next;
      setDrag(next);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
    };

    const onPointerMove = event => {
      if (!drawEnabledRef.current) return;
      const current = dragRef.current;
      if (current && current.pointerId !== event.pointerId) return;
      const point = getPoint(event);
      if (!point) return;
      if (current) {
        const next = { ...current, currentX: point.x, currentY: point.y };
        dragRef.current = next;
        setDrag(next);
      }
    };

    const onPointerUp = event => {
      if (!drawEnabledRef.current || busy) {
        dragRef.current = null;
        setDrag(null);
        return;
      }
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const point = getPoint(event) || { x: current.currentX, y: current.currentY };
      dragRef.current = null;
      setDrag(null);
      const x = Math.min(current.startX, point.x);
      const y = Math.min(current.startY, point.y);
      const width = Math.abs(point.x - current.startX);
      const height = Math.abs(point.y - current.startY);
      if (width < 0.004 || height < 0.004) return;
      updateMasks([...(prepared[imageIndex]?.masks || []), { x, y, width, height }]);
    };

    const undoMask = () => updateMasks((prepared[imageIndex]?.masks || []).slice(0, -1));
    const retryMaskExport = () => updateMasks(prepared[imageIndex]?.masks || []);
    const shareCopies = () => {
      if (phase !== 'ready' || busy || error || prepared.length !== files.length || prepared.some(item => !item?.file)) return;
      if (onShare(prepared.map(item => item.file))) close();
    };

    const autoCount = prepared[imageIndex]?.cardCount || 0;
    const maskCount = prepared[imageIndex]?.masks?.length || 0;
    const shell = { className: 'fixed inset-0 z-[60] bg-slate-950/90 overflow-y-auto', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'card-share-review-title', 'data-testid': 'card-share-review' };
    const cardClass = 'w-full max-w-xl rounded-2xl bg-white border border-slate-200 p-4 sm:p-6 shadow-2xl';
    const buttonBase = 'min-h-[44px] px-3 py-2 rounded-xl font-bold text-sm';

    return h('div', shell,
      h('div', { className: 'min-h-full w-full px-3 py-4 flex items-center justify-center' },
        h('div', { className: cardClass },
          h('div', { className: 'flex items-start justify-between gap-3 mb-3' },
            h('div', null,
              h('p', { className: 'text-xs font-bold uppercase tracking-wider text-brand-700' }, bi('分享前核對', 'Before sharing')),
              h('h2', { id: 'card-share-review-title', className: 'text-xl font-bold text-slate-900 mt-1' }, bi('分享前遮蓋卡號', 'Mask card numbers before sharing'))
            ),
            h('button', { type: 'button', onClick: close, 'aria-label': bi('取消分享', 'Cancel sharing'), className: 'w-10 h-10 shrink-0 rounded-xl border border-slate-400 text-slate-600 hover:bg-slate-100 text-2xl leading-none' }, '×')
          ),
          h('div', { className: 'rounded-xl border border-amber-500 bg-amber-50 p-3 mb-4' },
            h('p', { className: 'text-sm leading-relaxed font-semibold text-amber-900' }, bi('卡號只在本機辨識；請逐張檢查遮蓋副本。原圖不變；按分享後只會送出遮蓋版。未遮到的資料可用遮蓋筆補框。', 'Card scanning runs on this device. Check every redacted copy. Originals stay unchanged; only redacted copies are shared. Add a box if anything was missed.'))
          ),
          phase === 'scanning' && h('div', { className: 'rounded-xl border border-slate-300 bg-slate-50 p-5 text-center', role: 'status', 'aria-live': 'polite', 'data-testid': 'card-redaction-scanning' },
            h('p', { className: 'font-bold text-slate-800' }, bi(`正在本機掃描第 ${Math.min(scanIndex + 1, files.length)} / ${files.length} 張…`, `Scanning image ${Math.min(scanIndex + 1, files.length)} of ${files.length} on this device…`)),
            h('p', { className: 'text-sm text-slate-600 mt-2' }, bi('圖片不會上載作卡號辨識。首次使用需下載本機 OCR 工具。', 'Images are not uploaded for card detection. The on-device OCR engine may need to download on first use.'))
          ),
          phase === 'error' && h('div', { className: 'rounded-xl border border-red-400 bg-red-50 p-4', role: 'alert', 'data-testid': 'card-redaction-error' },
            h('p', { className: 'text-sm font-semibold text-red-800' }, error),
            h('button', { type: 'button', onClick: retryScan, className: `${buttonBase} mt-3 border border-red-600 bg-white text-red-800` }, bi('重新掃描', 'Scan again'))
          ),
          phase === 'ready' && prepared[imageIndex] && h(React.Fragment, null,
            h('div', { className: `rounded-xl border p-3 mb-3 ${autoCount ? 'border-emerald-500 bg-emerald-50' : 'border-amber-500 bg-amber-50'}`, role: 'status', 'data-testid': 'card-redaction-status' },
              h('p', { className: `text-sm leading-relaxed font-semibold ${autoCount ? 'text-emerald-900' : 'text-amber-900'}` }, autoCount
                ? bi(`自動遮蓋 ${autoCount} 個疑似卡號；本張共遮蓋 ${maskCount} 處，請核對。`, `${autoCount} possible card number${autoCount === 1 ? '' : 's'} auto-masked; ${maskCount} area${maskCount === 1 ? '' : 's'} covered on this image. Please check.`)
                : bi('未找到通過校驗的卡號；請仔細檢查，必要時手動加框。', 'No checksum-valid card number was found. Check carefully and add a box if needed.'))
            ),
            h('div', { className: 'flex items-center justify-between gap-2 mb-3' },
              h('button', { type: 'button', onClick: toggleDraw, 'aria-pressed': drawEnabled, 'data-testid': 'card-redaction-draw-toggle', disabled: busy, className: `${buttonBase} border-2 disabled:opacity-50 ${drawEnabled ? 'bg-brand-600 border-brand-700 text-white' : 'bg-white text-brand-900 border-brand-600 hover:bg-brand-50'}` }, drawEnabled ? bi('關閉遮蓋筆', 'Done drawing') : bi('手動加遮蓋框', 'Add a box')),
              h('button', { type: 'button', onClick: undoMask, disabled: !maskCount || busy, className: `${buttonBase} border border-slate-400 bg-white text-slate-700 disabled:opacity-40` }, bi('撤銷上一框', 'Undo last'))
            ),
            drawEnabled && h('p', { className: 'text-sm text-brand-900 font-semibold mb-2', role: 'status' }, bi('喺圖片上拖動畫黑框遮住資料。', 'Drag on the image to cover more information.')),
            h('div', { className: 'flex items-center justify-between gap-2 mb-2' },
              h('button', { type: 'button', onClick: () => setImageIndex(index => Math.max(0, index - 1)), disabled: imageIndex === 0 || busy, className: 'min-h-[40px] px-3 rounded-lg border border-slate-400 bg-white text-sm font-semibold disabled:opacity-40' }, bi('上一張', 'Previous')),
              h('div', { className: 'text-center text-sm font-bold text-slate-700', 'data-testid': 'card-redaction-counter' }, bi(`第 ${imageIndex + 1} / ${files.length} 張`, `Image ${imageIndex + 1} of ${files.length}`), h('br'), h('span', { className: 'text-xs font-normal text-slate-600' }, bi(`已遮蓋 ${maskCount} 處`, `${maskCount} area${maskCount === 1 ? '' : 's'} masked`))),
              h('button', { type: 'button', onClick: () => setImageIndex(index => Math.min(files.length - 1, index + 1)), disabled: imageIndex >= files.length - 1 || busy, className: 'min-h-[40px] px-3 rounded-lg border border-slate-400 bg-white text-sm font-semibold disabled:opacity-40' }, bi('下一張', 'Next'))
            ),
            h('div', { className: 'rounded-xl bg-slate-900 p-2 flex items-center justify-center min-h-[180px] overflow-hidden' },
              h('div', { className: 'relative inline-block max-w-full' },
                previewUrl && h('img', { key: previewUrl, ref: imageRef, src: previewUrl, alt: bi('已遮蓋單據分享副本預覽', 'Preview of the redacted receipt copy'), 'data-testid': 'card-redaction-preview', onLoad: () => setImageLoadedVersion(version => version + 1), className: 'block max-w-full max-h-[42vh] w-auto object-contain select-none', draggable: 'false' }),
                h('canvas', { ref: canvasRef, 'data-testid': 'card-redaction-canvas', 'data-drawing-enabled': drawEnabled ? 'true' : 'false', 'aria-label': bi('在此拖動框選要遮蓋的資料', 'Drag here to cover more information'), className: `absolute inset-0 w-full h-full ${drawEnabled ? 'cursor-crosshair' : 'cursor-default'}`, style: { touchAction: drawEnabled ? 'none' : 'pan-y pinch-zoom', pointerEvents: drawEnabled ? 'auto' : 'none' }, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { dragRef.current = null; setDrag(null); }, onLostPointerCapture: event => { if (dragRef.current?.pointerId === event.pointerId) { dragRef.current = null; setDrag(null); } } })
              )
            ),
            error && h('div', { className: 'mt-2', role: 'alert' }, h('p', { className: 'text-sm text-red-700 font-semibold' }, error), h('button', { type: 'button', onClick: retryMaskExport, className: `${buttonBase} mt-2 border border-red-600 bg-white text-red-800` }, bi('重試製作遮蓋版', 'Retry redaction'))),
            h('div', { className: 'grid grid-cols-2 gap-2 mt-4' },
              h('button', { type: 'button', onClick: close, className: 'min-h-[48px] px-3 py-3 rounded-xl border border-slate-400 bg-white text-slate-700 font-bold' }, bi('取消', 'Cancel')),
              h('button', { type: 'button', onClick: shareCopies, disabled: busy || Boolean(error), 'data-testid': 'card-redaction-share', className: 'min-h-[48px] px-3 py-3 rounded-xl border border-emerald-800 bg-emerald-700 text-white font-bold disabled:opacity-50' }, busy ? bi('正在更新遮蓋版…', 'Updating copy…') : bi('確認並分享遮蓋版', 'Share redacted copies'))
            )
          )
        )
      )
    );
  }

  root.CardShareReview = CardShareReview;
})(window);
