/* Indicators — SMA / EMA / BB / RSI / VWAP */
(function (global) {
  'use strict'

  function closes(candles) {
    return candles.map(function (c) {
      return c.close
    })
  }

  function sma(values, period) {
    var out = new Array(values.length).fill(null)
    var sum = 0
    for (var i = 0; i < values.length; i++) {
      sum += values[i]
      if (i >= period) sum -= values[i - period]
      if (i >= period - 1) out[i] = sum / period
    }
    return out
  }

  function ema(values, period) {
    var out = new Array(values.length).fill(null)
    if (!values.length) return out
    var k = 2 / (period + 1)
    var prev = values[0]
    out[0] = prev
    for (var i = 1; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k)
      out[i] = i >= period - 1 ? prev : null
      if (i < period - 1) prev = values[i] * k + prev * (1 - k)
    }
    // recompute properly
    out = new Array(values.length).fill(null)
    var seed = 0
    for (i = 0; i < period && i < values.length; i++) seed += values[i]
    if (values.length < period) return out
    prev = seed / period
    out[period - 1] = prev
    for (i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k)
      out[i] = prev
    }
    return out
  }

  function bollinger(values, period, mult) {
    mult = mult || 2
    var mid = sma(values, period)
    var upper = new Array(values.length).fill(null)
    var lower = new Array(values.length).fill(null)
    for (var i = period - 1; i < values.length; i++) {
      var mean = mid[i]
      var acc = 0
      for (var j = i - period + 1; j <= i; j++) {
        var d = values[j] - mean
        acc += d * d
      }
      var sd = Math.sqrt(acc / period)
      upper[i] = mean + mult * sd
      lower[i] = mean - mult * sd
    }
    return { mid: mid, upper: upper, lower: lower }
  }

  function rsi(values, period) {
    period = period || 14
    var out = new Array(values.length).fill(null)
    if (values.length <= period) return out
    var gains = 0
    var losses = 0
    for (var i = 1; i <= period; i++) {
      var ch = values[i] - values[i - 1]
      if (ch >= 0) gains += ch
      else losses -= ch
    }
    var avgGain = gains / period
    var avgLoss = losses / period
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    for (i = period + 1; i < values.length; i++) {
      ch = values[i] - values[i - 1]
      var g = ch > 0 ? ch : 0
      var l = ch < 0 ? -ch : 0
      avgGain = (avgGain * (period - 1) + g) / period
      avgLoss = (avgLoss * (period - 1) + l) / period
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    }
    return out
  }

  function vwap(candles) {
    var out = new Array(candles.length).fill(null)
    var cumPV = 0
    var cumV = 0
    for (var i = 0; i < candles.length; i++) {
      var typical = (candles[i].high + candles[i].low + candles[i].close) / 3
      cumPV += typical * candles[i].volume
      cumV += candles[i].volume
      out[i] = cumV ? cumPV / cumV : null
    }
    return out
  }

  function compute(candles, flags) {
    var c = closes(candles)
    var result = { sma20: null, sma50: null, ema12: null, ema26: null, bb: null, rsi: null, vwap: null }
    if (flags.sma20) result.sma20 = sma(c, 20)
    if (flags.sma50) result.sma50 = sma(c, 50)
    if (flags.ema12) result.ema12 = ema(c, 12)
    if (flags.ema26) result.ema26 = ema(c, 26)
    if (flags.bb) result.bb = bollinger(c, 20, 2)
    if (flags.vwap) result.vwap = vwap(candles)
    result.rsi = rsi(c, 14)
    return result
  }

  /** Workb: индикаторы с пользовательскими периодами/параметрами */
  function computeConfigured(candles, cfg) {
    cfg = cfg || {}
    var c = closes(candles)
    var out = { sma: null, ema: null, bb: null, rsi: null }
    var smaCfg = cfg.sma || {}
    var emaCfg = cfg.ema || {}
    var bbCfg = cfg.bb || {}
    var rsiCfg = cfg.rsi || {}
    if (smaCfg.visible !== false && smaCfg.on !== false) {
      out.sma = sma(c, Math.max(2, Number(smaCfg.period) || 20))
    }
    if (emaCfg.visible !== false && emaCfg.on !== false) {
      out.ema = ema(c, Math.max(2, Number(emaCfg.period) || 12))
    }
    if (bbCfg.visible !== false && bbCfg.on !== false) {
      out.bb = bollinger(c, Math.max(2, Number(bbCfg.period) || 20), Number(bbCfg.mult) || 2)
    }
    if (rsiCfg.visible !== false && rsiCfg.on !== false) {
      out.rsi = rsi(c, Math.max(2, Number(rsiCfg.period) || 14))
    }
    return out
  }

  global.Scalp = global.Scalp || {}
  global.Scalp.Indicators = {
    sma: sma,
    ema: ema,
    bollinger: bollinger,
    rsi: rsi,
    vwap: vwap,
    compute: compute,
    computeConfigured: computeConfigured,
  }
})(typeof window !== 'undefined' ? window : globalThis)
