window.addEventListener("DOMContentLoaded",()=>{const t=document.createElement("script");t.src="https://www.googletagmanager.com/gtag/js?id=G-W5GKHM0893",t.async=!0,document.head.appendChild(t);const n=document.createElement("script");n.textContent="window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-W5GKHM0893');",document.body.appendChild(n)});/**
 * PakePlus 启动注入脚本：按本机 IPv4 第 4 段设置查询参数 machineId
 *
 * 说明：无法在仓库内模拟 PakePlus/WebView2；已在 machine-id-parse-selftest.mjs 中对解析逻辑做单元自测。
 *
 * PakePlus「主页」请填（正式环境，不要带调试参数）：
 *   http://10.110.1.225:3002/machine-desktop/?machineId=0
 * 需要看控制台日志时，再在末尾加上 &machineIdDebug=1 即可。
 *
 * 配置：开启「全局 TauriApi」。
 */

;(function () {
  'use strict'

  var HOST_HINT =
    typeof window !== 'undefined' && window.location && window.location.hostname
      ? window.location.hostname
      : ''

  var DEBUG =
    typeof window !== 'undefined' &&
    window.location &&
    /(?:\?|&)machineIdDebug=1(?:&|$)/.test(window.location.search)

  function log() {
    if (!DEBUG) return
    try {
      console.log.apply(console, ['[machineId]'].concat([].slice.call(arguments)))
    } catch (e) {}
  }

  /** 主页 hostname 为 IPv4 时，优先同一 /24（如 10.110.1.225 → 10.110.1.x） */
  function ipv4Prefix24(hostname) {
    if (!hostname || typeof hostname !== 'string') return null
    var m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
    if (!m) return null
    return m[1] + '.' + m[2] + '.' + m[3] + '.'
  }

  /** invoke 返回值可能是 string，也可能是 serde 序列化的 Result */
  function unwrapInvokePayload(raw) {
    if (raw == null) return null
    if (typeof raw === 'string') return raw
    if (typeof raw !== 'object') return null
    if (typeof raw.Ok === 'string') return raw.Ok
    if (typeof raw.ok === 'string') return raw.ok
    if (typeof raw.stdout === 'string') return raw.stdout
    if (typeof raw.output === 'string') return raw.output
    if (typeof raw.result === 'string') return raw.result
    return null
  }

  function fourthOctetFromIpConfigLines(text) {
    if (!text || typeof text !== 'string') return null
    var lines = text.split(/\r?\n/)
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (!/IPv4/i.test(line)) continue
      var m = line.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/)
      if (!m) continue
      var ip = m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4]
      if (ip.indexOf('127.') === 0) continue
      if (ip.indexOf('169.254.') === 0) continue
      var fourth = parseInt(m[4], 10)
      if (fourth >= 0 && fourth <= 255) return fourth
    }
    return null
  }

  function fourthOctetFromSingleIp(line) {
    if (!line || typeof line !== 'string') return null
    var t = line.trim().split(/\s+/)[0]
    var m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!m) return null
    var fourth = parseInt(m[4], 10)
    if (fourth >= 0 && fourth <= 255) return fourth
    return null
  }

  function fourthFromIpv4Scan(text, hostHint) {
    if (!text || typeof text !== 'string') return null
    var pref = ipv4Prefix24(hostHint)
    var re = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g
    var m
    var fallback = null
    while ((m = re.exec(text)) !== null) {
      var ip = m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4]
      if (ip.indexOf('127.') === 0) continue
      if (ip.indexOf('169.254.') === 0) continue
      var fourth = parseInt(m[4], 10)
      if (fourth < 0 || fourth > 255) continue
      if (pref && ip.indexOf(pref) === 0) return fourth
      if (fallback === null) fallback = fourth
    }
    return fallback
  }

  function fourthFromAnyOutput(text, hostHint) {
    if (!text || typeof text !== 'string') return null

    var single = fourthOctetFromSingleIp(text)
    if (single != null) return single

    if (ipv4Prefix24(hostHint)) {
      var byPref = fourthFromIpv4Scan(text, hostHint)
      if (byPref != null) return byPref
    }

    var byLines = fourthOctetFromIpConfigLines(text)
    if (byLines != null) return byLines

    return fourthFromIpv4Scan(text, '')
  }

  function waitForTauriInvoke(timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now()
      function tick() {
        try {
          var core = window.__TAURI__ && window.__TAURI__.core
          if (core && typeof core.invoke === 'function')
            return resolve(core.invoke.bind(core))
        } catch (e) {}
        if (Date.now() - start >= timeoutMs) return resolve(null)
        setTimeout(tick, 40)
      }
      tick()
    })
  }

  function childProcessStdoutToString(proc) {
    if (!proc || proc.stdout == null) return null
    var s = proc.stdout
    if (typeof s === 'string') return s
    try {
      if (typeof Uint8Array !== 'undefined' && s instanceof Uint8Array)
        return new TextDecoder().decode(s)
    } catch (e) {}
    return null
  }

  /** PowerShell：对象列表后再取 IPAddress，避免在数组上误用属性 */
  function windowsPsFirstIpv4Script() {
    return "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress"
  }

  function windowsRunCommands() {
    return [
      'ipconfig',
      'cmd.exe /c ipconfig',
      'powershell.exe -NoProfile -Command "' + windowsPsFirstIpv4Script() + '"',
    ]
  }

  function guessUnixRunCommands() {
    var ua = (navigator.userAgent || '').toLowerCase()
    if (ua.indexOf('mac os') !== -1)
      return ['sh -c "ipconfig getifaddr en0 || ipconfig getifaddr en1"']
    return ["sh -c \"hostname -I | awk '{print $1}'\""]
  }

  async function fourthViaShellExecute(invoke, hostHint) {
    var ua = (navigator.userAgent || '').toLowerCase()
    var payloads = []

    if (ua.indexOf('windows') !== -1) {
      payloads.push({
        program: 'cmd',
        args: ['/c', 'ipconfig'],
        options: {},
      })
      payloads.push({
        program: 'powershell.exe',
        args: ['-NoProfile', '-Command', windowsPsFirstIpv4Script()],
        options: {},
      })
    } else if (ua.indexOf('mac os') !== -1) {
      payloads.push({
        program: 'sh',
        args: ['-c', 'ipconfig getifaddr en0 || ipconfig getifaddr en1'],
        options: {},
      })
    } else {
      payloads.push({
        program: 'sh',
        args: ['-c', "hostname -I | awk '{print $1}'"],
        options: {},
      })
    }

    for (var i = 0; i < payloads.length; i++) {
      try {
        log('shell|execute', payloads[i].program)
        var out = await invoke('plugin:shell|execute', payloads[i])
        var text = childProcessStdoutToString(out)
        log('shell stdout chars', text ? text.length : 0)
        var fourth = fourthFromAnyOutput(text, hostHint)
        if (fourth != null) return fourth
      } catch (e) {
        log('shell|execute err', String(e && e.message ? e.message : e))
      }
    }
    return null
  }

  async function fourthViaRunCommand(invoke, hostHint) {
    var ua = (navigator.userAgent || '').toLowerCase()
    var cmds =
      ua.indexOf('windows') !== -1 ? windowsRunCommands() : guessUnixRunCommands()

    for (var i = 0; i < cmds.length; i++) {
      try {
        log('run_command', cmds[i].slice(0, 80))
        var raw = await invoke('run_command', { command: cmds[i] })
        var text = unwrapInvokePayload(raw)
        log('unwrap length', text ? text.length : 0, 'head', text ? text.slice(0, 120) : '')
        var fourth = fourthFromAnyOutput(text, hostHint)
        if (fourth != null) return fourth
      } catch (e) {
        log('run_command err', String(e && e.message ? e.message : e))
      }
    }
    return null
  }

  function fourthViaWebRTC(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false
      var pc = null
      function finish(val) {
        if (done) return
        done = true
        try {
          if (pc) pc.close()
        } catch (e) {}
        resolve(val)
      }
      try {
        pc = new RTCPeerConnection({ iceServers: [] })
        pc.createDataChannel('')
        pc.onicecandidate = function (e) {
          if (!e.candidate) return
          var c = e.candidate.candidate || ''
          var m = c.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
          if (!m) return
          var ip = m[1]
          if (ip.indexOf('127.') === 0) return
          if (ip.indexOf('0.0.0.0') === 0) return
          var fourth = fourthFromIpv4Scan(ip, HOST_HINT)
          if (fourth != null) finish(fourth)
        }
        pc.createOffer().then(function (o) {
          return pc.setLocalDescription(o)
        })
      } catch (e) {
        finish(null)
      }
      setTimeout(function () {
        finish(null)
      }, timeoutMs || 4500)
    })
  }

  async function resolveFourthOctet() {
    var invoke = await waitForTauriInvoke(DEBUG ? 20000 : 15000)
    log('invoke', !!invoke)

    if (!invoke) return fourthViaWebRTC(4500)

    var viaShell = await fourthViaShellExecute(invoke, HOST_HINT)
    log('fourth shell', viaShell)
    if (viaShell != null) return viaShell

    var viaCmd = await fourthViaRunCommand(invoke, HOST_HINT)
    log('fourth cmd', viaCmd)
    if (viaCmd != null) return viaCmd

    var viaRtc = await fourthViaWebRTC(4500)
    log('fourth rtc', viaRtc)
    return viaRtc
  }

  async function main() {
    var fourth = await resolveFourthOctet()
    if (fourth == null) {
      console.error(
        '[machineId] 解析失败：请开全局 TauriApi；调试时在主页 URL 加 &machineIdDebug=1'
      )
      return
    }

    var u
    try {
      u = new URL(window.location.href)
    } catch (e) {
      console.error('[machineId] URL 非法', e)
      return
    }

    var cur = u.searchParams.get('machineId')
    if (cur === String(fourth)) return

    u.searchParams.set('machineId', String(fourth))
    window.location.replace(u.toString())
  }

  main()
})()
