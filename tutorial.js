(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.React) return;

  var React = window.React;
  var h = React.createElement;
  var useEffect = React.useEffect;
  var useLayoutEffect = React.useLayoutEffect;
  var useRef = React.useRef;
  var useState = React.useState;

  var STAGES = [
    {
      key: 'upload',
      step: 1,
      target: '[data-testid="receipt-source-actions"]',
      nameZh: '上載睇單',
      nameEn: 'Upload receipt',
      titleZh: '準備收據資料',
      titleEn: 'Prepare the receipt',
      bodyZh: '先揀「直接影相」或「選擇圖片」，最多 5 張。沒有圖片亦可手動輸入。教學會用示範單據繼續，不會開相機、揀檔或讀取你的鎖匙。',
      bodyEn: 'Here are the receipt source options. In the real app, choose a suitable way to provide a receipt; this demo will not read any files.',
      tipZh: '現在只作導覽，請用「下一步」繼續。',
      tipEn: 'This is a guided preview. Use “Next” to continue.'
    },
    {
      key: 'items',
      step: 2,
      target: '[data-tutorial-target="item-editor"]',
      nameZh: '編輯項目',
      nameEn: 'Edit items',
      titleZh: '核對及各自認帳',
      titleEn: 'Review and assign items',
      bodyZh: '讀單後先核對菜名同價錢。這裡已自動按「改」，打開單價、總量同單位欄。平時只改錯的地方；總量不清楚可以留空。',
      bodyEn: 'The Edit button has been opened for you. Check the item name, price, receipt quantity and unit. Leave the quantity blank if it is unknown.',
      tipZh: '這是第 2 步的第一個畫面。',
      tipEn: 'This is the first screen in step 2.'
    },
    {
      key: 'share',
      step: 2,
      target: 'dialog[aria-labelledby="claim-share-title"]',
      nameZh: '分享帳單',
      nameEn: 'Share the bill',
      titleZh: '了解分享選項',
      titleEn: 'See the sharing options',
      bodyZh: '已幫你打開分享選項。正式使用時，先發一個認帳連結，再另外發單據圖片或附件；朋友不用你的 API 鎖匙。教學不會真的分享。',
      bodyEn: 'This screen shows how to invite others to review their items. No share link will be created or sent during the tutorial.',
      tipZh: '不會分享任何資料。',
      tipEn: 'Nothing will be shared.'
    },
    {
      key: 'replies',
      step: 2,
      target: '[data-testid="claim-replies"]',
      nameZh: '查看回覆',
      nameEn: 'Review replies',
      titleZh: '跟進同行者回覆',
      titleEn: 'Follow up on replies',
      bodyZh: '分享後先會展開這一欄，教學已自動打開。朋友填好再按「交返發起人」，認帳就會出現。示例：阿明 2 份、Cathy 1 份；只填數字就是份數比例。',
      bodyEn: 'When participants respond with their item assignments, review them here and return to check the items. This tour sends no notifications or replies.',
      tipZh: '這是第 2 步的最後一個畫面。',
      tipEn: 'This is the final screen in step 2.'
    },
    {
      key: 'payer',
      step: 3,
      target: '[data-tutorial-target="calculation-settings"]',
      nameZh: '設定付款人',
      nameEn: 'Set the payer',
      titleZh: '設定結帳計算',
      titleEn: 'Set up the calculation',
      bodyZh: '填先付款人的姓名，再核對下面的貨幣、收款方式及服務費分法。這裡用阿明作示範；下一步會自動產生示範報告，不會改動你的帳單。',
      bodyEn: 'Enter the person who paid first. Check the currency, payment methods and fee split below. Next opens a sample report without changing your bill.',
      tipZh: '請按「下一步」前往報告示範。',
      tipEn: 'Choose “Next” to see the report preview.'
    },
    {
      key: 'report',
      step: 4,
      target: '[data-testid="summary-report-actions"]',
      nameZh: '最終結果',
      nameEn: 'Review the report',
      titleZh: '完成分帳核對',
      titleEn: 'Finish reviewing the split',
      bodyZh: '示例：$120 食物加 $12 服務費，按 2：1 分，阿明付 $88、Cathy 付 $44。正式使用時可分享純文字報告，再另發單據圖片。按「完成教學」便會還原原本畫面。',
      bodyEn: 'Example: $120 plus a $12 fee, split 2:1, gives Ming $88 and Cathy $44. Share text first, then receipt images separately. Finish restores your original screen.',
      tipZh: '已到達第 4 步；按「完成教學」離開。',
      tipEn: 'You are at step 4. Select “Finish tutorial” to leave.'
    }
  ];

  var MAJOR_STEP_FIRST_STAGE = [0, 1, 4, 5];
  var FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };

  function BillTutorial(props) {
    props = props || {};
    var language = String(props.language || 'zh-HK').toLowerCase();
    var isEnglish = language.indexOf('en') === 0;
    var stageIndexState = useState(0);
    var stageIndex = stageIndexState[0];
    var setStageIndex = stageIndexState[1];
    var layoutState = useState(null);
    var layout = layoutState[0];
    var setLayout = layoutState[1];
    var demoRef = useRef(null);
    var cardRef = useRef(null);
    var closeRef = useRef(null);
    var rafRef = useRef(0);
    var stageMeasureRef = useRef(null);
    var needsAlignRef = useRef(true);
    var stageRef = useRef(stageIndex);
    var targetRef = useRef(null);
    var sideRef = useRef('bottom');
    var onCloseRef = useRef(props.onClose);
    var onHelpRef = useRef(props.onOpenHelp);
    var stage = STAGES[stageIndex];

    onCloseRef.current = props.onClose;
    onHelpRef.current = props.onOpenHelp;

    var close = function () {
      if (typeof onCloseRef.current === 'function') onCloseRef.current();
    };

    var goTo = function (index) {
      setStageIndex(clamp(index, 0, STAGES.length - 1));
    };

    var currentMajorStep = stage.step;
    var majorName = isEnglish
      ? ['Upload receipt', 'Split items', 'Payer & calculation', 'Review report'][currentMajorStep - 1]
      : ['上載睇單', '各自認帳', '分帳運算', '最終結果'][currentMajorStep - 1];

    useLayoutEffect(function () {
      var demo = demoRef.current;
      if (demo) {
        try { demo.inert = true; } catch (_) {}
        demo.setAttribute('inert', '');
        demo.setAttribute('aria-hidden', 'true');
      }
      if (closeRef.current) closeRef.current.focus({ preventScroll: true });
    }, []);

    useEffect(function () {
      var dialog = cardRef.current;
      if (!dialog) return undefined;

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== 'Tab') return;
        var controls = Array.prototype.slice.call(dialog.querySelectorAll(FOCUSABLE))
          .filter(function (element) { return element.getClientRects().length > 0; });
        if (!controls.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        var first = controls[0];
        var last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }

      window.addEventListener('keydown', onKeyDown, true);
      return function () { window.removeEventListener('keydown', onKeyDown, true); };
    }, []);

    useEffect(function () {
      stageRef.current = stageIndex;
      targetRef.current = null;
      needsAlignRef.current = true;
      setLayout(null);
      var frame2 = 0;
      var frame1 = window.requestAnimationFrame(function () {
        frame2 = window.requestAnimationFrame(function () {
          var demo = demoRef.current;
          var activeStage = STAGES[stageIndex];
          if (!demo) return;
          var target = demo.querySelector(activeStage.target);
          targetRef.current = target;
          if (target) {
            var rect = target.getBoundingClientRect();
            var vv = window.visualViewport;
            var viewportTop = vv ? vv.offsetTop : 0;
            var viewportHeight = vv ? vv.height : window.innerHeight;
            sideRef.current = rect.top + rect.height / 2 - viewportTop > viewportHeight / 2 ? 'top' : 'bottom';
          }
          if (stageMeasureRef.current) stageMeasureRef.current();
        });
      });
      return function () {
        window.cancelAnimationFrame(frame1);
        if (frame2) window.cancelAnimationFrame(frame2);
      };
    }, [stageIndex, stage.key]);

    useEffect(function () {
      var disposed = false;
      var observedTarget = null;
      var resizeObserver = null;
      var mutationObserver = null;

      function measure() {
        if (disposed) return;
        var demo = demoRef.current;
        var target = targetRef.current;
        var activeStage = STAGES[stageRef.current];
        if ((!target || !target.isConnected) && demo) {
          target = demo.querySelector(activeStage.target);
          targetRef.current = target;
        }

        var vv = window.visualViewport;
        var viewport = {
          left: vv ? vv.offsetLeft : 0,
          top: vv ? vv.offsetTop : 0,
          width: vv ? vv.width : window.innerWidth,
          height: vv ? vv.height : window.innerHeight
        };
        var cardHeight = cardRef.current ? cardRef.current.getBoundingClientRect().height : Math.min(viewport.height * 0.4, 300);
        var cardTop = sideRef.current === 'top' ? 10 : Math.max(10, viewport.height - cardHeight - 10);
        var cardBottom = cardTop + cardHeight;
        var rect = null;
        var safeTop = sideRef.current === 'top' ? Math.min(viewport.height - 20, cardBottom + 24) : 12;
        var safeBottom = sideRef.current === 'bottom' ? Math.max(20, cardTop - 24) : viewport.height - 12;

        if (target && target.isConnected) {
          var bounds = target.getBoundingClientRect();
          rect = {
            left: bounds.left - viewport.left,
            top: bounds.top - viewport.top,
            right: bounds.right - viewport.left,
            bottom: bounds.bottom - viewport.top,
            width: bounds.width,
            height: bounds.height
          };
          var safeHeight = Math.max(40, safeBottom - safeTop);
          var nextTop = rect.top;
          if (rect.height <= safeHeight) {
            if (rect.top < safeTop) nextTop = safeTop;
            else if (rect.bottom > safeBottom) nextTop = safeBottom - rect.height;
          } else {
            nextTop = safeTop;
          }
          if (needsAlignRef.current && Math.abs(nextTop - rect.top) > 3) {
            window.scrollBy({ top: rect.top - nextTop, behavior: 'instant' });
            var updated = target.getBoundingClientRect();
            rect.top = updated.top - viewport.top;
            rect.bottom = updated.bottom - viewport.top;
            rect.left = updated.left - viewport.left;
            rect.right = updated.right - viewport.left;
          }

          needsAlignRef.current = false;
          if (resizeObserver && observedTarget !== target) {
            if (observedTarget) resizeObserver.unobserve(observedTarget);
            resizeObserver.observe(target);
            observedTarget = target;
          }
        } else {
          rect = null;
        }

        var left = rect ? clamp(rect.left - 5, 5, Math.max(5, viewport.width - 10)) : 0;
        var top = rect ? clamp(rect.top - 5, safeTop - 5, Math.max(safeTop - 5, safeBottom + 5)) : 0;
        var right = rect ? clamp(rect.right + 5, 5, Math.max(5, viewport.width - 5)) : 0;
        var bottom = rect ? clamp(rect.bottom + 5, top, safeBottom + 5) : 0;
        setLayout({
          left: viewport.left,
          top: viewport.top,
          width: viewport.width,
          height: viewport.height,
          cardTop: cardTop,
          cardBottom: cardBottom,
          cardHeight: cardHeight,
          target: rect,
          cutout: rect ? { left: left, top: top, right: right, bottom: bottom } : null
        });
      }

      function scheduleMeasure() {
        if (disposed || rafRef.current) return;
        rafRef.current = window.requestAnimationFrame(function () {
          rafRef.current = 0;
          measure();
        });
      }

      function realign() { needsAlignRef.current = true; scheduleMeasure(); }
      stageMeasureRef.current = realign;
      window.addEventListener('resize', realign, { passive: true });
      window.addEventListener('scroll', scheduleMeasure, { passive: true, capture: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', realign, { passive: true });
        window.visualViewport.addEventListener('scroll', scheduleMeasure, { passive: true });
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(realign);
        if (demoRef.current) resizeObserver.observe(demoRef.current);
        if (cardRef.current) resizeObserver.observe(cardRef.current);
      }
      if (typeof MutationObserver !== 'undefined' && demoRef.current) {
        mutationObserver = new MutationObserver(scheduleMeasure);
        mutationObserver.observe(demoRef.current, { childList: true, subtree: true, attributes: true });
      }
      scheduleMeasure();
      return function () {
        disposed = true;
        window.removeEventListener('resize', realign);
        window.removeEventListener('scroll', scheduleMeasure, true);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', realign);
          window.visualViewport.removeEventListener('scroll', scheduleMeasure);
        }
        if (resizeObserver) resizeObserver.disconnect();
        if (mutationObserver) mutationObserver.disconnect();
        if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        if (stageMeasureRef.current === realign) stageMeasureRef.current = null;
      };
    }, []);

    function maskStyles(cutout, width, height) {
      if (!cutout) return null;
      var x = cutout.left;
      var y = cutout.top;
      var r = cutout.right;
      var b = cutout.bottom;
      return [
        { left: 0, top: 0, width: width, height: y },
        { left: 0, top: y, width: x, height: Math.max(0, b - y) },
        { left: r, top: y, width: Math.max(0, width - r), height: Math.max(0, b - y) },
        { left: 0, top: b, width: width, height: Math.max(0, height - b) }
      ];
    }

    var mask = layout && layout.cutout ? maskStyles(layout.cutout, layout.width, layout.height) : [];
    var layerStyle = layout ? {
      left: layout.left + 'px',
      top: layout.top + 'px',
      width: layout.width + 'px',
      height: layout.height + 'px'
    } : undefined;
    var cardStyle = layout ? {
      left: (layout.left + 12) + 'px',
      right: Math.max(12, window.innerWidth - layout.left - layout.width + 12) + 'px',
      top: sideRef.current === 'top' ? (layout.top + layout.cardTop) + 'px' : 'auto',
      bottom: sideRef.current === 'bottom' ? Math.max(0, window.innerHeight - layout.top - layout.cardBottom) + 'px' : 'auto'
    } : { bottom: '10px' };
    var cutoutStyle = layout && layout.cutout ? {
      left: layout.cutout.left + 'px', top: layout.cutout.top + 'px',
      width: Math.max(0, layout.cutout.right - layout.cutout.left) + 'px',
      height: Math.max(0, layout.cutout.bottom - layout.cutout.top) + 'px'
    } : undefined;

    var stepButtons = [1, 2, 3, 4].map(function (number) {
      var isActive = currentMajorStep === number;
      var firstStageIndex = MAJOR_STEP_FIRST_STAGE[number - 1];
      return h('button', {
        key: number,
        type: 'button',
        className: 'bt-step' + (isActive ? ' is-active' : ''),
        'aria-current': isActive ? 'step' : undefined,
        'aria-label': (isEnglish ? 'Step ' : '第 ') + number + (isEnglish ? ': ' : ' 步：') + (isEnglish ? ['Upload receipt', 'Split items', 'Payer & calculation', 'Review report'][number - 1] : ['上載睇單', '各自認帳', '分帳運算', '最終結果'][number - 1]),
        onClick: function () { goTo(firstStageIndex); }
      }, h('span', { className: 'bt-step-number', 'aria-hidden': 'true' }, String(number)), h('span', { className: 'bt-step-label' }, isEnglish ? ['Upload', 'Split', 'Calculate', 'Report'][number - 1] : ['上載', '分帳', '計算', '報告'][number - 1]));
    });

    var demoNode = React.useMemo(function () {
      return typeof props.renderDemo === 'function' ? props.renderDemo(stage.key) : null;
    }, [props.renderDemo, stage.key]);

    return h('div', { className: 'bt-root', 'data-testid': 'interactive-tutorial', 'data-stage': stage.key },
      h('div', {
        className: 'bt-demo',
        'data-tutorial-demo': '',
        'aria-hidden': 'true',
        inert: '',
        ref: demoRef
      }, demoNode),
      h('div', { className: 'bt-layer', style: layerStyle, 'aria-hidden': 'true' },
        mask.map(function (style, index) {
          return h('div', { className: 'bt-mask', key: index, style: style });
        }),
        cutoutStyle ? h('div', { className: 'bt-highlight', style: cutoutStyle, 'data-testid': 'tutorial-highlight' }) : null
      ),
      h('section', {
        className: 'bt-card',
        'data-testid': 'tutorial-card',
        style: cardStyle,
        ref: cardRef,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'bt-title',
        'aria-describedby': 'bt-description',
        tabIndex: -1
      },
        h('header', { className: 'bt-card-header' },
          h('div', { className: 'bt-kicker' },
            h('span', { className: 'bt-brand-dot', 'aria-hidden': 'true' }),
            h('span', null, isEnglish ? 'BILL SPLIT · QUICK TOUR' : '分帳教學 · QUICK TOUR')
          ),
          h('button', {
            type: 'button', className: 'bt-close', ref: closeRef,
            'data-testid': 'tutorial-close',
            'aria-label': isEnglish ? 'Close tutorial' : '關閉教學',
            onClick: close
          }, h('span', { 'aria-hidden': 'true' }, '×'))
        ),
        h('nav', { className: 'bt-steps', 'aria-label': isEnglish ? 'Tutorial steps' : '教學步驟' }, stepButtons),
        h('div', { className: 'bt-copy' },
          h('div', { className: 'bt-progress' },
            h('span', { className: 'bt-progress-main' }, (isEnglish ? 'STEP ' : '第 ') + currentMajorStep + (isEnglish ? ' / 4 · ' : ' / 4 步 · ') + majorName),
            h('span', { className: 'bt-progress-sub' }, (isEnglish ? 'SCREEN ' : '畫面 ') + (stageIndex + 1) + (isEnglish ? ' / 6 · ' : ' / 6 · ') + (isEnglish ? stage.nameEn : stage.nameZh))
          ),
          h('h2', { id: 'bt-title' }, isEnglish ? stage.titleEn : stage.titleZh),
          h('p', { id: 'bt-description', className: 'bt-description' }, isEnglish ? stage.bodyEn : stage.bodyZh),
          h('p', { className: 'bt-hint' }, isEnglish ? stage.tipEn : stage.tipZh),
          h('p', { className: 'bt-safety' }, isEnglish
            ? 'Demo only: nothing is shared, no API keys are read and the bill is not changed. Leaving the tutorial restores the app.'
            : '只作示範：不會分享資料、不會讀取 API 鎖匙，亦不會修改帳單。離開教學後會還原 App。')
        ),
        h('footer', { className: 'bt-controls' },
          h('button', {
            type: 'button', className: 'bt-help',
            onClick: function () { if (typeof onHelpRef.current === 'function') onHelpRef.current(); }
          }, isEnglish ? 'More help' : '詳細說明'),
          h('div', { className: 'bt-next-controls' },
            h('button', {
              type: 'button', className: 'bt-previous', disabled: stageIndex === 0,
              'data-testid': 'tutorial-prev',
              onClick: function () { goTo(stageIndex - 1); }
            }, isEnglish ? 'Back' : '上一步'),
            stageIndex < STAGES.length - 1
              ? h('button', { type: 'button', className: 'bt-next', 'data-testid': 'tutorial-next', onClick: function () { goTo(stageIndex + 1); } }, isEnglish ? 'Next' : '下一步')
              : h('button', { type: 'button', className: 'bt-next', 'data-testid': 'tutorial-next', onClick: close }, isEnglish ? 'Finish tutorial' : '完成教學')
          )
        )
      )
    );
  }

  window.BillTutorial = BillTutorial;
})();
