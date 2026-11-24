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
    { key: 'upload', step: 1, target: '[data-testid="receipt-source-actions"]', title: ['讀單據', 'Scan receipt'], copy: ['最多 5 張。', 'Up to 5 photos.'] },
    { key: 'manual', step: 1, target: '[data-testid="start-manual"]', title: ['手動輸入', 'Enter manually'], copy: ['冇相都可以。', 'No photo needed.'] },
    { key: 'verify', step: 2, target: '[data-testid="verify-item"]', title: ['核對項目', 'Check items'], copy: ['有錯先改。', 'Edit mistakes only.'] },
    { key: 'items', step: 2, target: '[data-tutorial-target="item-fields"]', title: ['修改項目', 'Edit item'], copy: ['數量未知可留空。', 'Quantity can stay blank.'] },
    { key: 'fee', step: 2, target: '[data-tutorial-target="fee"]', title: ['稅／服務費', 'Tax / fee'], copy: ['填金額。', 'Enter an amount.'] },
    { key: 'share', step: 2, target: '[data-tutorial-target="open-claim-share"]', title: ['分享認帳', 'Share claims'], copy: ['撳掣分享連結。', 'Tap to share the link.'] },
    { key: 'replies', step: 2, target: '[data-testid="claim-replies"]', title: ['認帳回覆', 'Claim replies'], copy: ['在此核對。', 'Check them here.'], prefer: 'top' },
    { key: 'payer', step: 3, target: '[data-tutorial-target="calculation-settings"]', title: ['墊支人', 'Payer'], copy: ['填先付款的人。', 'Enter who paid first.'] },
    { key: 'currency', step: 3, target: '[data-tutorial-target="currency"]', title: ['貨幣', 'Currency'], copy: ['選結算貨幣。', 'Choose settlement currency.'] },
    { key: 'payment', step: 3, target: '[data-testid="payment-methods"]', title: ['收款方式', 'Payment'], copy: ['可以多選。', 'Choose one or more.'] },
    { key: 'tax-method', step: 3, target: '[data-tutorial-target="tax-method"]', title: ['費用分法', 'Fee split'], copy: ['按消費或平均。', 'By spend or equally.'] },
    { key: 'calculate', step: 3, target: '[data-testid="calculate-split"]', title: ['計算', 'Calculate'], copy: ['收到認帳後計算。', 'Calculate after replies.'], prefer: 'top' },
    { key: 'report', step: 4, target: '[data-testid="friend-web-preferred-badge"]', title: ['分帳結果', 'Results'], copy: ['網頁版係首選。', 'Web is preferred.'], prefer: 'top' },
    { key: 'report-web', step: 4, target: '[data-testid="friend-web-intro"]', title: ['同一連結', 'Same link'], copy: ['朋友喺原連結睇結果。', 'Friends view results there.'], prefer: 'top' },
    { key: 'report-fallback', step: 4, target: '[data-testid="report-fallback-toggle"]', title: ['文字後備', 'Text backup'], copy: ['需要先使用。', 'Use when needed.'], prefer: 'top' },
    { key: 'report-share', step: 4, target: '[data-testid="summary-report-actions"]', title: ['簡版', 'Summary'], copy: ['列出每人金額。', 'Shows each amount.'] },
    { key: 'detail', step: 4, target: '[data-testid="detail-report-actions"]', title: ['詳細版', 'Details'], copy: ['逐項列帳。', 'Lists every item.'] }
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
      var destinations = { receipt: 'verify', manual: 'items', edit: 'items', 'share-open': 'replies', shared: 'replies', calculated: 'report', 'fallback-open': 'report-share' };
      if (destinations[action]) goKey(destinations[action]);
      else if (action === 'calculation-error') {
        goKey(detail === 'payer' ? 'payer' : 'replies');
        setFeedback(english ? 'Fix the sample first.' : '請先修正示例。');
      } else if (action === 'report-preview') {
        setFeedback(english ? 'Previewed.' : '已預覽。');
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
