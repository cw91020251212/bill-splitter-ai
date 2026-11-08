(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.React) return;
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useRef = React.useRef;
  var useEffect = React.useEffect;
  var useLayoutEffect = React.useLayoutEffect;
  var FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var STEPS = [
    { key: 'upload', step: 1, target: '[data-testid="receipt-source-actions"]', title: ['由單據開始', 'Start with a receipt'], copy: ['最多 5 張；也可貼上或上載 AI 文字。JSON 免鎖匙，純文字需鎖匙整理。第 2 步可加入原圖，分享後顯示在同一連結。示例圖不會送出。', 'Scan up to 5 photos or import AI text. JSON needs no key; plain text does. Add the original in Step 2 to show below the same result link. Demo photos are not sent.'] },
    { key: 'manual', step: 1, target: '[data-testid="start-manual"]', title: ['沒有圖片也可以', 'No image? Enter items manually'], copy: ['無圖或讀取失敗，可手動輸入；教學不會清空你的賬單。', 'No photo or scan failure? Enter items manually. Your bill stays untouched.'] },
    { key: 'verify', step: 2, target: '[data-testid="verify-item"]', title: ['先核對，有錯才改', 'Check first; edit only mistakes'], copy: ['先核對名稱和金額；按「改」展開欄位。', 'Check names and amounts; Edit opens the fields.'] },
    { key: 'items', step: 2, target: '[data-tutorial-target="item-fields"]', title: ['試改示例價錢', 'Try changing the sample price'], copy: ['可試改價格；未知數量留空，按認帳比例分。', 'Try editing the price; leave unknown quantities blank to split by shares.'] },
    { key: 'fee', step: 2, target: '[data-tutorial-target="fee"]', title: ['服務費填金額，不是百分比', 'Enter a fee amount, not a percentage'], copy: ['服務費／附加稅填金額；示例是 $12。', 'Enter the fee or tax amount; the sample is $12.'] },
    { key: 'share', step: 2, target: '[data-tutorial-target="open-claim-share"]', title: ['核對好，再請朋友認帳', 'Invite friends after checking'], copy: ['朋友用連結填份數，無需你的鎖匙；教學只開示例。', 'Friends claim via the link without your key; this tutorial only opens a sample.'] },
    { key: 'share-options', step: 2, target: '[data-tutorial-target="send-claim-link"]', title: ['隱藏的分享選項在這裡', 'Inside the sharing options'], copy: ['收據相片會顯示在同一結果連結下方。教學只載入示例，不會分享。', 'Receipt photos appear below the result on the same link. This demo shares nothing.'], prefer: 'top' },
    { key: 'payer', step: 3, target: '[data-tutorial-target="calculation-settings"]', title: ['誰先付款，就填誰', 'Name the person who paid first'], copy: ['填墊支人姓名，須與認帳姓名一致。', 'Enter the payer’s name as it appears in the claim.'] },
    { key: 'currency', step: 3, target: '[data-tutorial-target="currency"]', title: ['選擇結算貨幣', 'Choose the settlement currency'], copy: ['先確認單據貨幣，再選結算貨幣。', 'Confirm the receipt currency, then choose the settlement currency.'] },
    { key: 'payment', step: 3, target: '[data-testid="payment-methods"]', title: ['收款方式可以多選', 'Choose one or more payment methods'], copy: ['可多選收款方式；報告只列出，不會扣款。', 'Select payment methods; they appear in the report only.'] },
    { key: 'tax-method', step: 3, target: '[data-tutorial-target="tax-method"]', title: ['決定服務費怎樣分', 'Choose how to split the fee'], copy: ['服務費可按消費比例或平均分。', 'Split the fee by spend or equally.'] },
    { key: 'replies', step: 3, target: '[data-testid="claim-replies"]', title: ['設定完成後，再核對朋友回覆', 'Review friend replies after your settings'], copy: ['在此核對朋友回覆；須有有效認帳才能產生報告。', 'Review replies here; a valid claim is needed for the report.'], prefer: 'top' },
    { key: 'calculate', step: 3, target: '[data-testid="calculate-split"]', title: ['收到有效認帳後才計算', 'Calculate only after a usable claim'], copy: ['按「產生分帳報告」計算；只會顯示示例。', 'Use Calculate to view the sample; nothing is published.'], prefer: 'top' },
    { key: 'report', step: 4, target: '[data-testid="friend-web-preferred-badge"]', title: ['計算完成，網頁版是首選', 'Calculated: the web link is preferred'], copy: ['先用網頁版分享結果；簡單版和詳細版留作後備。', 'Share the result on the web first; Summary and Detailed are backups.'], prefer: 'top' },
    { key: 'report-web', step: 4, target: '[data-testid="friend-web-intro"]', title: ['朋友由同一條連結查看結果', 'Friends view results on the same link'], copy: ['朋友用同一認帳連結看結果，不用另發；教學不會真的傳送。', 'Friends use the same claim link; no second link. This guide sends nothing.'], prefer: 'top' },
    { key: 'report-fallback', step: 4, target: '[data-testid="report-fallback-toggle"]', title: ['簡單版和詳細版是後備', 'Summary and Detailed are backups'], copy: ['網頁連結打不開時，才用文字後備。', 'Use text backups only if the web link fails.'], prefer: 'top' },
    { key: 'report-share', step: 4, target: '[data-testid="summary-report-actions"]', title: ['簡單版：快速通知應付金額', 'Summary: a quick reimbursement message'], copy: ['簡單版列出每人金額；按鈕只顯示示例。', 'Summary lists each person’s amount; buttons show a demo only.'] },
    { key: 'detail', step: 4, target: '[data-testid="detail-report-actions"]', title: ['詳細版：逐項核對的後備', 'Detailed: an item-by-item backup'], copy: ['詳細版逐項列帳；教學示例的修改會在結束時丟棄。', 'Detailed lists every item; tutorial edits are discarded when you finish.'] }
  ];
  var MAIN_NAMES = [['上載睇單', 'Upload receipt'], ['各自認帳', 'Claim items'], ['分帳運算', 'Calculate'], ['最終結果', 'Review report']];
  var clamp = function (n, min, max) { return Math.max(min, Math.min(max, n)); };

  function BillTutorial(props) {
    var english = String(props.language || 'zh-HK').toLowerCase().indexOf('en') === 0;
    var state = useState(0), index = state[0], setIndex = state[1];
    var geometry = useState(null), layout = geometry[0], setLayout = geometry[1];
    var message = useState(''), feedback = message[0], setFeedback = message[1];
    var demoRef = useRef(null), cardRef = useRef(null), nextRef = useRef(null);
    var targetRef = useRef(null), indexRef = useRef(index), alignRef = useRef(true);
    var gatedRef = useRef(new Map());
    var measureRef = useRef(null), frameRef = useRef(0), closeRef = useRef(props.onClose);
    var stage = STEPS[index];
    indexRef.current = index;
    closeRef.current = props.onClose;
    var close = function () { if (closeRef.current) closeRef.current(); };
    var goTo = function (value) {
      setFeedback('');
      setIndex(clamp(value, 0, STEPS.length - 1));
    };
    var goKey = function (key) { var next = STEPS.findIndex(function (s) { return s.key === key; }); if (next !== -1) goTo(next); };
    var onAction = function (action, detail) {
      var destinations = { receipt: 'verify', manual: 'items', edit: 'items', 'share-open': 'share-options', shared: 'payer', calculated: 'report', 'fallback-open': 'report-share' };
      if (destinations[action]) goKey(destinations[action]);
      else if (action === 'calculation-error') {
        goKey(detail === 'payer' ? 'payer' : 'replies');
        setFeedback(english ? 'Please correct the sample data before calculating again.' : '請先修正示例資料，再繼續計算。');
      } else if (action === 'report-preview') {
        setFeedback(english ? 'Demo only: report previewed. Nothing was shared or copied.' : '已試用報告按鈕；教學沒有分享內容，亦沒有改動剪貼簿。');
      }
    };

    useLayoutEffect(function () {
      targetRef.current = null;
      alignRef.current = true;
      setLayout(null);
      var second = 0;
      var first = requestAnimationFrame(function () {
        second = requestAnimationFrame(function () {
          if (measureRef.current) measureRef.current();
          if (nextRef.current) nextRef.current.focus({ preventScroll: true });
        });
      });
      return function () { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, [index]);

    useEffect(function () {
      var disposed = false;
      var resizeObserver;
      var mutationObserver;
      function measure() {
        if (disposed || !demoRef.current || !cardRef.current) return;
        var current = STEPS[indexRef.current];
        var target = demoRef.current.querySelector(current.target);
        if (!target || !target.getClientRects().length) return;
        targetRef.current = target;
        // Keep the highlighted control interactive, but remove unrelated sample
        // controls from tab order. Restore them as soon as they become a target.
        gatedRef.current.forEach(function (original, element) {
          if (!demoRef.current.contains(element) || target.contains(element)) {
            if (original === null) element.removeAttribute('tabindex');
            else element.setAttribute('tabindex', original);
            gatedRef.current.delete(element);
          }
        });
        Array.prototype.forEach.call(demoRef.current.querySelectorAll('button,a[href],input,select,textarea,[tabindex]'), function (element) {
          if (target.contains(element)) return;
          if (!gatedRef.current.has(element)) gatedRef.current.set(element, element.getAttribute('tabindex'));
          if (element.getAttribute('tabindex') !== '-1') element.setAttribute('tabindex', '-1');
        });
        var vv = window.visualViewport;
        var viewport = { left: vv ? vv.offsetLeft : 0, top: vv ? vv.offsetTop : 0, width: vv ? vv.width : innerWidth, height: vv ? vv.height : innerHeight };
        var card = cardRef.current.getBoundingClientRect();
        var width = Math.min(card.width, viewport.width - 20), height = Math.min(card.height, viewport.height - 20);
        var bounds = target.getBoundingClientRect();
        // Prepare the real sample screen first, then move the control and its
        // attached explanation into one readable viewport. Fixed dialogs do not scroll.
        if (alignRef.current) {
          alignRef.current = false;
          var dialog = target.closest('dialog');
          if (!dialog) {
            var combined = bounds.height + height + 28;
            var start = Math.max(12, (viewport.height - combined) / 2);
            var desired = current.prefer === 'top' ? start + height + 18 : start;
            window.scrollBy({ top: bounds.top - viewport.top - desired, behavior: 'instant' });
            bounds = target.getBoundingClientRect();
          }
        }
        var pad = 6;
        var focus = {
          left: clamp(bounds.left - viewport.left - pad, 2, viewport.width - 2),
          top: clamp(bounds.top - viewport.top - pad, 2, viewport.height - 2),
          right: clamp(bounds.right - viewport.left + pad, 2, viewport.width - 2),
          bottom: clamp(bounds.bottom - viewport.top + pad, 2, viewport.height - 2)
        };
        focus.width = focus.right - focus.left; focus.height = focus.bottom - focus.top;
        var margin = 10, gap = 18;
        var centerLeft = clamp(focus.left + (focus.width - width) / 2, margin, viewport.width - margin - width);
        var centerTop = clamp(focus.top + (focus.height - height) / 2, margin, viewport.height - margin - height);
        var candidates = {
          bottom: { left: centerLeft, top: focus.bottom + gap },
          top: { left: centerLeft, top: focus.top - height - gap },
          right: { left: focus.right + gap, top: centerTop },
          left: { left: focus.left - width - gap, top: centerTop }
        };
        var preferred = current.prefer || 'bottom';
        var order = [preferred].concat(['bottom', 'top', 'right', 'left'].filter(function (side) { return side !== preferred; }));
        function overlap(c) { return Math.max(0, Math.min(c.left + width, focus.right) - Math.max(c.left, focus.left)) * Math.max(0, Math.min(c.top + height, focus.bottom) - Math.max(c.top, focus.top)); }
        function inside(c) { return c.left >= margin && c.top >= margin && c.left + width <= viewport.width - margin && c.top + height <= viewport.height - margin; }
        var chosen = null;
        order.some(function (side) { var candidate = candidates[side]; if (inside(candidate) && overlap(candidate) === 0) { chosen = candidate; return true; } return false; });
        if (!chosen) {
          chosen = order.map(function (side) { return { left: clamp(candidates[side].left, margin, viewport.width - margin - width), top: clamp(candidates[side].top, margin, viewport.height - margin - height) }; }).sort(function (a, b) { return overlap(a) - overlap(b); })[0];
        }
        setLayout({ viewport: viewport, focus: focus, left: chosen.left + viewport.left, top: chosen.top + viewport.top });
      }
      function schedule() {
        if (disposed || frameRef.current) return;
        frameRef.current = requestAnimationFrame(function () { frameRef.current = 0; measure(); });
      }
      function realign() { alignRef.current = true; schedule(); }
      measureRef.current = realign;
      window.addEventListener('scroll', schedule, { capture: true, passive: true });
      window.addEventListener('resize', realign, { passive: true });
      if (window.visualViewport) {
        visualViewport.addEventListener('resize', realign, { passive: true });
        visualViewport.addEventListener('scroll', schedule, { passive: true });
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(demoRef.current); resizeObserver.observe(cardRef.current);
      }
      if (typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(schedule);
        mutationObserver.observe(demoRef.current, { childList: true, subtree: true, attributes: true });
      }
      schedule();
      return function () {
        disposed = true; measureRef.current = null; cancelAnimationFrame(frameRef.current); frameRef.current = 0;
        window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', realign);
        if (window.visualViewport) { visualViewport.removeEventListener('resize', realign); visualViewport.removeEventListener('scroll', schedule); }
        if (resizeObserver) resizeObserver.disconnect(); if (mutationObserver) mutationObserver.disconnect();
        gatedRef.current.forEach(function (original, element) {
          if (original === null) element.removeAttribute('tabindex');
          else element.setAttribute('tabindex', original);
        });
        gatedRef.current.clear();
      };
    }, []);

    useEffect(function () {
      function allowed(element) { return element instanceof Node && ((cardRef.current && cardRef.current.contains(element)) || (targetRef.current && targetRef.current.contains(element))); }
      function blockOutside(event) {
        if (allowed(event.target)) return;
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      }
      function controls() {
        var target = targetRef.current;
        var list = target ? (target.matches(FOCUSABLE) ? [target] : []).concat(Array.prototype.slice.call(target.querySelectorAll(FOCUSABLE))) : [];
        if (cardRef.current) list = list.concat(Array.prototype.slice.call(cardRef.current.querySelectorAll(FOCUSABLE)));
        return list.filter(function (element) { return element.getClientRects().length && !element.closest('[inert]'); });
      }
      function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key !== 'Tab') return;
        var list = controls(); if (!list.length) return;
        var current = list.indexOf(document.activeElement);
        var next = current === -1 ? (event.shiftKey ? list.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + list.length) % list.length;
        event.preventDefault();
        list[next].focus({ preventScroll: true });
      }
      function onFocus(event) { if (!allowed(event.target) && nextRef.current) nextRef.current.focus({ preventScroll: true }); }
      ['pointerdown', 'mousedown', 'click', 'touchstart'].forEach(function (type) { document.addEventListener(type, blockOutside, { capture: true, passive: false }); });
      document.addEventListener('focusin', onFocus, true); document.addEventListener('keydown', onKey, true);
      return function () {
        ['pointerdown', 'mousedown', 'click', 'touchstart'].forEach(function (type) { document.removeEventListener(type, blockOutside, true); });
        document.removeEventListener('focusin', onFocus, true); document.removeEventListener('keydown', onKey, true);
      };
    }, []);

    var masks = [];
    if (layout) {
      var f = layout.focus, v = layout.viewport;
      masks = [
        { left: 0, top: 0, width: v.width, height: f.top },
        { left: 0, top: f.top, width: f.left, height: f.height },
        { left: f.right, top: f.top, width: v.width - f.right, height: f.height },
        { left: 0, top: f.bottom, width: v.width, height: v.height - f.bottom }
      ];
    }
    return h('div', { className: 'bt-root', 'data-testid': 'interactive-tutorial', 'data-stage': stage.key, 'data-main-step': stage.step, 'data-ready': layout && targetRef.current ? 'true' : 'false' },
      h('div', { className: 'bt-demo', 'data-tutorial-demo': '', ref: demoRef }, typeof props.renderDemo === 'function' ? props.renderDemo(stage.key, onAction) : null),
      h('div', { className: 'bt-layer', 'aria-hidden': 'true', style: layout ? { left: layout.viewport.left, top: layout.viewport.top, width: layout.viewport.width, height: layout.viewport.height } : undefined },
        masks.map(function (style, i) { return h('div', { className: 'bt-mask', style: style, key: i }); }),
        layout ? h('div', { className: 'bt-highlight', 'data-testid': 'tutorial-highlight', style: { left: layout.focus.left, top: layout.focus.top, width: layout.focus.width, height: layout.focus.height } }) : null
      ),
      h('section', { className: 'bt-card', 'data-testid': 'tutorial-card', ref: cardRef, role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'bt-title', 'aria-describedby': 'bt-description', style: layout ? { left: layout.left, top: layout.top, visibility: 'visible' } : { visibility: 'hidden' } },
        h('header', { className: 'bt-card-header' },
          h('span', { className: 'bt-count', 'aria-live': 'polite' }, (index + 1) + ' / ' + STEPS.length),
          h('div', { className: 'bt-progress', 'aria-hidden': 'true' }, h('span', { style: { width: ((index + 1) / STEPS.length * 100) + '%' } })),
          h('button', { type: 'button', className: 'bt-close', 'data-testid': 'tutorial-close', 'aria-label': english ? 'Close tutorial' : '關閉教學', onClick: close }, '×')
        ),
        h('div', { className: 'bt-copy' },
          h('p', { className: 'bt-kicker' }, (english ? 'SAMPLE · STEP ' : '示例 · 第 ') + stage.step + (english ? ' · ' : ' 步 · ') + MAIN_NAMES[stage.step - 1][english ? 1 : 0]),
          h('h2', { id: 'bt-title' }, stage.title[english ? 1 : 0]),
          h('p', { id: 'bt-description', className: 'bt-description' }, stage.copy[english ? 1 : 0]),
          props.onOpenHelp ? h('button', { type: 'button', className: 'bt-key-help', onClick: props.onOpenHelp }, english ? 'Back to video lessons' : '返回影片教學') : null,
          feedback ? h('p', { className: 'bt-feedback', 'data-testid': 'tutorial-feedback', role: 'status' }, feedback) : null
        ),
        h('footer', { className: 'bt-controls' },
          index > 0 ? h('button', { type: 'button', className: 'bt-previous', 'data-testid': 'tutorial-prev', onClick: function () { goTo(index - 1); } }, english ? 'Back' : '上一步') : null,
          index === STEPS.length - 1 && props.onOpenHelp ? h('button', { type: 'button', className: 'bt-help', onClick: props.onOpenHelp }, english ? 'More tutorials' : '其他教學') : null,
          h('button', { type: 'button', className: 'bt-next', ref: nextRef, 'data-testid': 'tutorial-next', onClick: function () { if (index === STEPS.length - 1) close(); else goTo(index + 1); } }, index === STEPS.length - 1 ? (english ? 'Finish' : '完成教學') : (english ? 'Next' : '下一步'))
        )
      )
    );
  }
  window.BillTutorial = BillTutorial;
})();
