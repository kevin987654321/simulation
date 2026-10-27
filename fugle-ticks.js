// 富果 Fugle 逐筆成交代理。Key 只放在 Worker 的 Secret：env.FUGLE_API_KEY
// 部署：wrangler secret put FUGLE_API_KEY   （或 Cloudflare Dashboard → Worker → Settings → Variables and Secrets，類型選 Secret）
// 選用：env.ALLOWED_ORIGIN（例如 https://你的帳號.github.io）；未設定則允許所有來源（Key 不外洩，但他人可借你的額度）

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '*';
  const ok = allowed === '*' || origin === allowed;
  return {
    'Access-Control-Allow-Origin': ok ? (allowed === '*' ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const json = (obj, status, extra) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

export async function handleFugleTicks(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
  if (!env.FUGLE_API_KEY) return json({ error: 'Worker 未設定 FUGLE_API_KEY' }, 500, cors);

  const raw = new URL(request.url).searchParams.get('symbol') || '';
  const symbol = raw.trim().replace(/\.(TW|TWO)$/i, '').toUpperCase();
  if (!/^[0-9A-Z]{1,10}$/.test(symbol)) return json({ error: 'invalid symbol' }, 400, cors);

  try {
    const up = await fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticks/${symbol}`, {
      headers: { 'X-API-KEY': env.FUGLE_API_KEY },
    });
    const body = await up.text();
    return new Response(body, {
      status: up.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
    });
  } catch (e) {
    return json({ error: 'upstream fetch failed' }, 502, cors);
  }
}

// ── 整合到你現有的 Worker（只需加這幾行，原本的 ?url= 代理邏輯不動）──
// import { handleFugleTicks } from './fugle-ticks.js';
// export default {
//   async fetch(request, env, ctx) {
//     const url = new URL(request.url);
//     if (url.pathname === '/api/fugle/ticks') return handleFugleTicks(request, env);
//     ... 你原本的程式碼 ...
//   }
// };
// 若你的 Worker 是舊式 addEventListener('fetch') 寫法，把 handleFugleTicks 內容貼進同一檔，
// 並把 env.FUGLE_API_KEY 改成以 Dashboard 綁定的全域變數 FUGLE_API_KEY。
