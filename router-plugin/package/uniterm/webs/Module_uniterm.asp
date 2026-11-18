<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="-1">
<title>软件中心 - uniTerm</title>
<link rel="icon" href="/images/favicon.png">
<link rel="stylesheet" href="/index_style.css">
<link rel="stylesheet" href="/form_style.css">
<link rel="stylesheet" href="/usp_style.css">
<link rel="stylesheet" href="/css/element.css">
<link rel="stylesheet" href="/device-map/device-map.css">
<link rel="stylesheet" href="/res/softcenter.css">
<script src="/js/jquery.js"></script>
<script src="/state.js"></script>
<script src="/popup.js"></script>
<script src="/validator.js"></script>
<script src="/general.js"></script>
<script src="/res/softcenter.js"></script>
<style>
/* Keep firmware colors, fonts and controls; only scope plugin layout here. */
.plugin-shell .plugin-main { vertical-align: top; }
.plugin-shell .plugin-nav { width: 202px; vertical-align: top; }
#app[data-plugin-page] .plugin-page { width: 760px; border: 0; }
#app[data-plugin-page] .plugin-page .plugin-body { padding: 16px 10px 20px; }
#app[data-plugin-page] .plugin-page .plugin-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 4px 5px 16px; }
#app[data-plugin-page] .plugin-page .formfonttitle { margin: 0; }
#app[data-plugin-page] .plugin-page .plugin-version { display: inline-block; margin-left: 8px; font-size: 12px; font-weight: normal; opacity: .8; }
#app[data-plugin-page] .plugin-page .plugin-return { display: inline-flex; flex: 0 0 auto; }
#app[data-plugin-page] .plugin-page .plugin-return img { width: 30px; border: 0; }
#app[data-plugin-page] .plugin-page .splitLine { width: 100%; margin: 10px 0; }
#app[data-plugin-page] .plugin-page .plugin-section { width: 100%; margin: 14px 0; table-layout: fixed; }
#app[data-plugin-page] .plugin-page .plugin-section th { width: 30%; }
#app[data-plugin-page] .plugin-page .plugin-section td { overflow-wrap: anywhere; }
#app[data-plugin-page] .plugin-page .plugin-help { margin: 5px 0; line-height: 1.7; opacity: .82; }
#app[data-plugin-page] .plugin-page .plugin-intro { margin: 8px 5px 14px; }
#app[data-plugin-page] .plugin-page .plugin-input { width: min(320px, 95%); max-width: 100%; box-sizing: border-box; }
#app[data-plugin-page] .plugin-page .plugin-input-wide { width: 95%; }
#app[data-plugin-page] .plugin-page select.plugin-input { height: 28px; }
#app[data-plugin-page] .plugin-page .plugin-switch { display: inline-block; position: relative; vertical-align: middle; }
#app[data-plugin-page] .plugin-page .plugin-switch input.switch { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; z-index: 1; cursor: pointer; }
#app[data-plugin-page] .plugin-page .plugin-switch input.switch:focus-visible + .switch_container { outline: 2px solid currentColor; outline-offset: 3px; }
#app[data-plugin-page] .plugin-page .plugin-switch-note { display: inline-block; margin-left: 12px; vertical-align: middle; }
#app[data-plugin-page] .plugin-page .plugin-status { margin: 0 0 8px; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
#app[data-plugin-page] .plugin-page .plugin-inline-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
#app[data-plugin-page] .plugin-page .ks_btn { display: inline-block; width: auto; min-width: 72px; white-space: nowrap; flex-shrink: 0; cursor: pointer; text-align: center; text-decoration: none; font-family: inherit; }
#app[data-plugin-page] .plugin-page .plugin-actions { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 10px; margin: 18px 0 10px; }
#app[data-plugin-page] .plugin-page button:disabled { opacity: .5; cursor: wait; }
#app[data-plugin-page] .plugin-page .plugin-message { min-height: 20px; margin: 8px 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
#app[data-plugin-page] .plugin-page .plugin-error { color: #ffb1b1; }
#app[data-plugin-page] .plugin-page .plugin-details { margin: 14px 0; }
#app[data-plugin-page] .plugin-page .plugin-details summary { cursor: pointer; padding: 8px 4px; font-weight: bold; }
#app[data-plugin-page] .plugin-page .plugin-log { box-sizing: border-box; width: 100%; margin: 8px 0; padding: 10px; border: 1px solid rgba(255,255,255,.2); background: rgba(0,0,0,.18); color: inherit; max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 monospace; }
.plugin-mobile-nav { display: none; }
@media (max-width: 767px) {
  #app[data-plugin-page] { min-width: 0; margin: 0; }
  #app[data-plugin-page] #TopBanner, #app[data-plugin-page] #footer { position: relative; width: 100%; max-width: 100vw; overflow-x: auto; }
  #app[data-plugin-page] .plugin-mobile-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; }
  #app[data-plugin-page] .plugin-shell { display: block; width: 100%; margin-top: 0 !important; padding-bottom: 12px; }
  #app[data-plugin-page] .plugin-nav #mainMenu > div, #app[data-plugin-page] .plugin-main > div, #app[data-plugin-page] #tabMenu { margin-top: 0 !important; }
  #app[data-plugin-page] .plugin-shell > tbody, #app[data-plugin-page] .plugin-shell > tbody > tr, #app[data-plugin-page] .plugin-main { display: block; width: 100%; }
  #app[data-plugin-page] .plugin-shell .plugin-spacer { display: none; }
  #app[data-plugin-page] .plugin-shell .plugin-nav { display: none; width: auto; padding: 8px 12px; }
  #app[data-plugin-page][data-nav-open="true"] .plugin-shell .plugin-nav { display: block; }
  #app[data-plugin-page] #tabMenu { max-width: 100%; overflow-x: auto; }
  #app[data-plugin-page] .plugin-page { width: 100%; max-width: 100%; height: auto !important; }
  #app[data-plugin-page] .plugin-page .plugin-section colgroup { display: none; }
  #app[data-plugin-page] .plugin-page .plugin-body { padding: 14px 12px 20px; }
  #app[data-plugin-page] .plugin-page .plugin-heading { margin: 4px 0 14px; }
  #app[data-plugin-page] .plugin-page .formfonttitle { line-height: 1.6; }
  #app[data-plugin-page] .plugin-page .plugin-section, #app[data-plugin-page] .plugin-page .plugin-section > tbody, #app[data-plugin-page] .plugin-page .plugin-section > thead, #app[data-plugin-page] .plugin-page .plugin-section tr, #app[data-plugin-page] .plugin-page .plugin-section th, #app[data-plugin-page] .plugin-page .plugin-section td { display: block; box-sizing: border-box; width: 100%; }
  #app[data-plugin-page] .plugin-page .plugin-section th { height: auto; min-height: 30px; padding: 8px 10px 4px; border-bottom: 0; }
  #app[data-plugin-page] .plugin-page .plugin-section td { padding: 6px 10px 10px; }
  #app[data-plugin-page] .plugin-page .plugin-section thead td { padding: 8px 10px; }
  #app[data-plugin-page] .plugin-page .plugin-input, #app[data-plugin-page] .plugin-page .plugin-input-wide { width: 100%; height: 34px; margin-left: 0; }
  #app[data-plugin-page] .plugin-page select.plugin-input { height: 34px; }
  #app[data-plugin-page] .plugin-page .plugin-actions { gap: 12px; }
}

#app[data-plugin-page] .plugin-page small.plugin-help { display: block; }
#app[data-plugin-page] .plugin-page textarea.plugin-input { height: 90px; min-height: 90px; resize: vertical; line-height: 1.6; padding: 5px; }

#app[data-plugin-page] .plugin-page [hidden] { display: none !important; }
</style>
</head>
<body id="app" skin='<% nvram_get("sc_skin"); %>' data-plugin-page>
<div id="TopBanner"></div>
<div id="Loading" class="popup_bg"></div>
<div class="plugin-mobile-nav">
  <button type="button" class="button_gen" id="plugin-menu-toggle" aria-controls="plugin-navigation" aria-expanded="false">路由器导航</button>
  <a href="/Module_Softcenter.asp">返回软件中心</a>
</div>
<table class="content plugin-shell" align="center" cellpadding="0" cellspacing="0">
  <tr>
    <td class="plugin-spacer" width="17"></td>
    <td class="plugin-nav" id="plugin-navigation" width="202" valign="top">
      <div id="mainMenu"></div>
      <div id="subMenu"></div>
    </td>
    <td class="plugin-main" valign="top">
      <div id="tabMenu" class="submenuBlock"></div>
      <table class="FormTitle plugin-page" id="FormTitle" width="760" border="0" cellpadding="5" cellspacing="0">
        <tr><td class="plugin-body" bgcolor="#4D595D" valign="top">
          <div class="plugin-heading">
            <div class="formfonttitle">软件中心 - uniTerm <span class="plugin-version" id="plugin-version">0.3.0-rc.14</span></div>
            <a class="plugin-return" href="/Module_Softcenter.asp" title="返回软件中心" aria-label="返回软件中心"><img src="/images/backprev.png" alt="返回软件中心"></a>
          </div>
          <div class="splitLine"></div>
          <p class="plugin-intro">Web 终端、文件传输与远程连接管理。服务仅监听 LAN 地址，需要单独登录 uniTerm 账号。</p>
          <table class="FormTable plugin-section" cellpadding="4" cellspacing="0" border="1">
            <colgroup><col style="width:30%"><col style="width:70%"></colgroup>
            <thead><tr><td colspan="2">运行状态</td></tr></thead>
            <tbody>
              <tr><th scope="row">服务状态</th><td><pre class="plugin-status" id="status" aria-live="polite">正在读取…</pre><button class="ks_btn" type="button" id="refresh">刷新状态</button></td></tr>
              <tr><th scope="row">访问入口</th><td><a class="ks_btn" id="open" href="#" target="_blank" rel="noopener noreferrer">打开 uniTerm</a><p class="plugin-help" id="access-address"></p></td></tr>
            </tbody>
          </table>
          <form id="settings">
            <table class="FormTable plugin-section" cellpadding="4" cellspacing="0" border="1">
            <colgroup><col style="width:30%"><col style="width:70%"></colgroup>
              <thead><tr><td colspan="2">基础设置</td></tr></thead>
              <tbody>
                <tr><th scope="row"><label for="enable">启用服务</label></th><td>
                  <label class="plugin-switch" for="enable"><input id="enable" class="switch" type="checkbox" aria-label="启用服务并开机启动"><div class="switch_container"><div class="switch_bar"></div><div class="switch_circle transition_style"><div></div></div></div></label>
                  <span class="plugin-switch-note">开机自动启动</span>
                </td></tr>
                <tr><th scope="row"><label for="port">访问端口</label></th><td><input class="input_ss_table plugin-input" id="port" type="number" min="1024" max="65535" value="18888" required><p class="plugin-help">可填写 1024–65535，默认 18888。</p></td></tr>
                <tr><th scope="row"><label for="tls">HTTPS 加密访问</label></th><td>
                  <label class="plugin-switch" for="tls"><input id="tls" class="switch" type="checkbox" aria-label="使用 HTTPS 加密访问"><div class="switch_container"><div class="switch_bar"></div><div class="switch_circle transition_style"><div></div></div></div></label>
                  <span class="plugin-switch-note">开启后此端口仅提供 HTTPS</span>
                </td></tr>
              </tbody>
            </table>
            <div id="tls-settings">
              <table class="FormTable plugin-section" cellpadding="4" cellspacing="0" border="1">
            <colgroup><col style="width:30%"><col style="width:70%"></colgroup>
                <thead><tr><td colspan="2">HTTPS 证书</td></tr></thead>
                <tbody><tr><th scope="row"><label for="tls_mode">证书方式</label></th><td><select class="input_option plugin-input plugin-input-wide" id="tls_mode"><option value="auto">自动生成自签名证书（IP 地址访问）</option><option value="custom">使用已有证书</option></select></td></tr></tbody>
                <tbody id="custom-cert">
                  <tr><th scope="row"><label for="tls_cert">证书文件路径</label></th><td><input class="input_ss_table plugin-input plugin-input-wide" id="tls_cert" type="text" placeholder="/koolshare/configs/uniterm/tls/server.crt"><p class="plugin-help">绝对路径，PEM 格式，可包含证书链。</p></td></tr>
                  <tr><th scope="row"><label for="tls_key">私钥文件路径</label></th><td><input class="input_ss_table plugin-input plugin-input-wide" id="tls_key" type="text" placeholder="/koolshare/configs/uniterm/tls/server.key"><p class="plugin-help">绝对路径，PEM 格式，私钥不能加密。</p></td></tr>
                </tbody>
              </table>
              <p class="plugin-help">自签名证书首次访问会出现浏览器提示，信任后可正常使用。自有域名证书请使用证书对应域名访问。</p>
            </div>
            <table class="FormTable plugin-section" cellpadding="4" cellspacing="0" border="1">
            <colgroup><col style="width:30%"><col style="width:70%"></colgroup>
              <thead><tr><td colspan="2">首次初始化</td></tr></thead>
              <tbody><tr><th scope="row"><label for="password">管理员密码</label></th><td><input class="input_ss_table plugin-input" id="password" type="password" autocomplete="new-password" placeholder="首次启动必填；已有账号则留空"><p class="plugin-help">账号：admin。首次密码为 6–24 字节，初始化后在 uniTerm 内管理账号和密码。密码不会显示在日志中。</p></td></tr></tbody>
            </table>
            <div class="apply_gen plugin-actions">
              <button class="button_gen" type="submit" disabled>保存并应用</button>
              <button class="ks_btn" type="button" id="restart" disabled>重启服务</button>
              <button class="ks_btn" type="button" id="stop" disabled>停用服务</button>
            </div>
            <p class="plugin-message" id="message" role="status" aria-live="polite"></p>
          </form>
          <div class="splitLine"></div>
          <details class="plugin-details" id="log-panel">
            <summary>运行日志</summary>
            <button class="ks_btn" type="button" id="logs">读取最近日志</button>
            <pre class="plugin-log" id="log">点击读取最近日志</pre>
          </details>
          <details class="plugin-details">
            <summary>使用说明</summary>
            <p class="plugin-help">数据保存在 /koolshare/configs/uniterm/data，卸载时保留。文件传输下载到路由器会占用存储，大文件请使用外接存储。</p>
            <p class="plugin-help">日志存放在 /tmp，每 5 分钟检查轮转。HTTP 局域网访问不提供链路加密，部分需要安全上下文的浏览器功能受限。</p>
            <p class="plugin-help">插件支持 Linux ARM64 KoolCenter 固件。<a href="https://github.com/yunwan1x/uniterm" target="_blank" rel="noopener noreferrer">项目源码</a></p>
          </details>
        </td></tr>
      </table>
    </td>
    <td class="plugin-spacer" width="10"></td>
  </tr>
</table>
<div id="footer"></div>
<script>
function menu_hook() {
  tabtitle[tabtitle.length - 1] = ['', 'uniTerm'];
  tablink[tablink.length - 1] = ['', 'Module_uniterm.asp'];
}
(function () {
  'use strict';
  var busy = false;
  var configReady = false;
  var statusPending = false;

  function call(action, fields) {
    return $.ajax({url: '/_api/', type: 'POST', contentType: 'application/json', dataType: 'json', timeout: 40000,
      data: JSON.stringify({id: Math.floor(Math.random() * 100000000), method: 'uniterm_config.sh', params: [action], fields: fields || {}})
    }).then(function (r) {
      if (typeof r.result === 'number') return '__PENDING__';
      if (typeof r.result !== 'string') throw Error('接口返回异常');
      return new TextDecoder().decode(Uint8Array.from(atob(r.result), function (c) { return c.charCodeAt(0); }));
    });
  }
  function complete(text, attempt) {
    if (text.trim() !== '__PENDING__') return $.Deferred().resolve(text).promise();
    if (attempt > 45) return $.Deferred().reject().promise();
    return $.Deferred(function (deferred) {
      setTimeout(function () {
        call('result').then(function (result) { return complete(result, attempt + 1); }).then(deferred.resolve, deferred.reject);
      }, 1000);
    }).promise();
  }
  function message(text, error) {
    $('#message').text(text).toggleClass('plugin-error', !!error);
  }
  function updateLink() {
    var port = Number($('#port').val());
    var address = port >= 1024 && port <= 65535 ? ($('#tls').prop('checked') ? 'https://' : 'http://') + location.hostname + ':' + port + '/' : '';
    $('#open').attr('href', address || '#').attr('aria-disabled', !address);
    $('#access-address').text(address);
  }
  function tlsFields() {
    $('#tls-settings').prop('hidden', !$('#tls').prop('checked'));
    $('#custom-cert').prop('hidden', $('#tls_mode').val() !== 'custom');
    updateLink();
  }
  function refreshStatus() {
    if (statusPending) return $.Deferred().resolve().promise();
    statusPending = true;
    return call('status').then(function (text) { $('#status').text(text); }).always(function () { statusPending = false; });
  }
  function run(action, fields) {
    if (busy || !configReady) return;
    busy = true;
    $('#FormTitle button').prop('disabled', true);
    $('#settings').attr('aria-busy', 'true');
    message('正在执行…');
    call(action, fields).then(function (text) { return complete(text, 0); }).then(function (text) {
      message(text, text.indexOf('操作失败') === 0);
      $('#password').val('');
      updateLink();
      return refreshStatus();
    }).fail(function () { message('操作未确认，请刷新状态查看。', true); }).always(function () {
      busy = false;
      $('#FormTitle button').prop('disabled', false);
      $('#settings').attr('aria-busy', 'false');
    });
  }
  $(function () {
    if (!$('#app').attr('skin')) $('#app').attr('skin', 'ASUSWRT');
    show_menu(menu_hook);
    $('#plugin-menu-toggle').on('click', function () {
      var open = $(this).attr('aria-expanded') !== 'true';
      $(this).attr('aria-expanded', String(open));
      $('#app').attr('data-nav-open', String(open));
    });
    $('.plugin-return img').on('mouseenter', function () { this.src = '/images/backprevclick.png'; }).on('mouseleave', function () { this.src = '/images/backprev.png'; });
    $('#settings').on('submit', function (event) {
      event.preventDefault();
      var fields = {
        uniterm_enable: $('#enable').prop('checked') ? '1' : '0', uniterm_port: String($('#port').val()),
        uniterm_tls: $('#tls').prop('checked') ? '1' : '0', uniterm_tls_mode: $('#tls_mode').val(),
        uniterm_tls_cert: $('#tls_cert').val(), uniterm_tls_key: $('#tls_key').val()
      };
      if ($('#password').val()) fields.uniterm_initial_password = $('#password').val();
      run('apply', fields);
    });
    $('#port').on('input', updateLink);
    $('#tls,#tls_mode').on('change', tlsFields);
    $('#open').on('click', function (event) { if ($(this).attr('href') === '#') event.preventDefault(); });
    $('#stop').on('click', function () { $('#enable').prop('checked', false); run('apply', {uniterm_enable: '0'}); });
    $('#restart').on('click', function () { run('restart'); });
    $('#refresh').on('click', function () { refreshStatus().fail(function () { message('读取状态失败', true); }); });
    $('#logs').on('click', function () { call('log').then(function (text) { $('#log').text(text); }).fail(function () { message('日志读取失败', true); }); });
    $.getJSON('/_api/uniterm_').then(function (r) {
      if (!r || !Array.isArray(r.result) || !r.result[0] || typeof r.result[0] !== 'object' || Array.isArray(r.result[0])) throw Error('配置接口返回异常');
      var config = r.result[0];
      $('#enable').prop('checked', config.uniterm_enable === '1');
      $('#port').val(config.uniterm_port || 18888);
      $('#tls').prop('checked', config.uniterm_tls === '1');
      $('#tls_mode').val(config.uniterm_tls_mode || 'auto');
      $('#tls_cert').val(config.uniterm_tls_cert || '');
      $('#tls_key').val(config.uniterm_tls_key || '');
      tlsFields();
      configReady = true;
      $('#settings button').prop('disabled', false);
      return refreshStatus();
    }).fail(function () { message(configReady ? '读取状态失败，请重试。' : '无法读取配置，请通过路由器管理页面登录后刷新。', true); });
    $.getJSON('/_api/softcenter_module_uniterm_').then(function (r) {
      var version = (r.result[0] || {}).softcenter_module_uniterm_version;
      if (version) $('#plugin-version').text(version);
    });
    setInterval(function () {
      if (configReady && !busy && !document.hidden) refreshStatus();
    }, 10000);
  });
}());
</script>
</body>
</html>
