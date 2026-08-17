// ============================================================
// AcornTrade Service Worker — PWA 離線快取
//
// 策略：只快取「App Shell」本身（頁面 HTML + 固定版本的 CDN 函式庫 + 圖示），
// 一律採用 Cache First，讓離線或網路不穩時仍能開啟 App、讀取本機已存的模擬帳戶資料
// （帳戶資料本身是存在 localStorage / IndexedDB，本來就不需要網路）。
//
// 即時性資料（Yahoo Finance 報價、Gemini API、代理伺服器、符號搜尋 API...）完全不攔截、
// 直接放行給瀏覽器原生處理——這裡採用「白名單」而非「黑名單」的判斷方式：
// 只有明確列在 APP_SHELL 清單裡的固定資源才會被攔截快取，其餘任何請求一律不經過這支 Service Worker，
// 避免不小心快取到過期報價、或干擾到任何未來新增的 API 呼叫。
// ============================================================

const CACHE_VERSION = 'v1';
const CACHE_NAME = `acorntrade-shell-${CACHE_VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './logo.png',
    './icon.png',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// 把 APP_SHELL 清單轉成絕對網址集合，方便之後用「完整網址是否相符」做白名單比對
function buildShellUrlSet() {
    const set = new Set();
    APP_SHELL.forEach((u) => {
        try { set.add(new URL(u, self.location.href).href); } catch (e) { /* 忽略無法解析的項目 */ }
    });
    return set;
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch(() => {}) // 任何一個資源快取失敗都不應該讓整個安裝流程掛掉（例如使用者網路暫時不穩）
    );
    self.skipWaiting(); // 新版 Service Worker 安裝完立刻接管，不用等使用者關閉所有分頁
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // 只處理 GET；POST（例如呼叫 Gemini API）一律不攔截，原生放行

    const shellUrls = buildShellUrlSet();
    if (!shellUrls.has(req.url)) return; // 白名單以外的請求（所有即時報價／API）完全不攔截

    event.respondWith(
        caches.match(req).then((cached) => {
            // 快取優先：有快取就先回應，同時在背景重新抓取最新版本更新快取（stale-while-revalidate），
            // 讓 App Shell 平常也能保持最新，離線時則直接吃快取版本
            const networkFetch = fetch(req).then((res) => {
                if (res && res.status === 200) {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
                }
                return res;
            }).catch(() => cached); // 網路失敗時退回快取版本（若原本就沒有快取，則整個 Promise 會是 undefined，由下面兜底）

            return cached || networkFetch;
        })
    );
});
