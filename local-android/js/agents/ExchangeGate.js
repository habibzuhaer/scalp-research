/* ExchangeGate — общий backoff при HTTP 418/429 (Binance) */
(function (global) {
  'use strict'

  var banUntil = 0
  var chain = Promise.resolve()
  var gapMs = 400

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms)
    })
  }

  function banned() {
    return Date.now() < banUntil
  }

  function banLeftMs() {
    return Math.max(0, banUntil - Date.now())
  }

  function markBan(ms, reason) {
    banUntil = Math.max(banUntil, Date.now() + (ms || 90000))
    try {
      console.warn('[ExchangeGate]', reason || 'rate limit', 'pause', Math.ceil(banLeftMs() / 1000) + 's')
    } catch (e) {}
  }

  function noteStatus(status) {
    if (status === 418) markBan(90000, 'HTTP 418')
    else if (status === 429) markBan(45000, 'HTTP 429')
  }

  function noteErrorMessage(msg) {
    var s = String(msg || '')
    if (/\b418\b/.test(s)) markBan(90000, '418 in message')
    else if (/\b429\b/.test(s)) markBan(45000, '429 in message')
  }

  function enqueue(fn) {
    chain = chain
      .then(async function () {
        var wait = banLeftMs()
        if (wait) await sleep(wait)
        await sleep(gapMs)
        return fn()
      })
      .catch(function () {})
    return chain
  }

  /** fetch JSON: direct first, optional /ex proxy; respects global ban */
  async function fetchJson(url, opts) {
    opts = opts || {}
    var useProxy = opts.proxy !== false
    return enqueue(async function () {
      if (banned()) {
        throw new Error('HTTP 418 · пауза Binance ещё ' + Math.ceil(banLeftMs() / 1000) + 'с')
      }

      try {
        var res = await fetch(url)
        noteStatus(res.status)
        if (!res.ok) {
          var t = await res.text()
          throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 60) : ''))
        }
        return await res.json()
      } catch (directErr) {
        noteErrorMessage(directErr && directErr.message)
        if (!useProxy || /\b418\b|\b429\b/.test(String(directErr && directErr.message))) {
          throw directErr
        }
      }

      var pres = await fetch('/ex/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, method: 'GET', headers: {}, body: null }),
      })
      var ptext = await pres.text()
      var pdata = null
      try {
        pdata = JSON.parse(ptext)
      } catch (e) {
        pdata = null
      }
      noteStatus(pres.status)
      if (pres.status === 404) throw new Error('proxy unavailable')
      if (!pres.ok) {
        throw new Error((pdata && (pdata.msg || pdata.message)) || 'HTTP ' + pres.status)
      }
      return pdata
    })
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.ExchangeGate = {
    banned: banned,
    banLeftMs: banLeftMs,
    markBan: markBan,
    noteStatus: noteStatus,
    noteErrorMessage: noteErrorMessage,
    enqueue: enqueue,
    fetchJson: fetchJson,
  }
})(typeof window !== 'undefined' ? window : globalThis)
