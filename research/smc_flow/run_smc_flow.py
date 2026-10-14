#!/usr/bin/env python3
"""Port + backtest of Open SMC Flow on top-N volatile Bybit linear symbols.

Mirrors research/smc_flow/Open_SMC_Flow.pine (confirmed-bar signals only).
Uses local CSV cache under research/reversal/data when present; otherwise Bybit.
Universe: rank by realized vol + ATR% from modular_trading_bot candles DB.
"""
from __future__ import annotations

import json
import math
import sqlite3
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
REV_DATA = ROOT.parent / "reversal" / "data"
OUT = ROOT / "out"
MTB_DB = Path(
    ""
)
BYBIT = "https://api.bybit.com"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SCALP-smc-flow/1.0)"}

TOP_N = 25
HISTORY_BARS = {"5m": 9000, "15m": 6000}
FEE_SIDE = 0.0006
SWING_LEN = 10
ST_ATR = 10
ST_FACTOR = 3.0
FWD_BARS = {"5m": 12, "15m": 8}  # ~1h / ~2h forward check
MAX_HOLD = {"5m": 48, "15m": 32}


@dataclass
class Trade:
    symbol: str
    tf: str
    mode: str
    side: str
    entry_ts: int
    exit_ts: int
    entry: float
    exit: float
    bars_held: int
    reason: str
    ret: float
    mfe_pct: float
    mae_pct: float


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
            except (httpx.TimeoutException, httpx.TransportError):
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
    REV_DATA.mkdir(parents=True, exist_ok=True)
    path = REV_DATA / f"{symbol}_{tf}.csv"
    need = HISTORY_BARS[tf]
    if path.exists() and not force:
        df = pd.read_csv(path)
        if len(df) >= int(need * 0.7):
            return df
    df = fetch_klines(symbol, tf, need)
    if not df.empty:
        df.to_csv(path, index=False)
    return df


def atr_rma(df: pd.DataFrame, n: int) -> np.ndarray:
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    tr = np.empty(len(df), dtype=float)
    tr[0] = h[0] - l[0]
    for i in range(1, len(df)):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    out = np.full(len(df), np.nan)
    if len(df) < n:
        return out
    out[n - 1] = tr[:n].mean()
    alpha = 1.0 / n
    for i in range(n, len(df)):
        out[i] = out[i - 1] + alpha * (tr[i] - out[i - 1])
    return out


def supertrend(df: pd.DataFrame, factor: float, atr_period: int):
    """TradingView-like SuperTrend. dir: -1 uptrend, +1 downtrend."""
    n = len(df)
    atr = atr_rma(df, atr_period)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    hl2 = (h + l) * 0.5
    basic_ub = hl2 + factor * atr
    basic_lb = hl2 - factor * atr
    final_ub = np.full(n, np.nan)
    final_lb = np.full(n, np.nan)
    st = np.full(n, np.nan)
    direction = np.full(n, np.nan)

    for i in range(n):
        if np.isnan(atr[i]):
            continue
        if i == 0 or np.isnan(final_ub[i - 1]):
            final_ub[i] = basic_ub[i]
            final_lb[i] = basic_lb[i]
        else:
            if basic_ub[i] < final_ub[i - 1] or c[i - 1] > final_ub[i - 1]:
                final_ub[i] = basic_ub[i]
            else:
                final_ub[i] = final_ub[i - 1]
            if basic_lb[i] > final_lb[i - 1] or c[i - 1] < final_lb[i - 1]:
                final_lb[i] = basic_lb[i]
            else:
                final_lb[i] = final_lb[i - 1]

        if i == 0 or np.isnan(direction[i - 1]):
            direction[i] = 1.0
        elif direction[i - 1] == 1.0:
            direction[i] = -1.0 if c[i] > final_ub[i] else 1.0
        else:
            direction[i] = 1.0 if c[i] < final_lb[i] else -1.0

        st[i] = final_lb[i] if direction[i] < 0 else final_ub[i]
    return st, direction


def pivots(high: np.ndarray, low: np.ndarray, left: int, right: int):
    """Emit pivot at confirm bar j (like Pine ta.pivothigh/low), value = center bar."""
    n = len(high)
    ph = np.full(n, np.nan)
    pl = np.full(n, np.nan)
    for j in range(left + right, n):
        i = j - right
        wh = high[i - left : i + right + 1]
        wl = low[i - left : i + right + 1]
        if np.all(high[i] >= wh):
            ph[j] = high[i]
        if np.all(low[i] <= wl):
            pl[j] = low[i]
    return ph, pl


def compute_signals(df: pd.DataFrame, filter_struct: bool, filter_zone: bool) -> pd.DataFrame:
    out = df.copy().reset_index(drop=True)
    n = len(out)
    h = out["high"].to_numpy(float)
    l = out["low"].to_numpy(float)
    c = out["close"].to_numpy(float)

    ph, pl = pivots(h, l, SWING_LEN, SWING_LEN)
    st, direction = supertrend(out, ST_FACTOR, ST_ATR)

    hi_lvl = np.nan
    lo_lvl = np.nan
    hi_act = False
    lo_act = False
    trend = 0
    range_hi = np.nan
    range_lo = np.nan

    bos_up = np.zeros(n, dtype=bool)
    bos_dn = np.zeros(n, dtype=bool)
    choch_up = np.zeros(n, dtype=bool)
    choch_dn = np.zeros(n, dtype=bool)
    buy = np.zeros(n, dtype=bool)
    sell = np.zeros(n, dtype=bool)
    in_disc = np.zeros(n, dtype=bool)
    in_prem = np.zeros(n, dtype=bool)
    trend_arr = np.zeros(n, dtype=int)

    for i in range(n):
        if not np.isnan(ph[i]):
            hi_lvl = ph[i]
            hi_act = True
            range_hi = ph[i]
        if not np.isnan(pl[i]):
            lo_lvl = pl[i]
            lo_act = True
            range_lo = pl[i]

        have = not np.isnan(range_hi) and not np.isnan(range_lo) and range_hi > range_lo
        mid = (range_hi + range_lo) * 0.5 if have else np.nan
        in_disc[i] = bool(have and c[i] <= mid)
        in_prem[i] = bool(have and c[i] >= mid)

        brk_up = hi_act and not np.isnan(hi_lvl) and c[i] > hi_lvl
        brk_dn = lo_act and not np.isnan(lo_lvl) and c[i] < lo_lvl

        if brk_up:
            is_choch = trend == -1
            choch_up[i] = is_choch
            bos_up[i] = not is_choch
            trend = 1
            hi_act = False
        if brk_dn and not brk_up:
            is_choch = trend == 1
            choch_dn[i] = is_choch
            bos_dn[i] = not is_choch
            trend = -1
            lo_act = False

        trend_arr[i] = trend

        if i == 0 or np.isnan(direction[i]) or np.isnan(direction[i - 1]):
            continue
        dchg = direction[i] - direction[i - 1]
        st_buy = dchg < 0
        st_sell = dchg > 0
        struct_ok_buy = (not filter_struct) or trend >= 0
        struct_ok_sell = (not filter_struct) or trend <= 0
        zone_ok_buy = (not filter_zone) or in_disc[i]
        zone_ok_sell = (not filter_zone) or in_prem[i]
        buy[i] = bool(st_buy and struct_ok_buy and zone_ok_buy)
        sell[i] = bool(st_sell and struct_ok_sell and zone_ok_sell)

    out["bos_up"] = bos_up
    out["bos_dn"] = bos_dn
    out["choch_up"] = choch_up
    out["choch_dn"] = choch_dn
    out["buy"] = buy
    out["sell"] = sell
    out["trend"] = trend_arr
    out["st"] = st
    out["dir"] = direction
    out["in_discount"] = in_disc
    out["in_premium"] = in_prem
    return out


def forward_stats(df: pd.DataFrame, signal_col: str, side: str, fwd: int) -> dict:
    idx = np.where(df[signal_col].to_numpy())[0]
    if len(idx) == 0:
        return {"n": 0, "avg_ret_pct": None, "hit_pos": None, "avg_mfe": None, "avg_mae": None}
    rets, mfe, mae, hits = [], [], [], 0
    c = df["close"].to_numpy(float)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    for i in idx:
        j = min(i + fwd, len(df) - 1)
        if j <= i:
            continue
        entry = c[i]
        if entry <= 0:
            continue
        if side == "long":
            r = (c[j] / entry - 1) * 100
            mfe.append((h[i + 1 : j + 1].max() / entry - 1) * 100)
            mae.append((l[i + 1 : j + 1].min() / entry - 1) * 100)
        else:
            r = (entry / c[j] - 1) * 100
            mfe.append((entry / l[i + 1 : j + 1].min() - 1) * 100)
            mae.append((entry / h[i + 1 : j + 1].max() - 1) * 100)
        rets.append(r)
        if r > 0:
            hits += 1
    if not rets:
        return {"n": 0, "avg_ret_pct": None, "hit_pos": None, "avg_mfe": None, "avg_mae": None}
    return {
        "n": len(rets),
        "avg_ret_pct": round(float(np.mean(rets)), 4),
        "hit_pos": round(hits / len(rets), 4),
        "avg_mfe": round(float(np.mean(mfe)), 4),
        "avg_mae": round(float(np.mean(mae)), 4),
    }


def simulate_flip(df: pd.DataFrame, symbol: str, tf: str, mode: str) -> list[Trade]:
    """Long on buy, short on sell; exit on opposite signal or max hold. Fees both sides."""
    trades: list[Trade] = []
    pos = None  # dict
    max_hold = MAX_HOLD[tf]
    c = df["close"].to_numpy(float)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    ts = df["timestamp"].to_numpy(int)
    buy = df["buy"].to_numpy(bool)
    sell = df["sell"].to_numpy(bool)

    def close_pos(i: int, reason: str):
        nonlocal pos
        if pos is None:
            return
        entry = pos["entry"]
        side = pos["side"]
        exit_px = c[i]
        if side == "long":
            ret = exit_px / entry - 1 - 2 * FEE_SIDE
            mfe = h[pos["i"] + 1 : i + 1].max() / entry - 1 if i > pos["i"] else 0.0
            mae = l[pos["i"] + 1 : i + 1].min() / entry - 1 if i > pos["i"] else 0.0
        else:
            ret = entry / exit_px - 1 - 2 * FEE_SIDE
            mfe = entry / l[pos["i"] + 1 : i + 1].min() - 1 if i > pos["i"] else 0.0
            mae = entry / h[pos["i"] + 1 : i + 1].max() - 1 if i > pos["i"] else 0.0
        trades.append(
            Trade(
                symbol=symbol,
                tf=tf,
                mode=mode,
                side=side,
                entry_ts=int(pos["ts"]),
                exit_ts=int(ts[i]),
                entry=float(entry),
                exit=float(exit_px),
                bars_held=int(i - pos["i"]),
                reason=reason,
                ret=float(ret),
                mfe_pct=float(mfe * 100),
                mae_pct=float(mae * 100),
            )
        )
        pos = None

    for i in range(len(df)):
        if pos is not None and i - pos["i"] >= max_hold:
            close_pos(i, "max_hold")
        if buy[i]:
            if pos is not None and pos["side"] == "short":
                close_pos(i, "flip")
            if pos is None:
                pos = {"side": "long", "entry": c[i], "i": i, "ts": ts[i]}
        elif sell[i]:
            if pos is not None and pos["side"] == "long":
                close_pos(i, "flip")
            if pos is None:
                pos = {"side": "short", "entry": c[i], "i": i, "ts": ts[i]}
    if pos is not None:
        close_pos(len(df) - 1, "eod")
    return trades


def summarize_trades(trades: list[Trade]) -> dict:
    if not trades:
        return {"n": 0, "winrate": None, "avg_ret": None, "sum_ret": None, "avg_mfe": None, "avg_mae": None}
    rets = [t.ret for t in trades]
    wins = sum(1 for r in rets if r > 0)
    return {
        "n": len(trades),
        "winrate": round(wins / len(rets), 4),
        "avg_ret": round(float(np.mean(rets)) * 100, 4),
        "sum_ret": round(float(np.sum(rets)) * 100, 4),
        "avg_mfe": round(float(np.mean([t.mfe_pct for t in trades])), 4),
        "avg_mae": round(float(np.mean([t.mae_pct for t in trades])), 4),
        "long_n": sum(1 for t in trades if t.side == "long"),
        "short_n": sum(1 for t in trades if t.side == "short"),
    }


def run_symbol(symbol: str, tf: str) -> dict:
    df = load_or_fetch(symbol, tf)
    if df.empty or len(df) < 300:
        return {"symbol": symbol, "tf": tf, "error": "no_data", "bars": len(df) if not df.empty else 0}

    modes = {
        "raw": (False, False),
        "struct": (True, False),
        "struct_zone": (True, True),
    }
    result: dict = {"symbol": symbol, "tf": tf, "bars": len(df), "modes": {}}
    all_trades: list[Trade] = []
    fwd = FWD_BARS[tf]

    for mode, (fs, fz) in modes.items():
        sig = compute_signals(df, fs, fz)
        counts = {
            "buy": int(sig["buy"].sum()),
            "sell": int(sig["sell"].sum()),
            "bos_up": int(sig["bos_up"].sum()),
            "bos_dn": int(sig["bos_dn"].sum()),
            "choch_up": int(sig["choch_up"].sum()),
            "choch_dn": int(sig["choch_dn"].sum()),
        }
        fwd_buy = forward_stats(sig, "buy", "long", fwd)
        fwd_sell = forward_stats(sig, "sell", "short", fwd)
        trades = simulate_flip(sig, symbol, tf, mode)
        all_trades.extend(trades)
        result["modes"][mode] = {
            "counts": counts,
            f"fwd_{fwd}bars_buy": fwd_buy,
            f"fwd_{fwd}bars_sell": fwd_sell,
            "flip_trades": summarize_trades(trades),
        }
    result["_trades"] = all_trades
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("Ranking top volatile symbols from DB...")
    top5 = rank_volatile("5m", TOP_N)
    top15 = rank_volatile("15m", TOP_N)
    universe = {
        "top_5m": top5,
        "top_15m": top15,
        "generated_at": utc(int(time.time())),
        "params": {
            "swing_len": SWING_LEN,
            "st_atr": ST_ATR,
            "st_factor": ST_FACTOR,
            "fee_side": FEE_SIDE,
            "modes": {
                "raw": "Supertrend Buy/Sell only",
                "struct": "Buy/Sell filtered by structure trend",
                "struct_zone": "struct + Buy in Discount / Sell in Premium",
            },
        },
    }
    (OUT / "universe.json").write_text(json.dumps(universe, indent=2), encoding="utf-8")
    print(f"5m top{TOP_N}: {', '.join(top5)}")
    print(f"15m top{TOP_N}: {', '.join(top15)}")

    rows = []
    trades_all: list[Trade] = []
    by_symbol = {}

    for tf, symbols in (("5m", top5), ("15m", top15)):
        for sym in symbols:
            print(f"  {sym} {tf} ...", flush=True)
            try:
                r = run_symbol(sym, tf)
            except Exception as e:
                r = {"symbol": sym, "tf": tf, "error": str(e)}
            trades = r.pop("_trades", [])
            trades_all.extend(trades)
            by_symbol[f"{sym}_{tf}"] = r
            if "error" in r:
                print(f"    ERR {r['error']}")
                continue
            for mode, md in r["modes"].items():
                ft = md["flip_trades"]
                rows.append(
                    {
                        "symbol": sym,
                        "tf": tf,
                        "mode": mode,
                        "bars": r["bars"],
                        "buys": md["counts"]["buy"],
                        "sells": md["counts"]["sell"],
                        "bos": md["counts"]["bos_up"] + md["counts"]["bos_dn"],
                        "choch": md["counts"]["choch_up"] + md["counts"]["choch_dn"],
                        "trades": ft["n"],
                        "winrate": ft["winrate"],
                        "avg_ret_pct": ft["avg_ret"],
                        "sum_ret_pct": ft["sum_ret"],
                        "avg_mfe": ft["avg_mfe"],
                        "avg_mae": ft["avg_mae"],
                    }
                )
                print(
                    f"    {mode}: trades={ft['n']} wr={ft['winrate']} "
                    f"avg={ft['avg_ret']}% sum={ft['sum_ret']}%"
                )

    summary = {
        "universe": universe,
        "by_tf_mode": {},
        "notes": [
            "Signals only on bar close (no intrabar). Matches Pine Open_SMC_Flow.pine.",
            "Flip sim: enter on Buy/Sell close, exit opposite or max_hold; fee 6bps/side.",
            "fwd_*bars: close-to-close after N bars without stop — diagnostic only.",
        ],
    }
    df_rows = pd.DataFrame(rows)
    if not df_rows.empty:
        for (tf, mode), g in df_rows.groupby(["tf", "mode"]):
            summary["by_tf_mode"][f"{tf}|{mode}"] = {
                "symbols": int(g["symbol"].nunique()),
                "trades": int(g["trades"].sum()),
                "avg_winrate": round(float(g["winrate"].mean()), 4) if g["winrate"].notna().any() else None,
                "avg_ret_pct": round(float(g["avg_ret_pct"].mean()), 4) if g["avg_ret_pct"].notna().any() else None,
                "median_sum_ret_pct": round(float(g["sum_ret_pct"].median()), 4)
                if g["sum_ret_pct"].notna().any()
                else None,
                "avg_mfe": round(float(g["avg_mfe"].mean()), 4) if g["avg_mfe"].notna().any() else None,
                "avg_mae": round(float(g["avg_mae"].mean()), 4) if g["avg_mae"].notna().any() else None,
            }

    (OUT / "by_symbol.json").write_text(json.dumps(by_symbol, indent=2), encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    df_rows.to_csv(OUT / "by_symbol_mode.csv", index=False)
    if trades_all:
        pd.DataFrame([asdict(t) for t in trades_all]).to_csv(OUT / "trades.csv", index=False)

    lines = [
        "# Open SMC Flow — backtest top-25 volatility",
        "",
        f"Generated: {universe['generated_at']} UTC",
        "",
        "## Universe",
        "",
        f"- 5m: {', '.join(top5)}",
        f"- 15m: {', '.join(top15)}",
        "",
        "## Modes",
        "",
        "- **raw** — Supertrend Buy/Sell only",
        "- **struct** — + filter by structure trend (default in Pine)",
        "- **struct_zone** — + Buy only Discount / Sell only Premium",
        "",
        "## Aggregate (flip sim, fees 6bps/side)",
        "",
        "| TF | Mode | Syms | Trades | Avg WR | Avg ret% | Median sum% | Avg MFE% | Avg MAE% |",
        "|----|------|------|--------|--------|----------|-------------|----------|----------|",
    ]
    for key, v in sorted(summary["by_tf_mode"].items()):
        tf, mode = key.split("|")
        lines.append(
            f"| {tf} | {mode} | {v['symbols']} | {v['trades']} | {v['avg_winrate']} | "
            f"{v['avg_ret_pct']} | {v['median_sum_ret_pct']} | {v['avg_mfe']} | {v['avg_mae']} |"
        )
    lines += [
        "",
        "## How to read",
        "",
        "- Avg WR / Avg ret% — среднее по символам, не pooled.",
        "- Median sum% — медиана суммарного PnL% по символу (устойчивее к outliers).",
        "- MFE/MAE — максимальный благоприятный/неблагоприятный ход внутри сделки.",
        "",
        "Pine: `research/smc_flow/Open_SMC_Flow.pine`",
        "CSV: `research/smc_flow/out/`",
    ]
    (OUT / "RESULTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\nDone →", OUT / "RESULTS.md")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
