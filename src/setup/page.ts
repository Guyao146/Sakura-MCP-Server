export const setupPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sakura-MCP-Server 安装向导</title>
  <style>
    :root{color-scheme:dark;--bg:#0c1017;--card:#151b26;--line:#293244;--text:#edf2fa;--muted:#99a6ba;--accent:#e58aa3;--ok:#67d6a3;--bad:#ff7b86}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#252039 0,transparent 35%),var(--bg);font:15px/1.6 system-ui,sans-serif;color:var(--text)}main{max-width:920px;margin:auto;padding:48px 20px 80px}header{margin-bottom:28px}h1{font-size:34px;margin:0 0 8px}.brand{color:var(--accent)}.sub{color:var(--muted)}.steps{display:flex;gap:8px;margin:24px 0}.step{height:5px;flex:1;background:var(--line);border-radius:8px}.step.active{background:var(--accent)}section{display:none;background:rgba(21,27,38,.94);border:1px solid var(--line);border-radius:18px;padding:26px;box-shadow:0 16px 50px #0005}section.active{display:block}h2{margin-top:0}h3{margin:24px 0 10px}label{display:block;margin:13px 0 5px;color:#cbd5e5}input,select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:#0e141e;color:var(--text)}input:focus{outline:2px solid #e58aa355;border-color:var(--accent)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.actions{display:flex;justify-content:space-between;gap:12px;margin-top:26px}button{border:0;border-radius:9px;padding:11px 18px;font-weight:650;cursor:pointer;background:var(--accent);color:#22141a}button.secondary{background:#293244;color:var(--text)}button:disabled{opacity:.45;cursor:not-allowed}.result{white-space:pre-wrap;background:#0e141e;border:1px solid var(--line);border-radius:9px;padding:12px;margin-top:14px;color:var(--muted);min-height:48px}.ok{color:var(--ok)}.bad{color:var(--bad)}.notice{padding:12px 14px;border-left:3px solid var(--accent);background:#251d29;border-radius:5px}.check{display:flex;gap:9px;align-items:center;margin:14px 0}.check input{width:auto}.hidden{display:none}@media(max-width:650px){.grid{grid-template-columns:1fr}main{padding-top:28px}section{padding:20px}}
  </style>
</head>
<body><main>
  <header><h1><span class="brand">Sakura</span>-MCP-Server</h1><div class="sub">多用户 AI 长期记忆平台 · 首次安装向导</div></header>
  <div class="steps" id="steps"></div>
  <section data-step="0" class="active"><h2>欢迎</h2><p>向导会自动检查数据库，并按服务器的 AUTH 设置决定是否配置 Authentik；之后可连接 OpenAI-compatible 或 Ollama。数据库地址和配置加密密钥必须预先写入服务器配置。</p><div class="notice">当前是未安装状态，任何能访问此页面的人都可以发起首次安装。AUTH=false 会关闭管理后台和 MCP 身份验证，只能用于已限制访问的私有网络。</div><div class="actions"><span></span><button id="diagnoseButton" type="button">重新检查环境</button></div><div id="diag" class="result">正在加载页面脚本并检查环境……</div></section>
  <section data-step="1"><h2>Authentik 身份认证</h2><div class="notice">先填写 Authentik 根地址和应用标识，向导会从标准 OpenID 配置自动回填端点。受众和客户端 ID 仍需按照 Authentik 提供方配置填写。</div><div class="grid"><div><label>Authentik 地址</label><input id="authBaseUrl" type="url" placeholder="例如：https://login.example.com"></div><div><label>应用名称（应用 Slug）</label><input id="authApplicationSlug" placeholder="例如：sakura-mcp"></div></div><div class="actions"><span></span><button id="discoverAuthentikButton" class="secondary" type="button">获取 OpenID 配置</button></div><div id="discoveryResult" class="result">填写地址和应用名称后自动获取。</div><div class="grid"><div><label>签发者地址（Issuer）</label><input id="issuer" placeholder="通过 OpenID 配置自动回填"></div><div><label>令牌受众（Audience）</label><input id="audience" placeholder="例如：https://mcp.example.com"></div></div><label>客户端 ID（公共客户端 + PKCE）</label><input id="clientId" placeholder="填写 Authentik OAuth 客户端 ID"><label>签名密钥地址（JWKS URI）</label><input id="jwksUri" placeholder="通过 OpenID 配置自动回填"><div class="grid"><div><label>授权地址</label><input id="authorizationUrl" placeholder="通过 OpenID 配置自动回填"></div><div><label>令牌地址</label><input id="tokenUrl" placeholder="通过 OpenID 配置自动回填"></div></div><label>用户信息地址（可选）</label><input id="userinfoUrl" placeholder="通过 OpenID 配置自动回填"><label>权限范围字段（Scope Claim）</label><input id="scopeClaim" value="scope"><label>首位系统管理员邮箱</label><input id="adminEmail" type="email" placeholder="例如：admin@example.com"><div class="actions"><button id="authBackButton" class="secondary" type="button">上一步</button><button id="authTestButton" type="button">测试并继续</button></div><div id="authResult" class="result">尚未测试。</div></section>
  <section data-step="2"><h2>AI 模型服务</h2><label>Provider</label><select id="provider"><option value="none">暂不配置</option><option value="openai">OpenAI-compatible</option><option value="ollama">Ollama</option></select><div id="providerFields" class="hidden"><label>Base URL</label><input id="providerBase"><div id="apiKeyRow"><label>API Key</label><input id="providerKey" type="password" autocomplete="off"></div><div class="grid"><div><label>Chat Model</label><input id="chatModel"></div><div><label>Embedding Model</label><input id="embeddingModel"></div></div></div><div class="actions"><button id="providerBackButton" class="secondary" type="button">上一步</button><button id="providerContinueButton" type="button">测试并继续</button></div><div id="providerResult" class="result">可跳过，之后在管理后台配置。</div></section>
  <section data-step="3"><h2>确认安装</h2><p>将写入认证模式及可选模型配置，并永久锁定安装入口。</p><div id="summary" class="result"></div><label class="check"><input id="confirm" type="checkbox">我已保存服务器的 CONFIG_ENCRYPTION_KEY，并确认开始安装</label><div class="actions"><button id="installBackButton" class="secondary" type="button">上一步</button><button id="installButton" type="button">完成安装</button></div><div id="completeResult" class="result">等待确认。</div></section>
  <section data-step="4"><h2 class="ok">安装完成</h2><p>Sakura-MCP-Server 已锁定安装向导。现在可以进入管理后台，并将 Agent 连接到 MCP URL。</p><div class="result" id="finalUrls"></div></section>
</main><script src="/assets/setup.js" defer></script></body></html>`;

export const setupScript = String.raw`'use strict';
let current=0;
let authEnabled=true;
let discoveryTimer;
let lastDiscoveryKey='';
let discoveryRequestId=0;
const total=5;
const $=id=>document.getElementById(id);
function message(error){return error instanceof Error?error.message:String(error)}
function renderSteps(){$('steps').innerHTML=Array.from({length:total},(_,i)=>'<div class="step '+(i<=current?'active':'')+'"></div>').join('');document.querySelectorAll('section').forEach(s=>s.classList.toggle('active',Number(s.dataset.step)===current))}
function go(step){current=step;renderSteps();if(step===3)buildSummary()}
async function api(path,body){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('/api/setup/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
    if(!response.ok)throw new Error('HTTP '+response.status+'：'+(data.error_description||data.error||raw.slice(0,500)||'安装接口返回了空错误响应'));
    return data;
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')throw new Error('请求超过 15 秒，请检查 Nginx 是否代理到 127.0.0.1:3001。');
    if(error instanceof TypeError)throw new Error('无法连接安装接口，请检查浏览器 Console、HTTPS 和反向代理配置。');
    throw error;
  }finally{clearTimeout(timeout)}
}
function authData(){return{issuer:$('issuer').value,audience:$('audience').value,jwksUri:$('jwksUri').value,scopeClaim:$('scopeClaim').value,clientId:$('clientId').value,authorizationUrl:$('authorizationUrl').value,tokenUrl:$('tokenUrl').value,userinfoUrl:$('userinfoUrl').value||undefined}}
function providerData(){const provider=$('provider').value;if(provider==='none')return{};const data={baseUrl:$('providerBase').value,chatModel:$('chatModel').value||undefined,embeddingModel:$('embeddingModel').value||undefined};return provider==='openai'?{openaiCompatible:{...data,apiKey:$('providerKey').value||undefined}}:{ollama:data}}
function scheduleAuthentikDiscovery(){clearTimeout(discoveryTimer);discoveryRequestId+=1;$('discoverAuthentikButton').disabled=false;const baseUrl=$('authBaseUrl').value.trim(),applicationSlug=$('authApplicationSlug').value.trim();if(!baseUrl||!applicationSlug)return;discoveryTimer=setTimeout(()=>void discoverAuthentik(false),600)}
async function discoverAuthentik(manual){const baseUrl=$('authBaseUrl').value.trim(),applicationSlug=$('authApplicationSlug').value.trim();if(!baseUrl||!applicationSlug){$('discoveryResult').className='result bad';$('discoveryResult').textContent='请填写 Authentik 地址和应用名称。';return}const key=baseUrl+'|'+applicationSlug;if(!manual&&key===lastDiscoveryKey)return;const requestId=++discoveryRequestId;const button=$('discoverAuthentikButton');button.disabled=true;$('discoveryResult').className='result';$('discoveryResult').textContent='正在获取 OpenID Configuration……';try{const data=await api('discover-authentik',{baseUrl,applicationSlug});if(requestId!==discoveryRequestId)return;$('issuer').value=data.issuer;$('jwksUri').value=data.jwksUri;$('authorizationUrl').value=data.authorizationUrl;$('tokenUrl').value=data.tokenUrl;$('userinfoUrl').value=data.userinfoUrl||'';lastDiscoveryKey=key;$('discoveryResult').className='result ok';$('discoveryResult').textContent='✓ 已从 '+data.discoveryUrl+' 获取并回填配置'}catch(error){if(requestId!==discoveryRequestId)return;$('discoveryResult').className='result bad';$('discoveryResult').textContent='✗ '+message(error)}finally{if(requestId===discoveryRequestId)button.disabled=false}}
async function diagnose(){
  const button=$('diagnoseButton');button.disabled=true;$('diag').className='result';$('diag').textContent='检查中，请稍候……';
  try{const data=await api('diagnostics');if(!data.pgvectorVersion)throw new Error('pgvector 扩展未安装');authEnabled=data.authEnabled!==false;$('diag').className='result ok';$('diag').textContent='✓ PostgreSQL 正常\n✓ pgvector '+data.pgvectorVersion+'\n✓ 认证：'+(authEnabled?'Authentik':'已禁用（AUTH=false）')+'\n✓ 已应用迁移：'+data.migrations.map(item=>item.name).join(', ');go(authEnabled?1:2)}
  catch(error){$('diag').className='result bad';$('diag').textContent='✗ '+message(error)}finally{button.disabled=false}
}
async function testAuthentik(){const button=$('authTestButton');button.disabled=true;try{const data=await api('test-authentik',{authentik:authData()});$('authResult').className='result ok';$('authResult').textContent='✓ Authentik 连接成功\n签名密钥：'+data.signingKeys;go(2)}catch(error){$('authResult').className='result bad';$('authResult').textContent='✗ '+message(error)}finally{button.disabled=false}}
function providerChanged(){const provider=$('provider').value;$('providerFields').classList.toggle('hidden',provider==='none');$('apiKeyRow').classList.toggle('hidden',provider!=='openai');$('providerBase').value=provider==='ollama'?'http://host.docker.internal:11434':provider==='openai'?'https://api.openai.com/v1':''}
async function testProviderAndContinue(){if($('provider').value==='none'){go(3);return}const button=$('providerContinueButton');button.disabled=true;try{const data=await api('test-provider',providerData());$('providerResult').className='result ok';$('providerResult').textContent='✓ '+data.provider+' 连接成功';go(3)}catch(error){$('providerResult').className='result bad';$('providerResult').textContent='✗ '+message(error)}finally{button.disabled=false}}
function buildSummary(){$('summary').textContent='认证：'+(authEnabled?'Authentik（'+$('issuer').value+'）':'已禁用（单用户本地管理员）')+'\n管理员：'+(authEnabled?$('adminEmail').value:'Local Administrator')+'\nAI Provider：'+$('provider').value}
async function completeSetup(){if(!$('confirm').checked){$('completeResult').className='result bad';$('completeResult').textContent='请先确认配置加密密钥已安全保存。';return}const button=$('installButton');button.disabled=true;try{const auth=authEnabled?{administratorEmail:$('adminEmail').value,authentik:authData()}:{};await api('complete',{...auth,...providerData()});$('completeResult').className='result ok';$('completeResult').textContent='✓ 安装成功';$('finalUrls').textContent='管理后台：'+location.origin+'/admin\nMCP URL：'+location.origin+'\n兼容地址：'+location.origin+'/mcp\n健康检查：'+location.origin+'/health';go(4)}catch(error){button.disabled=false;$('completeResult').className='result bad';$('completeResult').textContent='✗ '+message(error)}}

$('diagnoseButton').addEventListener('click',diagnose);
$('authBackButton').addEventListener('click',()=>go(0));
$('authBaseUrl').addEventListener('input',scheduleAuthentikDiscovery);
$('authApplicationSlug').addEventListener('input',scheduleAuthentikDiscovery);
$('discoverAuthentikButton').addEventListener('click',()=>{clearTimeout(discoveryTimer);void discoverAuthentik(true)});
$('authTestButton').addEventListener('click',testAuthentik);
$('provider').addEventListener('change',providerChanged);
$('providerBackButton').addEventListener('click',()=>go(authEnabled?1:0));
$('providerContinueButton').addEventListener('click',testProviderAndContinue);
$('installBackButton').addEventListener('click',()=>go(2));
$('installButton').addEventListener('click',completeSetup);
renderSteps();
fetch('/api/setup/status').then(async response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json()}).then(status=>{if(status.completed){current=4;$('finalUrls').textContent='系统已经完成安装。\nMCP URL：'+location.origin+'\n兼容地址：'+location.origin+'/mcp';renderSteps()}else{void diagnose()}}).catch(error=>{$('diag').className='result bad';$('diag').textContent='安装状态接口不可用：'+message(error)+'。请检查 Nginx 代理。'});
`;