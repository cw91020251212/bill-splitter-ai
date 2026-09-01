/*
 * PWA bootstrap for 分帳管家 AI
 * ---------------------------------------------------------------------------
 * Runs independently of the React app (no shared state), so the app code in
 * index.html does not need to know this file exists.
 *
 *   1. Registers the service worker (skipped on http:// and file://).
 *   2. Shows a dismissible "安裝 App" bar when the browser fires
 *      beforeinstallprompt (Chrome / Edge / Samsung on Android + desktop).
 *   3. Shows a one-time iOS hint, since Safari has no install prompt API and
 *      requires 分享 → 加入主畫面.
 *   4. Offers a reload when a new service worker is waiting.
 */
(function () {
  'use strict';

  var SECURE =
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';

  var DISMISS_KEY = 'billSplitterInstallDismissed';
  var IOS_HINT_KEY = 'billSplitterIosHintShown';

  function store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }
  function stored(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  var isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  /* ---------------------------------------------------------- service worker */
  var waitingWorker = null;

  if ('serviceWorker' in navigator && SECURE) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('sw.js', { scope: './' })
        .then(function (reg) {
          reg.addEventListener('updatefound', function () {
            var sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', function () {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                waitingWorker = sw;
                showBar(
                  '🔄 有新版本可用',
                  '更新',
                  function () {
                    if (waitingWorker) waitingWorker.postMessage('SKIP_WAITING');
                  }
                );
              }
            });
          });
        })
        .catch(function () {
          /* registration failure is non-fatal; the app still works online */
        });

      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    });
  }

  /* ------------------------------------------------------------------- UI bar */
  var bar = null;

  function removeBar() {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
  }

  function showBar(message, actionLabel, onAction) {
    removeBar();

    bar = document.createElement('div');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', message);
    bar.style.cssText = [
      'position:fixed',
      'left:12px',
      'right:12px',
      'bottom:calc(12px + env(safe-area-inset-bottom, 0px))',
      'z-index:2147483000',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'max-width:480px',
      'margin:0 auto',
      'padding:12px 14px',
      'border-radius:16px',
      'background:#ffffff',
      'border:1px solid #d1fae5',
      'box-shadow:0 10px 30px rgba(0,0,0,.18)',
      'font:600 14px/1.4 system-ui,-apple-system,"Noto Sans HK","PingFang HK",sans-serif',
      'color:#111827'
    ].join(';');

    var icon = document.createElement('img');
    icon.src = 'icons/icon-96.png';
    icon.alt = '';
    icon.width = 36;
    icon.height = 36;
    icon.style.cssText = 'width:36px;height:36px;border-radius:9px;flex:0 0 auto';

    var text = document.createElement('div');
    text.textContent = message;
    text.style.cssText = 'flex:1 1 auto;min-width:0';

    var act = document.createElement('button');
    act.type = 'button';
    act.textContent = actionLabel;
    act.style.cssText =
      'flex:0 0 auto;padding:9px 14px;border:0;border-radius:10px;background:#16a34a;' +
      'color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer';
    act.addEventListener('click', function () {
      onAction();
    });

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', '關閉');
    close.style.cssText =
      'flex:0 0 auto;width:30px;height:30px;border:0;border-radius:8px;background:#f3f4f6;' +
      'color:#6b7280;font:700 14px system-ui,sans-serif;cursor:pointer';
    close.addEventListener('click', function () {
      store(DISMISS_KEY, '1');
      removeBar();
    });

    bar.appendChild(icon);
    bar.appendChild(text);
    bar.appendChild(act);
    bar.appendChild(close);
    document.body.appendChild(bar);
  }

  /* ------------------------------------------------------- install prompting */
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (isStandalone || stored(DISMISS_KEY)) return;
    showBar('📲 安裝分帳管家，用起嚟快啲', '安裝', function () {
      removeBar();
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'dismissed') store(DISMISS_KEY, '1');
        deferredPrompt = null;
      });
    });
  });

  window.addEventListener('appinstalled', function () {
    store(DISMISS_KEY, '1');
    deferredPrompt = null;
    removeBar();
  });

  // iOS Safari: no install API, so surface the manual steps once.
  var ua = navigator.userAgent || '';
  var isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.indexOf('Macintosh') > -1 && 'ontouchend' in document);
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

  if (isIOS && isSafari && !isStandalone && !stored(IOS_HINT_KEY) && !stored(DISMISS_KEY)) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (bar) return;
        store(IOS_HINT_KEY, '1');
        showBar('分享 → 加入主畫面，即可安裝', '知道了', removeBar);
      }, 2500);
    });
  }

  // Exposed so the app (or you) can trigger the prompt from a custom button.
  window.billSplitterInstall = function () {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    return true;
  };
})();
