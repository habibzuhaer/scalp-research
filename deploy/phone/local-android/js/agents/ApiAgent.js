/* ApiAgent — настройки API, пресеты, тест соединения */
(function (global) {
  'use strict'

  function ApiAgent(bus) {
    this.bus = bus
    this.state = global.Scalp.Config.load(
      global.Scalp.Config.KEYS.api,
      global.Scalp.Config.DEFAULT_API,
    )
    this._bind()
  }

  ApiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('api:get', function () {
      self.bus.emit('api:state', self.get())
    })
    this.bus.on('api:patch', function (partial) {
      self.patch(partial)
    })
    this.bus.on('api:reset', function () {
      self.reset()
    })
    this.bus.on('api:preset', function (payload) {
      self.applyPreset(payload.exchange, payload.testnet)
    })
    this.bus.on('api:test-public', function () {
      self.testPublic()
    })
    this.bus.on('api:test-signed', function () {
      self.testSigned()
    })
  }

  ApiAgent.prototype.get = function () {
    return Object.assign({}, this.state)
  }

  ApiAgent.prototype.patch = function (partial) {
    this.state = Object.assign({}, this.state, partial)
    global.Scalp.Config.save(global.Scalp.Config.KEYS.api, this.state)
    this.bus.emit('api:changed', this.get())
  }

  ApiAgent.prototype.reset = function () {
    this.state = Object.assign({}, global.Scalp.Config.DEFAULT_API)
    global.Scalp.Config.save(global.Scalp.Config.KEYS.api, this.state)
    this.bus.emit('api:changed', this.get())
  }

  ApiAgent.prototype.applyPreset = function (exchange, testnet) {
    var t = typeof testnet === 'boolean' ? testnet : this.state.testnet
    this.patch(global.Scalp.Config.applyExchangePreset(exchange, t))
  }

  ApiAgent.prototype._trim = function (url) {
    return String(url || '').replace(/\/+$/, '')
  }

  ApiAgent.prototype.timeUrl = function () {
    var base = this._trim(this.state.restBaseUrl)
    if (this.state.exchange === 'binance-futures' || this.state.market === 'futures') {
      return base + '/fapi/v1/time'
    }
    if (this.state.exchange === 'bybit') return base + '/v5/market/time'
    return base + '/api/v3/time'
  }

  ApiAgent.prototype.depthRestUrl = function (symbol) {
    var base = this._trim(this.state.restBaseUrl)
    var sym = String(symbol).toUpperCase()
    var limit = this.state.depthLimit
    if (this.state.exchange === 'bybit') {
      return base + '/v5/market/orderbook?category=spot&symbol=' + sym + '&limit=' + Math.min(limit, 200)
    }
    if (this.state.exchange === 'binance-futures' || this.state.market === 'futures') {
      return base + '/fapi/v1/depth?symbol=' + sym + '&limit=' + limit
    }
    return base + '/api/v3/depth?symbol=' + sym + '&limit=' + limit
  }

  ApiAgent.prototype.depthWsUrl = function (symbol) {
    var base = this._trim(this.state.wsBaseUrl)
    var sym = String(symbol).toLowerCase()
    if (this.state.exchange === 'bybit') return base + '/v5/public/spot'
    var levels = 20
    var speed = this.state.depthSpeed === '1000ms' ? '' : '@100ms'
    return base + '/ws/' + sym + '@depth' + levels + speed
  }

  ApiAgent.prototype.resolveSymbol = function (selected) {
    var custom = (this.state.customSymbol || '').trim()
    return custom || selected
  }

  ApiAgent.prototype.testPublic = async function () {
    var started = performance.now()
    try {
      var res = await fetch(this.timeUrl())
      var ms = Math.round(performance.now() - started)
      if (!res.ok) {
        this.bus.emit('api:test-result', { ok: false, message: 'HTTP ' + res.status, latencyMs: ms })
        return
      }
      var data = await res.json()
      var serverTime = Number(data.serverTime || data.time || Date.now())
      this.bus.emit('api:test-result', {
        ok: true,
        latencyMs: ms,
        message: 'OK · ' + ms + ' мс · ' + new Date(serverTime).toLocaleTimeString(),
      })
    } catch (e) {
      this.bus.emit('api:test-result', {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        message: e.message || 'Ошибка сети',
      })
    }
  }

  ApiAgent.prototype._hmac = async function (secret, payload) {
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

  ApiAgent.prototype.testSigned = async function () {
    if (!this.state.apiKey || !this.state.apiSecret) {
      this.bus.emit('api:test-result', { ok: false, latencyMs: 0, message: 'Укажите API Key и Secret' })
      return
    }
    if (this.state.exchange === 'bybit') {
      this.bus.emit('api:test-result', {
        ok: false,
        latencyMs: 0,
        message: 'Подписанный тест Bybit не реализован',
      })
      return
    }
    var started = performance.now()
    try {
      var ts = Date.now()
      var query = 'timestamp=' + ts
      var signature = await this._hmac(this.state.apiSecret, query)
      var path =
        this.state.exchange === 'binance-futures' || this.state.market === 'futures'
          ? '/fapi/v2/account'
          : '/api/v3/account'
      var url = this._trim(this.state.restBaseUrl) + path + '?' + query + '&signature=' + signature
      var res = await fetch(url, { headers: { 'X-MBX-APIKEY': this.state.apiKey } })
      var ms = Math.round(performance.now() - started)
      if (!res.ok) {
        var body = await res.text()
        this.bus.emit('api:test-result', {
          ok: false,
          latencyMs: ms,
          message: 'HTTP ' + res.status + ': ' + body.slice(0, 120),
        })
        return
      }
      this.bus.emit('api:test-result', { ok: true, latencyMs: ms, message: 'Ключи валидны · ' + ms + ' мс' })
    } catch (e) {
      this.bus.emit('api:test-result', {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        message: e.message || 'Ошибка подписи',
      })
    }
  }

  ApiAgent.prototype.start = function () {
    this.bus.emit('api:changed', this.get())
  }

  global.Scalp.ApiAgent = ApiAgent
})(typeof window !== 'undefined' ? window : globalThis)
