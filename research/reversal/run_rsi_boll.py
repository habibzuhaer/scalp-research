#!/usr/bin/env python3
"""RSI + Bollinger long backtest on cached Bybit 5m/15m bars."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "out" / "rsi_boll"
FEE = 0.0006  # per side
RSI_LEN = 14
BB_LEN = 20
BB_STD = 2.0
RSI_BUY = 27
RSI_SELL = 82
STREAK = 5
NEAR_FRAC = 0.15  # "вблизи": within 15% of band width from lower/upper
TAKE_PCT = 0.016
PARTIAL = 0.5
MAX_HOLD = {"5m": 48, "15m": 32}  # ~4h / ~8h


@dataclass
class Trade:
    symbol: str
    tf: str
    stop_mode: str
    entry_ts: int
    exit_ts: int
    entry: float
    exit_avg: float
    stop: float
    bars_held: int
    reason: str
    ret: float
    r_multiple: float
    hit_partial: int


def rsi_series(close: pd.Series, n: int = RSI_LEN) -> pd.Series:
    d = close.diff()
    gain = d.clip(lower=0)
    loss = (-d).clip(lower=0)
    avg_g = gain.ewm(alpha=1 / n, min_periods=n, adjust=False).mean()
    avg_l = loss.ewm(alpha=1 / n, min_periods=n, adjust=False).mean()
    rs = avg_g / avg_l.replace(0, 1e-12)
    return 100 - (100 / (1 + rs))


def boll(close: pd.Series, n: int = BB_LEN, k: float = BB_STD):
    mid = close.rolling(n, min_periods=n).mean()
    std = close.rolling(n, min_periods=n).std(ddof=0)
    return mid, mid + k * std, mid - k * std


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    h, l, c = df["high"], df["low"], df["close"]
    prev = c.shift(1)
    tr = pd.concat([(h - l), (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(n, min_periods=n).mean()


def near_lower(low, close, lower, upper, mid) -> bool:
    width = upper - lower
    if pd.isna(lower) or width <= 0:
        return False
    # касание или вблизи нижней: low/close не выше lower + 15% ширины
    thr = lower + NEAR_FRAC * width
    return float(low) <= thr or float(close) <= thr


def near_upper(high, close, lower, upper) -> bool:
    width = upper - lower
    if pd.isna(upper) or width <= 0:
        return False
    thr = upper - NEAR_FRAC * width
    return float(high) >= thr or float(close) >= thr


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy().reset_index(drop=True)
    out["rsi"] = rsi_series(out["close"])
    mid, up, lo = boll(out["close"])
    out["bb_mid"], out["bb_up"], out["bb_lo"] = mid, up, lo
    out["atr"] = atr(out)
    buy_ok = []
    sell_ok = []
    for i in range(len(out)):
        r = out.at[i, "rsi"]
        if pd.isna(r) or pd.isna(out.at[i, "bb_lo"]):
            buy_ok.append(False)
            sell_ok.append(False)
            continue
        buy_ok.append(
            r <= RSI_BUY
            and near_lower(
                out.at[i, "low"],
                out.at[i, "close"],
                out.at[i, "bb_lo"],
                out.at[i, "bb_up"],
                out.at[i, "bb_mid"],
            )
        )
        sell_ok.append(
            r >= RSI_SELL
            and near_upper(
                out.at[i, "high"],
                out.at[i, "close"],
                out.at[i, "bb_lo"],
                out.at[i, "bb_up"],
            )
        )
    out["buy_bar"] = buy_ok
    out["sell_bar"] = sell_ok
    # streak ending at i
    b_streak = [0] * len(out)
    s_streak = [0] * len(out)
    for i in range(len(out)):
        b_streak[i] = (b_streak[i - 1] + 1) if out.at[i, "buy_bar"] else 0
        s_streak[i] = (s_streak[i - 1] + 1) if out.at[i, "sell_bar"] else 0
    out["buy_streak"] = b_streak
    out["sell_streak"] = s_streak
    return out


def make_stop(mode: str, entry: float, signal_i: int, df: pd.DataFrame) -> float | None:
    if mode == "pct_1.2":
        return entry * (1 - 0.012)
    if mode == "pct_1.6":
        return entry * (1 - 0.016)
    if mode == "atr_1.2":
        a = float(df.at[signal_i, "atr"])
        if pd.isna(a) or a <= 0:
            return None
        return entry - 1.2 * a
    if mode == "struct":
        # min low over the last STREAK buy bars ending at signal_i
        start = max(0, signal_i - STREAK + 1)
        lo = float(df.loc[start : signal_i, "low"].min())
        a = df.at[signal_i, "atr"]
        buf = float(a) * 0.1 if pd.notna(a) and a > 0 else lo * 0.001
        return lo - buf
    raise ValueError(mode)


def simulate(df: pd.DataFrame, signal_i: int, mode: str, symbol: str, tf: str) -> Trade | None:
    if signal_i + 1 >= len(df):
        return None
    entry_i = signal_i + 1
    entry = float(df.at[entry_i, "open"])
    stop = make_stop(mode, entry, signal_i, df)
    if stop is None or stop <= 0 or stop >= entry:
        return None
    risk = entry - stop
    if risk / entry < 0.002 or risk / entry > 0.12:
        return None

    take = entry * (1 + TAKE_PCT)
    max_hold = MAX_HOLD[tf]
    hit_partial = False
    exit_parts: list[tuple[float, float]] = []  # (weight, price)
    remaining = 1.0
    exit_i = entry_i
    reason = "time"

    for j in range(entry_i, min(len(df), entry_i + max_hold)):
        lo = float(df.at[j, "low"])
        hi = float(df.at[j, "high"])
        # stop first (conservative same-bar)
        if lo <= stop:
            exit_parts.append((remaining, stop))
            remaining = 0.0
            exit_i, reason = j, "stop"
            break
        if not hit_partial and hi >= take:
            exit_parts.append((PARTIAL, take))
            remaining -= PARTIAL
            hit_partial = True
            # continue with rest
        if remaining > 0 and int(df.at[j, "sell_streak"]) >= STREAK and j > entry_i:
            # exit remainder on next open conceptually → use close of signal bar (conservative)
            px = float(df.at[j, "close"])
            exit_parts.append((remaining, px))
            remaining = 0.0
            exit_i, reason = j, "boll_rsi_exit"
            break
        exit_i = j

    if remaining > 0:
        px = float(df.at[exit_i, "close"])
        exit_parts.append((remaining, px))
        reason = "partial_then_time" if hit_partial else "time"

    # weighted exit + fees: full notional in, then each partial out
    exit_avg = sum(w * p for w, p in exit_parts)
    # fees: entry full + exit each part
    fee_cost = FEE + FEE  # approx on full round-trip notional
    ret = (exit_avg / entry - 1.0) - fee_cost
    r_mult = ((exit_avg - entry) / risk) - (fee_cost * entry / risk)
    return Trade(
        symbol=symbol,
        tf=tf,
        stop_mode=mode,
        entry_ts=int(df.at[entry_i, "timestamp"]),
        exit_ts=int(df.at[exit_i, "timestamp"]),
        entry=entry,
        exit_avg=exit_avg,
        stop=stop,
        bars_held=exit_i - entry_i + 1,
        reason=reason if not hit_partial or reason != "time" else (
            "partial_then_time" if hit_partial and reason == "time" else reason
        ),
        ret=ret,
        r_multiple=r_mult,
        hit_partial=1 if hit_partial else 0,
    )


def backtest(df: pd.DataFrame, symbol: str, tf: str, mode: str) -> list[Trade]:
    trades: list[Trade] = []
    cooldown = -1
    for i in range(BB_LEN + RSI_LEN + 2, len(df) - 2):
        if i < cooldown:
            continue
        if int(df.at[i, "buy_streak"]) < STREAK:
            continue
        # fire only on the bar where streak first reaches STREAK (avoid re-entry every bar)
        if i > 0 and int(df.at[i - 1, "buy_streak"]) >= STREAK:
            continue
        t = simulate(df, i, mode, symbol, tf)
        if t is None:
            continue
        trades.append(t)
        cooldown = i + 3
    return trades


def summarize(trades: list[Trade]) -> list[dict]:
    if not trades:
        return []
    df = pd.DataFrame([asdict(t) for t in trades])
    rows = []
    for (tf, mode), g in df.groupby(["tf", "stop_mode"]):
        rows.append(
            {
                "tf": tf,
                "stop_mode": mode,
                "trades": int(len(g)),
                "winrate": round(float((g["ret"] > 0).mean()), 4),
                "avg_ret": round(float(g["ret"].mean()), 5),
                "sum_ret": round(float(g["ret"].sum()), 4),
                "avg_R": round(float(g["r_multiple"].mean()), 3),
                "sum_R": round(float(g["r_multiple"].sum()), 1),
                "partial_rate": round(float(g["hit_partial"].mean()), 3),
                "exit_stop": int((g["reason"] == "stop").sum()),
                "exit_boll_rsi": int((g["reason"] == "boll_rsi_exit").sum()),
                "exit_time": int(g["reason"].isin(["time", "partial_then_time"]).sum()),
                "avg_hold": round(float(g["bars_held"].mean()), 1),
                "symbols": int(g["symbol"].nunique()),
                "avg_stop_pct": round(float((1 - g["stop"] / g["entry"]).mean() * 100), 3),
            }
        )
    rows.sort(key=lambda x: x["sum_R"], reverse=True)
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(DATA.glob("*_5m.csv")) + sorted(DATA.glob("*_15m.csv"))
    # only vol-universe style: all cached pairs
    modes = ["pct_1.2", "pct_1.6", "atr_1.2", "struct"]
    all_trades: list[Trade] = []
    used = []
    for path in files:
        name = path.stem  # SYM_5m
        if "_" not in name:
            continue
        sym, tf = name.rsplit("_", 1)
        if tf not in ("5m", "15m"):
            continue
        df = pd.read_csv(path)
        if len(df) < 400:
            continue
        prep = prepare(df)
        used.append({"symbol": sym, "tf": tf, "bars": len(df)})
        print(f"OK {sym} {tf} n={len(df)}")
        for mode in modes:
            all_trades.extend(backtest(prep, sym, tf, mode))

    if all_trades:
        pd.DataFrame([asdict(t) for t in all_trades]).to_csv(OUT / "trades.csv", index=False)
    summary = summarize(all_trades)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (OUT / "universe.json").write_text(json.dumps(used, indent=2), encoding="utf-8")

    rules = f"""# RSI + Bollinger long

- RSI({RSI_LEN}), Boll({BB_LEN}, {BB_STD}σ)
- Buy: RSI≤{RSI_BUY} AND near lower band (≥{STREAK} bars streak), near={NEAR_FRAC:.0%} of band width
- Entry: open next bar after streak hits {STREAK}
- Take 1: +{TAKE_PCT*100:.1f}% on {PARTIAL*100:.0f}% size
- Remainder: exit on RSI≥{RSI_SELL} near upper ≥{STREAK} bars, else time stop
- Stop modes: pct_1.2, pct_1.6, atr_1.2, struct
- Fee {FEE*100:.2f}% per side
"""
    (OUT / "RULES.md").write_text(rules, encoding="utf-8")

    print("\n=== SUMMARY by sum_R ===")
    for r in summary:
        print(
            f"{r['tf']:4s} {r['stop_mode']:8s} n={r['trades']:4d} wr={r['winrate']*100:5.1f}% "
            f"avgR={r['avg_R']:+.3f} sumR={r['sum_R']:+.1f} "
            f"partial={r['partial_rate']*100:4.1f}% "
            f"SL/Boll/Time={r['exit_stop']}/{r['exit_boll_rsi']}/{r['exit_time']} "
            f"stop%≈{r['avg_stop_pct']:.2f}"
        )


if __name__ == "__main__":
    main()
