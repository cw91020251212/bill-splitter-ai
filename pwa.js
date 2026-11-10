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
  var RELEASE_VERSION = 'v125-manual-claim-mode-20261110';
  var waitingWorker = null;
  var registrationPromise = null;
  var reloadRequested = false;

  function afterLoad(callback) {
    if (document.readyState === 'complete') callback();
    else window.addEventListener('load', callback, { once: true });
  }

  function offerUpdate(reg, sw) {
    // A first install may claim this page, but must never reload or offer an update.
    if (!sw || sw.state !== 'installed' ||
        !(reg.active || navigator.serviceWorker.controller)) return;
    waitingWorker = sw;
    if (!reloadRequested) showBar('🔄 有新版本可用', '更新', reloadLatest);
  }

  function registerWorker() {
    if (registrationPromise) return registrationPromise;
    if (!('serviceWorker' in navigator) || !SECURE) return Promise.resolve(null);
    registrationPromise = navigator.serviceWorker
      .register('sw.js', { scope: './', updateViaCache: 'none' })
      .then(function (reg) {
        function watchInstalling() {
          var sw = reg.installing;
          if (!sw) return;
          offerUpdate(reg, sw);
          sw.addEventListener('statechange', function () { offerUpdate(reg, sw); });
        }
        // Registration can resolve with an update already waiting or installing.
        offerUpdate(reg, reg.waiting);
        watchInstalling();
        reg.addEventListener('updatefound', watchInstalling);
        return reg;
      })
      .catch(function () {
        /* registration failure is non-fatal; the app still works online */
        return null;
      });
    return registrationPromise;
  }

  function reloadLatest() {
    if (reloadRequested) return;
    reloadRequested = true;
    removeBar();

    // Only an explicit action navigates. Preserve draft storage, deep links and
    // all unrelated query parameters; the timestamp bypasses the HTTP max-age.
    var url = new URL(location.href);
    url.searchParams.set('v', RELEASE_VERSION);
    url.searchParams.set('_update', String(Date.now()));
    var navigated = false;
    var worker = null;
    var activationRequested = false;
    var swSupported = 'serviceWorker' in navigator && SECURE;

    function navigate() {
      if (navigated) return;
      navigated = true;
      clearTimeout(fallback);
      if (swSupported) navigator.serviceWorker.removeEventListener('controllerchange', navigate);
      if (worker) worker.removeEventListener('statechange', activate);
      location.replace(url.toString());
    }

    function activate() {
      if (navigated || !worker) return;
      if (worker.state === 'installed' && !activationRequested) {
        activationRequested = true;
        try { worker.postMessage('SKIP_WAITING'); } catch (e) { navigate(); }
      } else if (worker.state === 'activated' || worker.state === 'redundant') {
        navigate();
      }
    }

    // A failed update/activation must not leave the user's update action stuck.
    var fallback = setTimeout(navigate, 5000);
    if (!swSupported) { navigate(); return; }
    navigator.serviceWorker.addEventListener('controllerchange', navigate);
    registerWorker().then(function (reg) {
      if (!reg || navigated) { navigate(); return; }
      // Check now as well: the header action may precede an updatefound event.
      return reg.update().catch(function () {}).then(function () {
        if (navigated) return;
        worker = reg.installing || reg.waiting ||
          (waitingWorker && waitingWorker.state === 'installed' ? waitingWorker : null);
        if (!worker) { navigate(); return; }
        worker.addEventListener('statechange', activate);
        activate();
      });
    }).catch(navigate);
  }

  // The app can save its active draft before invoking this explicit navigation.
  window.BillAppUpdate = { version: 'R114', reloadLatest: reloadLatest };

  if ('serviceWorker' in navigator && SECURE) {
    afterLoad(function () { registerWorker(); });
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
      'flex:0 0 auto;padding:9px 14px;border:0;border-radius:10px;background:linear-gradient(to top right,#49b88b,#b5f2cf);' +
      'color:#123d2c;font:700 14px system-ui,sans-serif;cursor:pointer';
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
    afterLoad(function () {
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
