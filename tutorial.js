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
    { key: 'upload', step: 1, target: '[data-testid="receipt-source-actions"]', title: ['由單據開始', 'Start with a receipt'], copy: ['有圖片可影相或選最多 5 張；已由其他 AI 翻譯的文字，可在下方貼上或上載。圖片辨識及一般文字整理需免費鎖匙；符合格式的 JSON 可免鎖匙匯入。這裡按圖片入口只會載入示例，不會開相機或相簿。', 'Scan up to 5 photos or paste/upload text already translated by another AI. Photo scanning and free-form text structuring need your free key; formatted JSON imports without one. The photo buttons here load a sample only; they do not open your camera or library.'] },
    { key: 'manual', step: 1, target: '[data-testid="start-manual"]', title: ['沒有圖片也可以', 'No image? Enter items manually'], copy: ['沒有圖片或讀單失敗，可以手動加項目。試按這個入口，或按「下一步」繼續；你的原有賬單不會被清空。', 'Use manual entry if you have no image or scanning fails. Try this entry or continue with Next. Your original bill will not be cleared.'] },
    { key: 'verify', step: 2, target: '[data-testid="verify-item"]', title: ['先核對，有錯才改', 'Check first; edit only mistakes'], copy: ['AI 讀完不代表一定正確。先核對菜名和金額；按「改」才會展開原本收起的編輯欄。可以試按一下。', 'Check the item name and amount after scanning. Edit opens the fields that are normally hidden. Try the Edit button.'] },
    { key: 'items', step: 2, target: '[data-tutorial-target="item-fields"]', title: ['試改示例價錢', 'Try changing the sample price'], copy: ['「改」會展開菜名、單價、總量和單位。可以試改這裡的價錢；未知總量就留空，之後按認帳份數比例分。', 'Edit reveals the name, price, quantity and unit. Change the sample price here. Leave an unknown receipt quantity blank to split by share ratios.'] },
    { key: 'fee', step: 2, target: '[data-tutorial-target="fee"]', title: ['服務費填金額，不是百分比', 'Enter a fee amount, not a percentage'], copy: ['如有服務費或附加稅，在這裡填實際金額。示例先用 $12；可以試改，最後報告會跟著計算。', 'Enter the actual service fee or tax amount here. The sample starts at $12. Any change you make will be used in the final calculation.'] },
    { key: 'share', step: 2, target: '[data-tutorial-target="open-claim-share"]', title: ['核對好，再請朋友認帳', 'Invite friends after checking'], copy: ['朋友用認帳連結填自己的份數，不需要你的鎖匙。試按這個分享按鈕，打開原本收起的選項；教學不會真的分享。', 'Friends use a claim link to enter their shares, without your key. Try this Share button to open the normally hidden options. Nothing is actually sent.'] },
    { key: 'share-options', step: 2, target: '[data-tutorial-target="send-claim-link"]', title: ['隱藏的分享選項在這裡', 'Inside the sharing options'], copy: ['先發認帳連結，再另發單據圖片或附件。按此按鈕只會模擬分享並載入示例回覆，不會真的傳送。', 'Send the claim link first, then receipt images or attachments separately. This button only simulates sharing and loads sample replies; nothing is sent.'], prefer: 'top' },
    { key: 'payer', step: 3, target: '[data-tutorial-target="calculation-settings"]', title: ['誰先付款，就填誰', 'Name the person who paid first'], copy: ['即使朋友未回覆，都可以先填墊支人；姓名要與認帳一致。示例由阿明墊支，其他人之後把應付金額還給他。', 'You can enter the payer before replies arrive. Use the same name as a claim. Ming paid first in this sample, so the others will reimburse him.'] },
    { key: 'currency', step: 3, target: '[data-tutorial-target="currency"]', title: ['選擇結算貨幣', 'Choose the settlement currency'], copy: ['單據原幣在上方確認；這裡選大家要用的結算貨幣。匯率會用於換算，未收到回覆也可以先設定。', 'Confirm the receipt currency above, then choose the settlement currency. The rate is used for conversion; you can set this before replies arrive.'] },
    { key: 'payment', step: 3, target: '[data-testid="payment-methods"]', title: ['收款方式可以多選', 'Choose one or more payment methods'], copy: ['勾選你接受的收款方式，報告會列出來；這不是付款操作，不會在 App 內扣款。可以試勾選。', 'Select the methods you accept, and the report lists them. These are report settings, not payment buttons. Try selecting more than one.'] },
    { key: 'tax-method', step: 3, target: '[data-tutorial-target="tax-method"]', title: ['決定服務費怎樣分', 'Choose how to split the fee'], copy: ['服務費可以按消費比例，亦可以按人頭平均分。試切換，下一步的結果會反映這個選擇。', 'Split the fee in proportion to spending, or equally per person. Try changing the option; the calculated result will reflect it.'] },
    { key: 'replies', step: 3, target: '[data-testid="claim-replies"]', title: ['設定完成後，再核對朋友回覆', 'Review friend replies after your settings'], copy: ['回覆欄在第三步設定下面。有回覆就在這裡核對或修正；未收到回覆仍可繼續填資料，但沒有有效認帳時不能產生報告。', 'The reply box is below the Step 3 settings. Review or fix replies here. You can fill in the settings before anyone replies, but a usable claim is required to generate the report.'], prefer: 'top' },
    { key: 'calculate', step: 3, target: '[data-testid="calculate-split"]', title: ['收到有效認帳後才計算', 'Calculate only after a usable claim'], copy: ['按這個按鈕（或「下一步」）用示例資料產生報告。若未有有效回覆，按鈕會保持停用；教學不會發布結果。', 'Use this button or Next to calculate from the sample. It remains disabled until a usable reply is available; this guide never publishes results.'], prefer: 'top' },
    { key: 'report', step: 4, target: '[data-testid="friend-web-preferred-badge"]', title: ['計算完成，網頁版是首選', 'Calculated: the web link is preferred'], copy: ['先用網頁版分享結果；簡單版和詳細版留作後備。', 'Share the result on the web first; Summary and Detailed are backups.'], prefer: 'top' },
    { key: 'report-web', step: 4, target: '[data-testid="friend-web-intro"]', title: ['朋友由同一條連結查看結果', 'Friends view results on the same link'], copy: ['朋友用原本認帳連結；計算後可在同一頁查看結果，不需另發第二條連結。教學不會真的傳送。', 'Friends keep the original claim link and can view results there after calculation. No second link is needed; this guide does not send anything.'], prefer: 'top' },
    { key: 'report-fallback', step: 4, target: '[data-testid="report-fallback-toggle"]', title: ['簡單版和詳細版是後備', 'Summary and Detailed are backups'], copy: ['只有朋友無法開啟網頁連結時，才展開這個後備方案。試按標題查看兩種文字報告。', 'Expand these backups only if a friend cannot open the web link. Try the heading to reveal both text reports.'], prefer: 'top' },
    { key: 'report-share', step: 4, target: '[data-testid="summary-report-actions"]', title: ['簡單版：快速通知應付金額', 'Summary: a quick reimbursement message'], copy: ['需要文字後備時，簡單版列出每人應付金額。可以試按，但只會顯示教學提示，不會分享或改動剪貼簿。', 'Use the Summary text backup for each person’s amount. Try its buttons: they show a tutorial message without sharing or changing your clipboard.'] },
    { key: 'detail', step: 4, target: '[data-testid="detail-report-actions"]', title: ['詳細版：逐項核對的後備', 'Detailed: an item-by-item backup'], copy: ['詳細版適合需要逐項核對時使用；簡單版和詳細版擇一即可。完成教學會返回原有賬單，所有示例改動會丟棄。', 'Use Detailed when item-by-item checking is needed; choose either Summary or Detailed. Finishing returns to your original bill and discards sample changes.'] }
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
