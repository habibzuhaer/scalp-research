# sCalp

Биржевой стакан в стиле CScalp: live depth, API-настройки, модули-агенты, локальная HTML-документация.

## Быстрый старт (HTML local + агенты)

Полная шпаргалка по всем частям проекта: **[ЗАПУСК.md](./ЗАПУСК.md)**

```bash
cd SCALP
./ЗАПУСК.sh
```

| Что | URL |
|-----|-----|
| Панель запуска | http://127.0.0.1:4173/ |
| Терминал Spot+Futures | http://127.0.0.1:4173/local/ |
| Документация | http://127.0.0.1:4173/docs/ |

## Возможности

- Два DOM: Spot + Futures (биржа, тикер, сжатие)
- График: свечи, SMA/EMA/BB/VWAP/RSI/Volume
- Инструменты: курсор, горизонталь, тренд
- Профиль: имя, layout, автосохранение
- История тикеров (клик — открыть снова)

Настройки → вкладки **Тикеры / График / Профиль / История**.


## Модули-агенты (`local/js/agents/`)

| Агент | Роль |
|-------|------|
| **Bus** | Event bus между модулями |
| **Config** | Пресеты бирж, format, storage |
| **ApiAgent** | Биржа, REST/WS, ключи, тест |
| **SettingsAgent** | DOM/торговля, символ, сжатие |
| **MarketAgent** | Depth REST + WebSocket |
| **DomAgent** | Рендер стакана |
| **SettingsUiAgent** | Модалка настроек |

Полное описание: [docs/agents.html](docs/agents.html), события: [docs/events.html](docs/events.html).

## React / Vite (`src/`)

```bash
npm install
npm run dev
```

Те же концепции (API settings, depth hook). Каноничная агентная модель — в `local/`.

## Документация (оглавление)

1. [Обзор](docs/index.html)
2. [Архитектура](docs/architecture.html)
3. [Агенты](docs/agents.html)
4. [API и биржи](docs/api.html)
5. [Стакан и настройки](docs/dom.html)
6. [События Bus](docs/events.html)
7. [Запуск local](docs/local.html)
