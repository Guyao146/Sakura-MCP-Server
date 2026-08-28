/**
 * Branded login landing page. `/auth/login` renders this page instead of
 * redirecting straight to Authentik so that a signed-out visitor sees an
 * explicit Sakura entry point and is not silently re-authenticated by an
 * existing SSO cookie. The actual OIDC redirect happens on `/auth/start`.
 *
 * No server data is templated into the markup: the return target and the
 * status notice are derived in the browser from the query string and written
 * with textContent or an encoded query parameter.
 */
export const loginPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · Sakura-MCP-Server</title><style>
:root{color-scheme:dark;--bg:#0b0f16;--panel:#151b26;--line:#293244;--text:#edf2fa;--muted:#96a3b7;--accent:#e58aa3;--warn:#ffd479}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(1200px 600px at 50% -10%,#1d2434,var(--bg));color:var(--text);font:14px/1.6 system-ui,sans-serif}main{width:100%;max-width:420px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:34px 30px;text-align:center}.brand{font-size:23px;font-weight:750;letter-spacing:.3px}.brand b{color:var(--accent)}.version{display:block;margin-top:6px;font-size:12px;color:var(--muted)}p{color:var(--muted);margin:18px 0 24px}#notice{display:none;margin:0 0 22px;padding:11px 13px;border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:9px;background:#101621;color:var(--warn);text-align:left;font-size:13px}a.button{display:block;background:var(--accent);color:#25141a;border-radius:9px;padding:12px 16px;font-weight:700;text-decoration:none}a.button:hover{filter:brightness(1.07)}a.button:focus-visible{outline:2px solid #fff;outline-offset:2px}.hint{margin:22px 0 0;font-size:12px;color:var(--muted)}
</style></head><body>
<main>
  <h1 class="brand"><b>Sakura</b>-MCP-Server<span id="version" class="version">管理台登录</span></h1>
  <div id="notice" role="status"></div>
  <p>本站使用 Authentik 单点登录，请通过下方按钮继续。</p>
  <a id="startButton" class="button" href="/auth/start">使用 Authentik 登录</a>
  <p class="hint">登录后可管理记忆空间、Agent 密钥与模型 Provider。</p>
</main>
<script>
var params=new URLSearchParams(location.search);
var target=params.get('return_to')||'/admin';
var safeTarget=/^\\/(?!\\/)/.test(target)?target:'/admin';
document.getElementById('startButton').href='/auth/start?return_to='+encodeURIComponent(safeTarget);
var notices={expired:'登录状态已过期，请重新登录。',logged_out:'已退出登录，Authentik 单点登录会话也已结束。'};
var notice=notices[params.get('reason')];
if(notice){var box=document.getElementById('notice');box.textContent=notice;box.style.display='block'}
fetch('/health',{headers:{Accept:'application/json'}}).then(function(r){return r.json()}).then(function(d){
  if(d&&d.version)document.getElementById('version').textContent='v'+d.version
}).catch(function(){});
document.getElementById('startButton').focus();
</script>
</body></html>`;
