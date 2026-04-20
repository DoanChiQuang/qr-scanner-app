// kun-v2/app.js
// Single-file app: auth (cookie-based), session check, scanner integration, UI updates.

(function () {
  // Config
  const API = {
    login: '/auth/login',
    session: '/auth/session',
    scan: '/scan'
  };

  const elements = {
    loginView: document.getElementById('loginView'),
    dashboardView: document.getElementById('dashboardView'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    btnLogin: document.getElementById('btnLogin'),
    loginMsg: document.getElementById('loginMsg'),
    modeCheckin: document.getElementById('modeCheckin'),
    modeCheckout: document.getElementById('modeCheckout'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    video: document.getElementById('video'),
    resultList: document.getElementById('resultList')
  };

  let currentMode = 'checkin';
  let codeReader = null; // kept for compatibility
  let scanning = false;
  const duplicateWindowMs = 3000; // ignore duplicates within this ms
  const lastSeen = new Map();
  let _videoStream = null;
  let _scanRaf = null;
  const frameThrottleMs = 150; // throttle readBarcodes calls

  // Utility: append result
  function appendResult(item) {
    const li = document.createElement('li');
    li.className = 'p-2 bg-white rounded shadow-sm flex justify-between items-start';
    li.innerHTML = `<div>
      <div class="font-medium">${escapeHtml(item.bib)} — ${escapeHtml(item.name || '')}</div>
      <div class="text-xs text-gray-500">${escapeHtml(item.message || '')}</div>
      </div>
      <div class="text-xs text-gray-600 ml-2">${escapeHtml(item.time)}</div>`;
    elements.resultList.prepend(li);
    // cap list
    while (elements.resultList.children.length > 200) elements.resultList.removeChild(elements.resultList.lastChild);
  }

  function escapeHtml(s) { return (s || '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // API helpers: use credentials include so browser sends/stores cookies
  async function postJson(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify(data),
      cache: 'no-store'
    });
    return res;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    return res;
  }

  // Login flow
  elements.btnLogin.addEventListener('click', async () => {
    elements.loginMsg.textContent = '';
    const u = elements.username.value.trim();
    const p = elements.password.value;
    if (!u || !p) { elements.loginMsg.textContent = 'Vui lòng nhập username và password'; return; }

    try {
      const r = await postJson(API.login, { username: u, password: p });
      if (!r.ok) {
        const t = await r.text(); elements.loginMsg.textContent = t || 'Login thất bại'; return;
      }

      // Server is expected to set cookie via Set-Cookie header; browser will store it.
      // Now call session endpoint to validate cookie & get user info
      const s = await getJson(API.session);
      if (!s.ok) { elements.loginMsg.textContent = 'Không thể xác thực session'; return; }
      const body = await s.json();
      showDashboard({ username: 'user', name: 'user' });
    } catch (err) {
      elements.loginMsg.textContent = 'Lỗi mạng: ' + (err.message || err);
    }
  });

  function showDashboard(user) {
    elements.loginView.classList.add('hidden');
    elements.dashboardView.classList.remove('hidden');
    // optionally show user info
  }

  // Mode buttons
  elements.modeCheckin.addEventListener('click', () => { currentMode = 'checkin'; elements.modeCheckin.classList.add('ring-2','ring-green-400'); elements.modeCheckout.classList.remove('ring-2','ring-yellow-400'); });
  elements.modeCheckout.addEventListener('click', () => { currentMode = 'checkout'; elements.modeCheckout.classList.add('ring-2','ring-yellow-400'); elements.modeCheckin.classList.remove('ring-2','ring-green-400'); });

  // Start / Stop
  elements.btnStart.addEventListener('click', startScanning);
  elements.btnStop.addEventListener('click', stopScanning);

  async function startScanning() {
    if (scanning) return; scanning = true;
    // ensure session still valid
    try {
      const s = await getJson(API.session);
      if (!s.ok) { appendResult({ bib:'', name:'', message: 'Session expired', time: new Date().toLocaleTimeString() }); return; }
    } catch (err) { appendResult({ message: 'Network error while checking session', time: new Date().toLocaleTimeString() }); }
    // prefer zxing-wasm readBarcodes when available
    const readBarcodes = window.ZXingWASM?.readBarcodes || window.ZXing?.readBarcodes || window.ZXingWASM?.readBarcodes;
    if (!readBarcodes) {
      appendResult({ message: 'ZXing readBarcodes API không có trên trang', time: new Date().toLocaleTimeString() });
      scanning = false; return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      _videoStream = stream;
      elements.video.srcObject = stream;
      await elements.video.play();

      appendResult({ message: 'Scanner started', time: new Date().toLocaleTimeString() });

      // create offscreen canvas for captures
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let lastFrameTime = 0;

      async function scanLoop() {
        if (!scanning) return;
        _scanRaf = requestAnimationFrame(scanLoop);
        const now = performance.now();
        if (now - lastFrameTime < frameThrottleMs) return;
        lastFrameTime = now;

        const vw = elements.video.videoWidth || 640;
        const vh = elements.video.videoHeight || 480;
        if (!vw || !vh) return;

        // scale canvas to video size (keep moderate size for performance)
        const maxEdge = 800;
        const scale = Math.min(1, Math.max(vw, vh) > maxEdge ? maxEdge / Math.max(vw, vh) : 1);
        const cw = Math.max(320, Math.round(vw * scale));
        const ch = Math.max(240, Math.round(vh * scale));
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }

        try {
          ctx.drawImage(elements.video, 0, 0, cw, ch);
          const imgData = ctx.getImageData(0, 0, cw, ch);
          const res = await readBarcodes(imgData);
          const barcodes = Array.isArray(res) ? res : (res?.barcodes || []);
          if (barcodes && barcodes.length) {
            // take first barcode
            const text = barcodes[0]?.text || barcodes[0]?.rawValue || '';
            if (text) onDetected(text);
          }
        } catch (e) {
          // non-fatal, continue
          // console.error('scan error', e);
        }
      }

      _scanRaf = requestAnimationFrame(scanLoop);
    } catch (err) {
      appendResult({ message: 'Lỗi scanner init: ' + (err.message||err), time: new Date().toLocaleTimeString() });
      scanning = false;
    }
  }

  function stopScanning() {
    if (!scanning) return;
    scanning = false;
    try { if (codeReader && codeReader.reset) codeReader.reset(); } catch (e) { /* ignore */ }
    if (_scanRaf) { cancelAnimationFrame(_scanRaf); _scanRaf = null; }
    if (_videoStream) {
      const tracks = _videoStream.getTracks();
      tracks.forEach(t => t.stop());
      _videoStream = null;
    }
    if (elements.video && elements.video.srcObject) { elements.video.srcObject = null; }
    appendResult({ message: 'Scanner dừng', time: new Date().toLocaleTimeString() });
  }

  // Handle detections with simple duplicate window
  async function onDetected(text) {
    const seen = lastSeen.get(text);
    const now = Date.now();
    if (seen && now - seen < duplicateWindowMs) return; // skip duplicate
    lastSeen.set(text, now);

    const bib = text.trim();
    const payload = { bib, action: currentMode };
    appendResult({ bib, name:'', message: 'Sending...', time: new Date().toLocaleTimeString() });

    try {
      const r = await postJson(API.scan, payload);
      if (!r.ok) {
        const t = await r.text();
        appendResult({ bib, message: 'Error: '+(t||r.status), time: new Date().toLocaleTimeString() });
        queueOffline(payload);
        return;
      }
      const body = await r.json();
      appendResult({ bib, name: body.name || '', message: body.message || 'OK', time: new Date().toLocaleTimeString() });
    } catch (err) {
      appendResult({ bib, message: 'Network error - queued', time: new Date().toLocaleTimeString() });
      queueOffline(payload);
    }
  }

  // Offline queue in localStorage
  function queueOffline(payload) {
    try {
      const q = JSON.parse(localStorage.getItem('scanQueue')||'[]'); q.push({...payload, ts:Date.now()}); localStorage.setItem('scanQueue', JSON.stringify(q));
    } catch (e) { /* ignore */ }
  }

  // Try flush queue when online
  async function flushQueue() {
    try {
      const q = JSON.parse(localStorage.getItem('scanQueue')||'[]');
      if (!q.length) return;
      for (const item of q.slice()) {
        try {
          const r = await postJson(API.scan, { bib: item.bib, action: item.action });
          if (r.ok) {
            appendResult({ bib: item.bib, message: 'Flushed', time: new Date().toLocaleTimeString() });
            // remove first occurrence
            const arr = JSON.parse(localStorage.getItem('scanQueue')||'[]');
            const idx = arr.findIndex(x=>x.ts===item.ts);
            if (idx>=0) { arr.splice(idx,1); localStorage.setItem('scanQueue', JSON.stringify(arr)); }
          }
        } catch (e) { /* leave in queue */ }
      }
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('online', () => { appendResult({ message: 'Online - flushing queue', time: new Date().toLocaleTimeString() }); flushQueue(); });

  // attempt flush on load
  setTimeout(flushQueue, 2000);

})();
