# Open SMC Flow — backtest top-25 volatility

Generated: 2026-10-03 15:03 UTC

## Universe

- 5m: ONGUSDT, BTRUSDT, VELVETUSDT, ARIAUSDT, TACUSDT, CASHCATUSDT, TMXUSDT, AKEUSDT, AGIUSDT, BICOUSDT, NESAUSDT, ONTUSDT, TUTUSDT, EDENUSDT, MOVRUSDT, BMTUSDT, MAGMAUSDT, HEIUSDT, SCRTUSDT, CYSUSDT, ESUSDT, BTWUSDT, PORTALUSDT, PUMPBTCUSDT, CLOUSDT
- 15m: VELVETUSDT, TACUSDT, BTRUSDT, AGIUSDT, CASHCATUSDT, BMTUSDT, BTWUSDT, ONGUSDT, TUTUSDT, PORTALUSDT, HFTUSDT, SCRTUSDT, NESAUSDT, BEATUSDT, HANAUSDT, SKYAI1USDT, ZROUSDT, ACEUSDT, USUSDT, HEMIUSDT, STORJUSDT, VANRYUSDT, CYSUSDT, EDENUSDT, SQDUSDT

## Modes

- **raw** — Supertrend Buy/Sell only
- **struct** — + filter by structure trend (default in Pine)
- **struct_zone** — + Buy only Discount / Sell only Premium

## Aggregate (flip sim, fees 6bps/side)

| TF | Mode | Syms | Trades | Avg WR | Avg ret% | Median sum% | Avg MFE% | Avg MAE% |
|----|------|------|--------|--------|----------|-------------|----------|----------|
| 15m | raw | 22 | 3246 | 0.3877 | -0.0043 | 2.378 | 5.0877 | -3.4491 |
| 15m | struct | 22 | 1289 | 0.4172 | -0.0613 | -10.6829 | 5.3187 | -4.5207 |
| 15m | struct_zone | 22 | 56 | 0.2651 | -1.0845 | -1.8991 | 3.5506 | -4.3677 |
| 5m | raw | 22 | 5864 | 0.3119 | -0.2724 | -81.0405 | 2.4649 | -1.5873 |
| 5m | struct | 22 | 2041 | 0.4063 | -0.1665 | -18.6365 | 2.8838 | -2.4203 |
| 5m | struct_zone | 22 | 95 | 0.3169 | -0.6975 | -1.4701 | 2.4314 | -2.5778 |

## How to read

- Avg WR / Avg ret% — среднее по символам, не pooled.
- Median sum% — медиана суммарного PnL% по символу (устойчивее к outliers).
- MFE/MAE — максимальный благоприятный/неблагоприятный ход внутри сделки.

Pine: `research/smc_flow/Open_SMC_Flow.pine`
CSV: `research/smc_flow/out/`
