// ============================================================
// AcornTrade Service Worker — PWA 離線快取
//
// 策略調整說明（相較上一版）：
// 原本「App Shell」清單裡的所有資源（包含 index.html 本身）都是 Cache First +
// 背景 stale-while-revalidate：每次都「先」回傳快取版本，同時在背景重新抓一份更新快取，
// 給「下一次」載入使用。這代表只要瀏覽器/PWA 之前已經跑過一次這支 Service Worker、
// 已經有快取存在，之後不管伺服器上的 index.html 換成什麼新版本，使用者第一次載入永遠
// 還是看到「舊的那份」——這正是「明明已經改好、部署上去，畫面卻完全沒變」最常見的原因，
// 跟本次「加入主畫面版面跑掉」是兩個各自獨立、但會疊加在一起造成困惑的問題。
//
// 這裡把資源分成兩類，採用不同策略：
// 1. index.html（含 './'，也就是 PWA 啟動時的 start_url）：改成 Network First。
//    只要裝置目前有網路，一律直接向伺服器要「最新版」，成功才寫回快取；
//    真的離線、或網路請求失敗時，才退回快取版本，維持離線可用。
//    這樣你以後改完程式碼、部署上去，使用者只要正常開啟 App（有網路）就一定拿得到最新版面，
//    不需要再手動清除網站資料。
// 2. 其餘固定版本的資源（manifest.json、icon、CDN 函式庫等）：維持原本 Cache First +
//    背景更新，因為這些內容變動頻率低，優先讀取速度、離線也要能用。
//
// 另外：CACHE_VERSION 之後如果你調整「白名單清單本身」（例如新增/刪除某個要快取的檔案），
// 記得手動升版（例如 v1 -> v2），這樣舊的快取分類會在 activate 階段被整批清掉重建，
// 避免新舊清單的殘留資料互相打架。日常只是改 index.html 內容本身，靠上面的 Network First
// 就會自動拿到最新版，不需要每次都升版。
// ============================================================

const CACHE_VERSION = 'v2';
const CACHE_NAME = `acorntrade-shell-${CACHE_VERSION}`;

// 需要「一律先嘗試網路、失敗才退回快取」的資源（PWA 啟動頁本身）
const NETWORK_FIRST = [
    './',
    './index.html'
];

// 其餘維持「快取優先＋背景更新」的固定資源
const CACHE_FIRST = [
    './manifest.json',
    './logo.png',
    './icon.png',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

const APP_SHELL = [...NETWORK_FIRST, ...CACHE_FIRST];

// 把清單轉成絕對網址集合，方便之後用「完整網址是否相符」做白名單比對
function buildUrlSet(list) {
    const set = new Set();
    list.forEach((u) => {
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

    const networkFirstUrls = buildUrlSet(NETWORK_FIRST);
    const cacheFirstUrls = buildUrlSet(CACHE_FIRST);

    if (networkFirstUrls.has(req.url)) {
        // Network First：一律先試著跟伺服器要最新版，成功就同時更新快取；
        // 失敗（離線／逾時）才退回本機快取，維持離線仍可開啟 App。
        event.respondWith(
            fetch(req).then((res) => {
                if (res && res.status === 200) {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
                }
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    if (!cacheFirstUrls.has(req.url)) return; // 白名單以外的請求（所有即時報價／API）完全不攔截

    event.respondWith(
        caches.match(req).then((cached) => {
            // 快取優先：有快取就先回應，同時在背景重新抓取最新版本更新快取（stale-while-revalidate）
            const networkFetch = fetch(req).then((res) => {
                if (res && res.status === 200) {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
                }
                return res;
            }).catch(() => cached);

            return cached || networkFetch;
        })
    );
});
