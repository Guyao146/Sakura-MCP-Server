/**
 * Static HTML for the local config panel. No server data is templated in; the
 * page reads the panel token from its own query string and fetches state via
 * the loopback API. Secrets are written with textContent / input values only.
 */
export const panelHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sakura Cline Sync</title><style>
:root{color-scheme:dark;--bg:#0b0f16;--panel:#151b26;--line:#293244;--text:#edf2fa;--muted:#96a3b7;--accent:#e58aa3;--ok:#67d6a3;--bad:#ff7b86}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,sans-serif;padding:24px}
main{max-width:560px;margin:0 auto}h1{font-size:20px}h1 b{color:var(--accent)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:16px}
label{display:block;margin:12px 0 4px;color:var(--muted);font-size:13px}
input{width:100%;background:#101621;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px}
.row{display:flex;gap:12px}.row>div{flex:1}
.check{display:flex;align-items:center;gap:8px;margin-top:14px}.check input{width:auto}
button{border:0;border-radius:8px;padding:9px 16px;font-weight:650;cursor:pointer;background:var(--accent);color:#25141a;margin-top:16px}
button.secondary{background:#293244;color:var(--text)}button:disabled{opacity:.5}
.actions{display:flex;gap:10px}.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.status{font-size:13px}.status div{margin:3px 0}.list{margin-top:10px;font-size:12px}
.item{border-top:1px solid var(--line);padding:6px 0;display:flex;justify-content:space-between;gap:10px}
</style></head><body><main>
<h1><b>Sakura</b> Cline Sync</h1>
<div class="card">
  <label>MCP 地址</label><input id="mcpUrl" placeholder="https://mcp.example.com/mcp">
  <label>Agent 密钥（sk_sakura_…）</label><input id="token" placeholder="留空则保留已保存的密钥">
  <label>Cline 任务目录（留空自动检测）</label><input id="clineTasksDir">
  <div class="row">
    <div><label>扫描间隔（分钟）</label><input id="intervalMinutes" type="number" min="1" max="1440"></div>
    <div><label>忽略早于（天，0=不限）</label><input id="maxTaskAgeDays" type="number" min="0" max="3650"></div>
  </div>
  <div class="check"><input id="redactSecrets" type="checkbox"><label style="margin:0">上传前脱敏密钥/令牌</label></div>
  <div class="check"><input id="enabled" type="checkbox"><label style="margin:0">启用自动同步</label></div>
  <div class="actions">
    <button id="saveButton" onclick="save()">保存</button>
    <button class="secondary" onclick="test()">测试连接</button>
    <button class="secondary" onclick="syncNow()">立即同步</button>
  </div>
  <div id="msg" class="muted" style="margin-top:12px">加载中…</div>
</div>
<div class="card status">
  <h1 style="font-size:15px;margin:0 0 8px">状态</h1>
  <div>自动同步：<span id="stEnabled">-</span></div>
  <div>上次运行：<span id="stLast">-</span></div>
  <div>下次运行：<span id="stNext">-</span></div>
  <div>上次结果：<span id="stResult">-</span></div>
  <div class="list" id="stList"></div>
</div>
</main>
<script>
var token=new URLSearchParams(location.search).get('token')||'';
function $(id){return document.getElementById(id)}
function api(path,opt){opt=opt||{};opt.headers=Object.assign({'X-Panel-Token':token},opt.headers||{});if(opt.body)opt.headers['Content-Type']='application/json';return fetch(path,opt).then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})}
function setMsg(text,cls){var m=$('msg');m.textContent=text;m.className=cls||'muted'}
function render(state){var c=state.config;$('mcpUrl').value=c.mcpUrl||'';$('token').value='';$('token').placeholder=c.token?c.token:'sk_sakura_…';$('clineTasksDir').value=c.clineTasksDir||'';$('intervalMinutes').value=c.intervalMinutes;$('maxTaskAgeDays').value=c.maxTaskAgeDays;$('redactSecrets').checked=c.redactSecrets;$('enabled').checked=c.enabled;renderStatus(state.status)}
function renderStatus(s){$('stEnabled').textContent=s.enabled?'开启':'关闭';$('stLast').textContent=s.lastRunAt||'从未';$('stNext').textContent=s.nextRunAt||'-';$('stResult').textContent=s.lastResult||'-';var list=$('stList');list.innerHTML='';(s.recent||[]).forEach(function(o){var d=document.createElement('div');d.className='item';var a=document.createElement('span');a.textContent=o.taskId;var b=document.createElement('span');b.textContent=o.status+(o.newMessages?(' · '+o.newMessages+' 条'):'')+(o.reason?(' · '+o.reason):'');b.className=o.status==='synced'?'ok':o.status==='failed'?'bad':'muted';d.append(a,b);list.append(d)})}
function collect(){return{mcpUrl:$('mcpUrl').value,token:$('token').value,clineTasksDir:$('clineTasksDir').value,intervalMinutes:Number($('intervalMinutes').value),maxTaskAgeDays:Number($('maxTaskAgeDays').value),redactSecrets:$('redactSecrets').checked,enabled:$('enabled').checked}}
function load(){api('/api/state').then(function(r){if(r.ok){render(r.d);setMsg('就绪')}else setMsg(r.d.error||'加载失败','bad')})}
function save(){setMsg('保存中…');api('/api/config',{method:'POST',body:JSON.stringify(collect())}).then(function(r){if(r.ok){setMsg('已保存','ok');load()}else setMsg(r.d.error||'保存失败','bad')})}
function test(){setMsg('测试中…');api('/api/test',{method:'POST'}).then(function(r){setMsg(r.ok?'连接成功':(r.d.error||'连接失败'),r.ok?'ok':'bad')})}
function syncNow(){setMsg('同步中…');api('/api/sync',{method:'POST'}).then(function(r){if(r.ok){setMsg('已触发同步','ok');renderStatus(r.d.status)}else setMsg(r.d.error||'同步失败','bad')})}
load();setInterval(function(){api('/api/state').then(function(r){if(r.ok)renderStatus(r.d.status)})},5000);
</script>
</body></html>`;
