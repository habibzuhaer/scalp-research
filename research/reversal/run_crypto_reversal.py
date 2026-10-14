#!/usr/bin/env python3
"""Crypto reversal research: top-vol 5m/15m, clear long rules, Bybit history."""
from __future__ import annotations

import json
import math
import sqlite3
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "out"
MTB_DB = Path(
    ""
)
BYBIT = "https://api.bybit.com"
FEE_SIDE = 0.0006
TOP_N = 15
HISTORY_BARS = {"5m": 9000, "15m": 6000}
MAX_HOLD = {"5m": 24, "15m": 16}
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SCALP-research/1.0)"}


@dataclass
class Trade:
    symbol: str
    tf: str
    strategy: str
    entry_ts: int
    exit_ts: int
    entry: float
    exit: float
    stop: float
    target: float
    bars_held: int
    reason: str
    ret: float
    r_multiple: float


def utc(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M")


def rank_volatile(tf: str, top: int = TOP_N) -> list[str]:
    con = sqlite3.connect(f"file:{MTB_DB}?mode=ro&immutable=1", uri=True)
    rows = con.execute(
        """
        SELECT symbol, timestamp, open, high, low, close, volume
        FROM candles WHERE exchange='bybit' AND timeframe=?
        ORDER BY symbol, timestamp
        """,
        (tf,),
    ).fetchall()
    con.close()
    by: dict[str, list] = {}
    for s, ts, o, h, l, c, v in rows:
        by.setdefault(s, []).append((o, h, l, c, v or 0))
    ranked = []
    for s, bars in by.items():
        if len(bars) < 200:
            continue
        bars = bars[-800:]
        rets, atrs = [], []
        for i in range(1, len(bars)):
            p0, p1 = bars[i - 1][3], bars[i][3]
            if p0 > 0 and p1 > 0:
                rets.append(math.log(p1 / p0))
            h, l, c, pc = bars[i][1], bars[i][2], bars[i][3], bars[i - 1][3]
            tr = max(h - l, abs(h - pc), abs(l - pc))
            if c > 0:
                atrs.append(tr / c)
        if len(rets) < 150:
            continue
        m = sum(rets) / len(rets)
        var = sum((x - m) ** 2 for x in rets) / len(rets)
        atrp = sum(atrs[-100:]) / min(100, len(atrs)) * 100
        ranked.append((atrp + math.sqrt(var) * 100, s))
    ranked.sort(reverse=True)
    return [s for _, s in ranked[:top]]


def fetch_klines(symbol: str, interval: str, target: int, retries: int = 4) -> pd.DataFrame:
    iv = {"5m": "5", "15m": "15"}[interval]
    end_ms = int(time.time() * 1000)
    all_rows: list[list] = []
    attempt = 0
    with httpx.Client(timeout=60.0, headers=HEADERS) as client:
        while len(all_rows) < target:
            try:
                r = client.get(
                    f"{BYBIT}/v5/market/kline",
                    params={
                        "category": "linear",
                        "symbol": symbol,
                        "interval": iv,
                        "end": end_ms,
                        "limit": 1000,
                    },
                )
                r.raise_for_status()
                data = r.json()
                if data.get("retCode") != 0:
                    msg = str(data.get("retMsg") or "")
                    if "Rate Limit" in msg or data.get("retCode") == 10006:
                        attempt += 1
                        if attempt > retries:
                            raise RuntimeError(msg)
                        time.sleep(1.5 * attempt)
                        continue
                    raise RuntimeError(msg)
                lst = data.get("result", {}).get("list") or []
                attempt = 0
                if not lst:
                    break
                all_rows.extend(lst)
                end_ms = int(lst[-1][0]) - 1
                if len(lst) < 1000:
                    break
                time.sleep(0.25)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                attempt += 1
                if attempt > retries:
                    raise
                time.sleep(1.5 * attempt)
    if not all_rows:
        return pd.DataFrame()
    df = pd.DataFrame(
        all_rows,
        columns=["timestamp", "open", "high", "low", "close", "volume", "turnover"],
    )
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = df[c].astype(float)
    df["timestamp"] = (df["timestamp"].astype("int64") // 1000).astype(int)
    df = df.drop_duplicates("timestamp").sort_values("timestamp").reset_index(drop=True)
    if len(df) > target:
        df = df.iloc[-target:].reset_index(drop=True)
    return df[["timestamp", "open", "high", "low", "close", "volume"]]


def load_or_fetch(symbol: str, tf: str, force: bool = False) -> pd.DataFrame:
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA / f"{symbol}_{tf}.csv"
    need = HISTORY_BARS[tf]
    if path.exists() and not force:
        df = pd.read_csv(path)
        if len(df) >= int(need * 0.7):
            return df
    df = fetch_klines(symbol, tf, need)
    if not df.empty:
        df.to_csv(path, index=False)
    return df


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    h, l, c = df["high"], df["low"], df["close"]
    prev = c.shift(1)
    tr = pd.concat([(h - l), (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(n, min_periods=n).mean()


def simulate_long(
    df: pd.DataFrame,
    signal_i: int,
    stop: float,
    strategy: str,
    symbol: str,
    tf: str,
    rr: float,
    be_at_r: float | None = None,
) -> Trade | None:
    if signal_i + 1 >= len(df):
        return None
    entry_i = signal_i + 1
    entry = float(df.at[entry_i, "open"])
    if not (entry > 0 and stop > 0 and stop < entry):
        return None
    risk = entry - stop
    risk_pct = risk / entry
    if risk_pct < 0.0015 or risk_pct > 0.05:
        return None
    target = entry + rr * risk
    be_level = entry + be_at_r * risk if be_at_r else None
    cur_stop = stop
    max_hold = MAX_HOLD[tf]
    exit_px = reason = exit_i = None
    for j in range(entry_i, min(len(df), entry_i + max_hold)):
        lo = float(df.at[j, "low"])
        hi = float(df.at[j, "high"])
        if be_level is not None and hi >= be_level and cur_stop < entry:
            cur_stop = entry  # move to breakeven after partial R
        if lo <= cur_stop:
            exit_px, reason, exit_i = cur_stop, ("be" if cur_stop >= entry else "stop"), j
            break
        if hi >= target:
            exit_px, reason, exit_i = target, "target", j
            break
    if exit_px is None:
        exit_i = min(len(df) - 1, entry_i + max_hold - 1)
        exit_px = float(df.at[exit_i, "close"])
        reason = "time"
    ret = (exit_px / entry - 1.0) - 2 * FEE_SIDE
    r_mult = ((exit_px - entry) / risk) - (2 * FEE_SIDE * entry / risk)
    return Trade(
        symbol=symbol,
        tf=tf,
        strategy=strategy,
        entry_ts=int(df.at[entry_i, "timestamp"]),
        exit_ts=int(df.at[exit_i, "timestamp"]),
        entry=entry,
        exit=float(exit_px),
        stop=stop,
        target=target,
        bars_held=exit_i - entry_i + 1,
        reason=str(reason),
        ret=ret,
        r_multiple=r_mult,
    )


def pin_stop(df, i):
    o, h, l, c = map(float, df.loc[i, ["open", "high", "low", "close"]])
    rng = h - l
    if rng <= 0:
        return None
    body = abs(c - o)
    lower = min(o, c) - l
    upper = h - max(o, c)
    if lower < 2.2 * max(body, rng * 0.02) or lower < 0.65 * rng:
        return None
    if upper > 0.2 * rng:
        return None
    if (c - l) / rng < 0.6:
        return None
    if i < 20:
        return None
    sma = float(df["close"].iloc[i - 19 : i + 1].mean())
    if not (c < sma or c < float(df.at[i - 5, "close"])):
        return None
    return l


def engulf_stop(df, i):
    if i < 3:
        return None
    o0, l0, c0 = float(df.at[i - 1, "open"]), float(df.at[i - 1, "low"]), float(df.at[i - 1, "close"])
    o1, l1, c1 = float(df.at[i, "open"]), float(df.at[i, "low"]), float(df.at[i, "close"])
    if not (c0 < o0 and c1 > o1):
        return None
    if not (o1 <= c0 and c1 >= o0):
        return None
    if abs(c1 - o1) <= abs(c0 - o0) * 1.1:
        return None
    # 3 down closes before engulf
    if not (
        float(df.at[i - 1, "close"]) < float(df.at[i - 2, "close"]) < float(df.at[i - 3, "close"])
    ):
        return None
    return min(l0, l1)


def sweep_stop(df, i):
    L = 20
    if i < L + 1:
        return None
    prior_low = float(df.iloc[i - L : i]["low"].min())
    o, h, l, c = map(float, df.loc[i, ["open", "high", "low", "close"]])
    rng = h - l
    if rng <= 0 or l >= prior_low or c <= prior_low:
        return None
    if (c - l) / rng < 0.55:
        return None
    # volume confirmation if available
    vol = float(df.at[i, "volume"])
    vma = float(df["volume"].iloc[i - 20 : i].mean())
    if vma > 0 and vol < 1.2 * vma:
        return None
    return l


def sweep_confirm_stop(df, i):
    """Signal on confirmation bar: previous bar swept liquidity, this bar closes up."""
    if i < 22:
        return None
    L = 20
    j = i - 1
    prior_low = float(df.iloc[j - L : j]["low"].min())
    o0, h0, l0, c0 = map(float, df.loc[j, ["open", "high", "low", "close"]])
    rng0 = h0 - l0
    if rng0 <= 0 or l0 >= prior_low or c0 <= prior_low:
        return None
    if (c0 - l0) / rng0 < 0.5:
        return None
    o1, c1 = float(df.at[i, "open"]), float(df.at[i, "close"])
    if not (c1 > o1 and c1 > c0):
        return None
    return l0


STRAT_FUNCS = {
    "PIN_HAMMER": pin_stop,
    "ENGULF_3DOWN": engulf_stop,
    "SWEEP_VOL": sweep_stop,
    "SWEEP_CONFIRM": sweep_confirm_stop,
}


def backtest_one(
    df: pd.DataFrame,
    symbol: str,
    tf: str,
    name: str,
    fn,
    rr: float,
    be_at_r: float | None,
) -> list[Trade]:
    trades: list[Trade] = []
    atr_s = atr(df)
    cooldown = -1
    for i in range(25, len(df) - 2):
        if i < cooldown:
            continue
        stop = fn(df, i)
        if stop is None:
            continue
        a = atr_s.iloc[i]
        buf = (float(a) * 0.05) if pd.notna(a) and a > 0 else stop * 0.0005
        tag = f"{name}_RR{rr:g}" + (f"_BE{be_at_r:g}" if be_at_r else "")
        t = simulate_long(df, i, stop - buf, tag, symbol, tf, rr=rr, be_at_r=be_at_r)
        if t is None:
            continue
        trades.append(t)
        cooldown = i + max(2, int(MAX_HOLD[tf] * 0.15))
    return trades


def summarize(trades: list[Trade]) -> list[dict]:
    if not trades:
        return []
    df = pd.DataFrame([asdict(t) for t in trades])
    rows = []
    for (tf, strat), g in df.groupby(["tf", "strategy"]):
        rows.append(
            {
                "tf": tf,
                "strategy": strat,
                "trades": int(len(g)),
                "winrate": round(float((g["ret"] > 0).mean()), 4),
                "avg_ret": round(float(g["ret"].mean()), 5),
                "sum_ret": round(float(g["ret"].sum()), 4),
                "avg_R": round(float(g["r_multiple"].mean()), 3),
                "sum_R": round(float(g["r_multiple"].sum()), 1),
                "target": int((g["reason"] == "target").sum()),
                "stop": int((g["reason"] == "stop").sum()),
                "be": int((g["reason"] == "be").sum()),
                "time": int((g["reason"] == "time").sum()),
                "avg_hold": round(float(g["bars_held"].mean()), 1),
                "symbols": int(g["symbol"].nunique()),
            }
        )
    rows.sort(key=lambda x: (x["sum_R"], x["avg_R"]), reverse=True)
    return rows


def rules_md() -> str:
    return """# Логика разворотных лонгов (крипта 5m / 15m)

Общее:
- **Покупать** на open следующей свечи после сигнала
- **Стоп** под low сигнальной свечи (−0.05×ATR)
- **Тейк** = +RR×риск (тесты RR=1.5 и RR=2)
- Опция **BE**: после +1R стоп переносится в безубыток
- Комиссия 0.06% × 2 стороны
- Тайм-стоп: 5m=24 бара (~2ч), 15m=16 баров (~4ч)
- Риск на сделку ограничен 0.15%…5% от цены

## PIN_HAMMER
Покупать: длинная нижняя тень (≥2.2× тела, ≥65% range), маленькая верхняя тень, close вверху, цена ниже SMA20 или ниже close[-5].
Держать до стопа / +RR / тайм-стоп.

## ENGULF_3DOWN
Покупать: бычье поглощение после **трёх** снижающихся close подряд.
Держать до стопа под min(low двух свечей) / +RR / тайм.

## SWEEP_VOL
Покупать: обновление 20-bar low + close обратно выше этого low + объём ≥1.2× среднего.
Держать до стопа под sweep-low / +RR / тайм.

## SWEEP_CONFIRM
Покупать: sweep как выше, **и** следующая свеча закрылась бычьей выше close sweep.
Держать до стопа под sweep-low / +RR / тайм.
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    uni5, uni15 = rank_volatile("5m"), rank_volatile("15m")
    meta = {"top_5m": uni5, "top_15m": uni15, "universe": sorted(set(uni5) | set(uni15))}
    (OUT / "universe.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (OUT / "RULES.md").write_text(rules_md(), encoding="utf-8")

    fetch_log = []
    frames: dict[tuple[str, str], pd.DataFrame] = {}
    for tf, symbols in (("5m", uni5), ("15m", uni15)):
        for sym in symbols:
            try:
                df = load_or_fetch(sym, tf)
                if df is None or len(df) < 300:
                    fetch_log.append({"symbol": sym, "tf": tf, "ok": False, "err": "short"})
                    print("SKIP", sym, tf)
                    continue
                frames[(sym, tf)] = df
                fetch_log.append(
                    {
                        "symbol": sym,
                        "tf": tf,
                        "ok": True,
                        "bars": len(df),
                        "from": utc(int(df.iloc[0].timestamp)),
                        "to": utc(int(df.iloc[-1].timestamp)),
                    }
                )
                print(f"OK {sym} {tf} n={len(df)}")
            except Exception as e:
                fetch_log.append({"symbol": sym, "tf": tf, "ok": False, "err": str(e)})
                print("FAIL", sym, tf, e)
            time.sleep(0.15)

    (OUT / "fetch_log.json").write_text(json.dumps(fetch_log, indent=2), encoding="utf-8")

    all_trades: list[Trade] = []
    variants = [
        (1.5, None),
        (2.0, None),
        (2.0, 1.0),  # RR2 with BE at 1R
    ]
    for (sym, tf), df in frames.items():
        for name, fn in STRAT_FUNCS.items():
            for rr, be in variants:
                all_trades.extend(backtest_one(df, sym, tf, name, fn, rr, be))

    if all_trades:
        pd.DataFrame([asdict(t) for t in all_trades]).to_csv(OUT / "trades.csv", index=False)
    summary = summarize(all_trades)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # best positive / least bad
    print("\n=== TOP by sum_R ===")
    for r in summary[:12]:
        print(
            f"{r['tf']:4s} {r['strategy']:22s} n={r['trades']:4d} wr={r['winrate']*100:5.1f}% "
            f"avgR={r['avg_R']:+.3f} sumR={r['sum_R']:+.1f} "
            f"TP/SL/BE/T={r['target']}/{r['stop']}/{r['be']}/{r['time']}"
        )
    print("\n=== Worst ===")
    for r in summary[-6:]:
        print(
            f"{r['tf']:4s} {r['strategy']:22s} n={r['trades']:4d} wr={r['winrate']*100:5.1f}% "
            f"sumR={r['sum_R']:+.1f}"
        )

    positive = [r for r in summary if r["sum_R"] > 0 and r["trades"] >= 30]
    (OUT / "positive.json").write_text(json.dumps(positive, indent=2), encoding="utf-8")
    print(f"\nPositive variants (>=30 trades): {len(positive)}")
    for r in positive[:10]:
        print(" +", r["tf"], r["strategy"], f"sumR={r['sum_R']:+.1f}", f"wr={r['winrate']*100:.1f}%")


if __name__ == "__main__":
    main()
