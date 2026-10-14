/* TradeAgent — лимит/маркет из стакана + SL/TP (Binance / Bybit), через /ex proxy */
(function (global) {
  'use strict'

  var PROXY = '/ex/forward'
  var RECV = '5000'
  var ALLOWED_HINT =
    'Ключи хранятся в localStorage. Для ордеров нужен python3 local/serve.py (прокси /ex).'

  function TradeAgent(bus, tickers, settings, symbols) {
    this.bus = bus
    this.tickers = tickers
    this.settings = settings
    this.symbols = symbols || null
    this._pending = null
    this._toastEl = null
    this._bind()
  }

  TradeAgent.prototype._bind = function () {
    var self = this
    this.bus.on('trade:place', function (payload) {
      self.place(payload)
    })
    this.bus.on('trade:test-keys', function (payload) {
      self.testKeys(payload && payload.pane)
    })
    this.bus.on('trade:toast', function (payload) {
      if (!payload) return
      self._toast(!!payload.ok, payload.message || '')
    })
  }

  TradeAgent.prototype._toast = function (ok, message) {
    if (!this._toastEl) {
      this._toastEl = document.createElement('div')
      this._toastEl.className = 'trade-toast'
      document.body.appendChild(this._toastEl)
    }
    var el = this._toastEl
    el.className = 'trade-toast ' + (ok ? 'ok' : 'err')
    el.textContent = message
    el.hidden = false
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(function () {
      el.hidden = true
    }, 4200)
  }

  TradeAgent.prototype._hmac = async function (secret, payload) {
    var enc = new TextEncoder()
    var key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    var sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return Array.from(new Uint8Array(sig))
      .map(function (b) {
        return b.toString(16).padStart(2, '0')
      })
      .join('')
  }

  TradeAgent.prototype._forward = async function (url, method, headers, body) {
    var res
    try {
      res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          method: method || 'GET',
          headers: headers || {},
          body: body == null ? null : body,
        }),
      })
    } catch (e) {
      throw new Error('Нет прокси /ex · запустите: python3 local/serve.py')
    }
    var text = await res.text()
    var data = null
    try {
      data = JSON.parse(text)
    } catch (e) {
      data = { raw: text }
    }
    if (res.status === 404 || (typeof text === 'string' && text.indexOf('Not Found') >= 0 && !data.orderId)) {
      if (!data || (!data.msg && !data.code && !data.retCode)) {
        throw new Error('Нет прокси /ex · запустите: python3 local/serve.py')
      }
    }
    if (!res.ok) {
      var err = new Error(
        (data && (data.msg || data.message || data.retMsg)) ||
          'HTTP ' + res.status + ': ' + text.slice(0, 160),
      )
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  TradeAgent.prototype._qty = function (paneCfg, price, meta) {
    var dom = this.settings.state
    var vols = dom.workVolumes || [0.001]
    var idx = Math.min(Math.max(0, dom.activeVolumeIndex || 0), vols.length - 1)
    var slot = Number(vols[idx])
    if (!(slot > 0)) throw new Error('Задайте рабочий объём (слоты)')
    var qty = slot
    if (dom.volumeUnit === 'usd') {
      if (!(price > 0)) throw new Error('Нет цены для $ → лоты')
      qty = slot / price
    }
    var step = meta && meta.stepSize > 0 ? meta.stepSize : 0
    if (!(step > 0)) {
      step = qty >= 1 ? 0.001 : qty >= 0.01 ? 0.0001 : 0.000001
    }
    var rounded = floorToStep(qty, step)
    if (!(rounded > 0)) throw new Error('Объём слишком мал для шага лота')
    if (meta && meta.minQty > 0 && rounded < meta.minQty) {
      throw new Error('Мин. объём ' + meta.minQty)
    }
    return formatStep(rounded, step)
  }

  TradeAgent.prototype._meta = function (paneCfg) {
    if (!this.symbols) return { tickSize: 0, stepSize: 0, minQty: 0 }
    return this.symbols.find(paneCfg.exchange, paneCfg.symbol)
  }

  /** SL/TP prices from entry; null if disabled */
  TradeAgent.prototype._stopLevels = function (side, entry, meta) {
    var dom = this.settings.state
    if (dom.attachSlTp === false) return { sl: null, tp: null, tp2: null }
    var slV = Number(dom.stopLoss) || 0
    var tpV = Number(dom.takeProfit) || 0
    var tp2V = Number(dom.takeProfit2) || 0
    if (!(entry > 0)) return { sl: null, tp: null, tp2: null }
    var tick = meta && meta.tickSize > 0 ? meta.tickSize : inferTick(entry)
    var buy = side === 'buy'
    function dist(v) {
      if (!(v > 0)) return 0
      if (dom.pnlMode === 'usdt') return v
      return (entry * v) / 100
    }
    function snap(px) {
      if (!(px > 0)) return null
      return formatStep(px, tick)
    }
    var sl = null
    var tp = null
    var tp2 = null
    if (slV > 0) sl = snap(buy ? entry - dist(slV) : entry + dist(slV))
    if (tpV > 0) tp = snap(buy ? entry + dist(tpV) : entry - dist(tpV))
    if (tp2V > 0) tp2 = snap(buy ? entry + dist(tp2V) : entry - dist(tp2V))
    return { sl: sl, tp: tp, tp2: tp2 }
  }

  TradeAgent.prototype.place = async function (payload) {
    var pane = payload && payload.pane
    if (pane !== 'spot' && pane !== 'futures') return
    var cfg = this.tickers.getPane(pane)
    if (cfg.viewOnly !== false) {
      return
    }
    if (!cfg.apiKey || !cfg.apiSecret) {
      this._toast(false, 'Укажите API Key / Secret · Тикеры → ' + pane.toUpperCase())
      this.bus.emit('ui:open-settings', { tab: 'tickers', pane: pane })
      return
    }

    var side = payload.side === 'sell' ? 'sell' : 'buy'
    var orderType = payload.type === 'MARKET' ? 'MARKET' : 'LIMIT'
    var price = Number(payload.price)
    if (orderType === 'LIMIT' && !(price > 0)) {
      this._toast(false, 'Нет цены для лимита')
      return
    }

    var dom = this.settings.state
    if (dom.tradeConfirm) {
      var key = pane + '|' + side + '|' + orderType + '|' + (price || 'mkt')
      var now = Date.now()
      if (!this._pending || this._pending.key !== key || now - this._pending.at > 2500) {
        this._pending = { key: key, at: now }
        this._toast(
          true,
          'Подтвердите: ещё раз ' +
            (side === 'buy' ? 'BUY' : 'SELL') +
            ' ' +
            orderType +
            (orderType === 'LIMIT' ? ' @ ' + price : ''),
        )
        return
      }
      this._pending = null
    }

    try {
      var meta = this._meta(cfg)
      var ref = price > 0 ? price : Number(payload.refPrice) || 0
      var qty = this._qty(cfg, ref, meta)
      var px =
        orderType === 'LIMIT'
          ? formatStep(price, meta.tickSize > 0 ? meta.tickSize : inferTick(price))
          : null
      var levels = this._stopLevels(side, Number(px) || ref, meta)
      this._toast(true, 'Отправка ' + side.toUpperCase() + ' ' + orderType + '…')
      var result = await this._sendOrder(cfg, {
        side: side,
        type: orderType,
        qty: qty,
        price: px,
        stopLoss: levels.sl,
        takeProfit: levels.tp,
      })
      var id =
        (result && (result.orderId || (result.result && result.result.orderId))) ||
        (result && result.result && result.result.orderLinkId) ||
        ''
      var extra = ''
      if (levels.sl || levels.tp) {
        extra =
          ' · SL ' +
          (levels.sl || '—') +
          ' / TP ' +
          (levels.tp || '—') +
          (levels.tp2 ? ' / TP2 ' + levels.tp2 : '')
      }
      // Follow-up protective orders when exchange doesn't attach on entry
      var protectNote = await this._placeProtective(cfg, {
        side: side,
        qty: qty,
        entry: Number(px) || ref,
        levels: levels,
        attachedOnEntry: !!(result && result._attachedStops),
      })
      if (protectNote) extra += protectNote
      this._toast(
        true,
        (side === 'buy' ? 'BUY' : 'SELL') +
          ' ' +
          orderType +
          ' ' +
          qty +
          (px ? ' @ ' + px : '') +
          (id ? ' · #' + id : ' · OK') +
          extra,
      )
      this.bus.emit('trade:result', { ok: true, pane: pane, result: result })
    } catch (e) {
      this._toast(false, e.message || 'Ошибка ордера')
      this.bus.emit('trade:result', { ok: false, pane: pane, error: e.message })
    }
  }

  TradeAgent.prototype._sendOrder = async function (cfg, o) {
    var ex = cfg.exchange
    if (ex === 'binance' || ex === 'binance-futures') {
      return this._binanceOrder(cfg, o)
    }
    if (ex === 'bybit' || ex === 'bybit-futures') {
      return this._bybitOrder(cfg, o)
    }
    throw new Error('Биржа не поддерживает торговлю: ' + ex)
  }

  TradeAgent.prototype._binanceOrder = async function (cfg, o) {
    var futures = cfg.exchange === 'binance-futures' || cfg.market === 'futures'
    var path = futures ? '/fapi/v1/order' : '/api/v3/order'
    var base = trim(cfg.restBaseUrl)
    var symbol = String(cfg.symbol || '').toUpperCase()
    var params = {
      symbol: symbol,
      side: o.side === 'buy' ? 'BUY' : 'SELL',
      type: o.type,
      quantity: o.qty,
      timestamp: Date.now(),
      recvWindow: RECV,
    }
    if (o.type === 'LIMIT') {
      params.timeInForce = 'GTC'
      params.price = o.price
    }
    var query = encodeParams(params)
    var signature = await this._hmac(cfg.apiSecret, query)
    var url = base + path + '?' + query + '&signature=' + signature
    var data = await this._forward(url, 'POST', { 'X-MBX-APIKEY': cfg.apiKey }, null)
    if (data && data.code && Number(data.code) < 0) {
      throw new Error(data.msg || 'Binance code ' + data.code)
    }
    data._attachedStops = false
    return data
  }

  TradeAgent.prototype._bybitOrder = async function (cfg, o) {
    var linear = cfg.exchange === 'bybit-futures' || cfg.market === 'futures'
    var base = trim(cfg.restBaseUrl)
    var bodyObj = {
      category: linear ? 'linear' : 'spot',
      symbol: String(cfg.symbol || '').toUpperCase(),
      side: o.side === 'buy' ? 'Buy' : 'Sell',
      orderType: o.type === 'MARKET' ? 'Market' : 'Limit',
      qty: o.qty,
    }
    if (o.type === 'LIMIT') {
      bodyObj.price = o.price
      bodyObj.timeInForce = 'GTC'
    }
    if (o.stopLoss) {
      bodyObj.stopLoss = String(o.stopLoss)
      bodyObj.slTriggerBy = 'LastPrice'
    }
    if (o.takeProfit) {
      bodyObj.takeProfit = String(o.takeProfit)
      bodyObj.tpTriggerBy = 'LastPrice'
    }
    if (o.stopLoss || o.takeProfit) {
      bodyObj.tpslMode = 'Full'
    }
    var body = JSON.stringify(bodyObj)
    var ts = String(Date.now())
    var prehash = ts + cfg.apiKey + RECV + body
    var sign = await this._hmac(cfg.apiSecret, prehash)
    var data = await this._forward(
      base + '/v5/order/create',
      'POST',
      {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': cfg.apiKey,
        'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': RECV,
      },
      body,
    )
    if (data && data.retCode != null && Number(data.retCode) !== 0) {
      throw new Error(data.retMsg || 'Bybit retCode ' + data.retCode)
    }
    data._attachedStops = !!(o.stopLoss || o.takeProfit)
    return data
  }

  TradeAgent.prototype._placeProtective = async function (cfg, opts) {
    var levels = opts.levels || {}
    if (!levels.sl && !levels.tp && !levels.tp2) return ''
    var ex = cfg.exchange
    var notes = []
    try {
      if (ex === 'bybit' || ex === 'bybit-futures') {
        if (opts.attachedOnEntry && !levels.tp2) return ''
        if (levels.tp2) {
          await this._bybitReduceLimit(cfg, opts.side, levels.tp2, halfQty(opts.qty))
          notes.push('TP2 ok')
        }
        return notes.length ? ' · ' + notes.join(', ') : ''
      }
      if (ex === 'binance-futures' || (ex === 'binance' && cfg.market === 'futures')) {
        if (levels.sl) {
          await this._binanceStop(cfg, {
            side: opts.side === 'buy' ? 'sell' : 'buy',
            type: 'STOP_MARKET',
            stopPrice: levels.sl,
            qty: opts.qty,
          })
          notes.push('SL ok')
        }
        if (levels.tp) {
          var tpQty = levels.tp2 ? halfQty(opts.qty) : opts.qty
          await this._binanceStop(cfg, {
            side: opts.side === 'buy' ? 'sell' : 'buy',
            type: 'TAKE_PROFIT_MARKET',
            stopPrice: levels.tp,
            qty: tpQty,
          })
          notes.push('TP ok')
        }
        if (levels.tp2) {
          await this._binanceStop(cfg, {
            side: opts.side === 'buy' ? 'sell' : 'buy',
            type: 'TAKE_PROFIT_MARKET',
            stopPrice: levels.tp2,
            qty: halfQty(opts.qty),
          })
          notes.push('TP2 ok')
        }
        return notes.length ? ' · ' + notes.join(', ') : ''
      }
      if (ex === 'binance') {
        // Spot: STOP_LOSS_LIMIT / TAKE_PROFIT_LIMIT
        var tick = inferTick(opts.entry)
        if (levels.sl) {
          var slLimit =
            opts.side === 'buy'
              ? formatStep(Number(levels.sl) * 0.999, tick)
              : formatStep(Number(levels.sl) * 1.001, tick)
          await this._binanceSpotStop(cfg, {
            side: opts.side === 'buy' ? 'sell' : 'buy',
            type: 'STOP_LOSS_LIMIT',
            stopPrice: levels.sl,
            price: slLimit,
            qty: opts.qty,
          })
          notes.push('SL ok')
        }
        if (levels.tp) {
          var tpLimit =
            opts.side === 'buy'
              ? formatStep(Number(levels.tp) * 0.999, tick)
              : formatStep(Number(levels.tp) * 1.001, tick)
          await this._binanceSpotStop(cfg, {
            side: opts.side === 'buy' ? 'sell' : 'buy',
            type: 'TAKE_PROFIT_LIMIT',
            stopPrice: levels.tp,
            price: tpLimit,
            qty: levels.tp2 ? halfQty(opts.qty) : opts.qty,
          })
          notes.push('TP ok')
        }
        if (levels.tp2) {
          var tp2Limit =
            opts.side === 'buy'
              ? formatStep(Number(levels.tp2) * 0.999, tick)
              : formatStep(Number(levels.tp2) * 1.001, tick)
          await this._binanceSpotStop(cfg, {
            side: opts.side === 'buy' ? 'sell' : 'buy',
            type: 'TAKE_PROFIT_LIMIT',
            stopPrice: levels.tp2,
            price: tp2Limit,
            qty: halfQty(opts.qty),
          })
          notes.push('TP2 ok')
        }
        return notes.length ? ' · ' + notes.join(', ') : ''
      }
    } catch (e) {
      return ' · protect: ' + (e.message || 'ошибка')
    }
    return ''
  }

  TradeAgent.prototype._binanceStop = async function (cfg, o) {
    var base = trim(cfg.restBaseUrl)
    var params = {
      symbol: String(cfg.symbol || '').toUpperCase(),
      side: o.side === 'buy' ? 'BUY' : 'SELL',
      type: o.type,
      stopPrice: o.stopPrice,
      quantity: o.qty,
      reduceOnly: 'true',
      workingType: 'CONTRACT_PRICE',
      timestamp: Date.now(),
      recvWindow: RECV,
    }
    var query = encodeParams(params)
    var signature = await this._hmac(cfg.apiSecret, query)
    var data = await this._forward(
      base + '/fapi/v1/order?' + query + '&signature=' + signature,
      'POST',
      { 'X-MBX-APIKEY': cfg.apiKey },
      null,
    )
    if (data && data.code && Number(data.code) < 0) {
      throw new Error(data.msg || 'Binance protect ' + data.code)
    }
    return data
  }

  TradeAgent.prototype._binanceSpotStop = async function (cfg, o) {
    var base = trim(cfg.restBaseUrl)
    var params = {
      symbol: String(cfg.symbol || '').toUpperCase(),
      side: o.side === 'buy' ? 'BUY' : 'SELL',
      type: o.type,
      stopPrice: o.stopPrice,
      price: o.price,
      quantity: o.qty,
      timeInForce: 'GTC',
      timestamp: Date.now(),
      recvWindow: RECV,
    }
    var query = encodeParams(params)
    var signature = await this._hmac(cfg.apiSecret, query)
    var data = await this._forward(
      base + '/api/v3/order?' + query + '&signature=' + signature,
      'POST',
      { 'X-MBX-APIKEY': cfg.apiKey },
      null,
    )
    if (data && data.code && Number(data.code) < 0) {
      throw new Error(data.msg || 'Binance spot protect ' + data.code)
    }
    return data
  }

  TradeAgent.prototype._bybitReduceLimit = async function (cfg, entrySide, price, qty) {
    var linear = cfg.exchange === 'bybit-futures' || cfg.market === 'futures'
    var base = trim(cfg.restBaseUrl)
    var bodyObj = {
      category: linear ? 'linear' : 'spot',
      symbol: String(cfg.symbol || '').toUpperCase(),
      side: entrySide === 'buy' ? 'Sell' : 'Buy',
      orderType: 'Limit',
      qty: qty,
      price: String(price),
      timeInForce: 'GTC',
      reduceOnly: true,
    }
    var body = JSON.stringify(bodyObj)
    var ts = String(Date.now())
    var prehash = ts + cfg.apiKey + RECV + body
    var sign = await this._hmac(cfg.apiSecret, prehash)
    var data = await this._forward(
      base + '/v5/order/create',
      'POST',
      {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': cfg.apiKey,
        'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': RECV,
      },
      body,
    )
    if (data && data.retCode != null && Number(data.retCode) !== 0) {
      throw new Error(data.retMsg || 'Bybit TP2 ' + data.retCode)
    }
    return data
  }

  TradeAgent.prototype.testKeys = async function (pane) {
    pane = pane || 'spot'
    var cfg = this.tickers.getPane(pane)
    if (!cfg.apiKey || !cfg.apiSecret) {
      this._toast(false, 'Укажите API Key и Secret')
      return
    }
    try {
      if (cfg.exchange === 'binance' || cfg.exchange === 'binance-futures') {
        var futures = cfg.exchange === 'binance-futures'
        var path = futures ? '/fapi/v2/account' : '/api/v3/account'
        var query = 'timestamp=' + Date.now() + '&recvWindow=' + RECV
        var signature = await this._hmac(cfg.apiSecret, query)
        var url = trim(cfg.restBaseUrl) + path + '?' + query + '&signature=' + signature
        await this._forward(url, 'GET', { 'X-MBX-APIKEY': cfg.apiKey }, null)
        this._toast(true, 'Ключи OK · ' + pane)
        return
      }
      if (cfg.exchange === 'bybit' || cfg.exchange === 'bybit-futures') {
        var ts = String(Date.now())
        var q = 'accountType=UNIFIED'
        var prehash = ts + cfg.apiKey + RECV + q
        var sign = await this._hmac(cfg.apiSecret, prehash)
        var data = await this._forward(
          trim(cfg.restBaseUrl) + '/v5/account/wallet-balance?' + q,
          'GET',
          {
            'X-BAPI-API-KEY': cfg.apiKey,
            'X-BAPI-SIGN': sign,
            'X-BAPI-TIMESTAMP': ts,
            'X-BAPI-RECV-WINDOW': RECV,
          },
          null,
        )
        if (data && Number(data.retCode) !== 0) throw new Error(data.retMsg || 'Bybit error')
        this._toast(true, 'Ключи OK · ' + pane)
        return
      }
      this._toast(false, 'Тест ключей не поддерживается для ' + cfg.exchange)
    } catch (e) {
      this._toast(false, e.message || 'Ошибка теста ключей')
    }
  }

  TradeAgent.prototype.start = function () {
    if (!global.Scalp._tradeHintShown) {
      global.Scalp._tradeHintShown = true
      console.info('[sCalp trade]', ALLOWED_HINT)
    }
  }

  function trim(url) {
    return String(url || '').replace(/\/+$/, '')
  }

  function encodeParams(obj) {
    return Object.keys(obj)
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])
      })
      .join('&')
  }

  function floorToStep(qty, step) {
    return Math.floor(qty / step + 1e-12) * step
  }

  function halfQty(qtyStr) {
    var n = Number(qtyStr)
    if (!(n > 0)) return qtyStr
    var half = n / 2
    var step = n >= 1 ? 0.001 : n >= 0.01 ? 0.0001 : 0.000001
    var rounded = floorToStep(half, step)
    if (!(rounded > 0)) rounded = half
    return formatStep(rounded, step)
  }

  function formatStep(n, step) {
    var decimals = 0
    if (step > 0 && step < 1) {
      var s = String(step)
      if (s.indexOf('e') >= 0) {
        var m = /e-(\d+)/i.exec(s)
        decimals = m ? Number(m[1]) : 8
      } else {
        decimals = (s.split('.')[1] || '').length
      }
    } else if (!(step > 0)) {
      decimals = 8
    }
    var fixed = Number(n).toFixed(Math.min(12, decimals))
    return fixed.replace(/\.?0+$/, '') || '0'
  }

  function inferTick(price) {
    if (!(price > 0)) return 0.01
    if (price >= 1000) return 0.1
    if (price >= 100) return 0.01
    if (price >= 1) return 0.001
    if (price >= 0.01) return 0.00001
    return 0.00000001
  }

  global.Scalp.TradeAgent = TradeAgent
})(typeof window !== 'undefined' ? window : globalThis)
