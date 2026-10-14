/* LearnScalpUiAgent — вкладка «Скальпинг»: последовательный курс + видео */
(function (global) {
  'use strict'

  var LESSONS = [
    {
      id: 'intro',
      title: '1. Что такое скальпинг',
      body: [
        'Скальпинг — короткие сделки внутри дня: вход и выход за секунды/минуты, цель — много мелких движений цены.',
        'В крипте это обычно стакан (DOM) + лента сделок + короткий график, а не «индикаторы на дневке».',
        'Главное отличие от свинг-трейдинга: скорость исполнения, узкий стоп, контроль комиссий и проскальзывания.',
      ],
      links: [
        {
          label: 'Статья: скальпинг на Binance Futures (CScalp)',
          href: 'https://fsr-develop.com/blog-cscalp/tpost/0et2hac811-how-to-scalp-binance-futures-a-winning-s',
        },
        {
          label: 'Видео-поиск: «скальпинг криптовалют основы»',
          href: 'https://www.youtube.com/results?search_query=%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3+%D0%BA%D1%80%D0%B8%D0%BF%D1%82%D0%BE%D0%B2%D0%B0%D0%BB%D1%8E%D1%82+%D0%BE%D1%81%D0%BD%D0%BE%D0%B2%D1%8B',
        },
        {
          label: 'Канал CScalp TV (мастер-классы / стримы)',
          href: 'https://www.youtube.com/@CScalpTV',
        },
      ],
    },
    {
      id: 'markets',
      title: '2. Spot vs Futures на криптобиржах',
      body: [
        'Spot — покупка/продажа актива. Нет плеча в классическом смысле, риск ограничен капиталом позиции.',
        'Futures (USD-M / linear) — контракты с плечом, фандингом и ликвидациями. Для скальпа чаще используют фьючи из‑за скорости и маржи.',
        'Для учёбы начинайте с высокой ликвидности: BTCUSDT / ETHUSDT. На тонких альтах один «кит» двигает цену на проценты.',
      ],
      links: [
        {
          label: 'Видео-поиск: «Binance Futures для начинающих»',
          href: 'https://www.youtube.com/results?search_query=Binance+Futures+%D0%B4%D0%BB%D1%8F+%D0%BD%D0%B0%D1%87%D0%B8%D0%BD%D0%B0%D1%8E%D1%89%D0%B8%D1%85',
        },
        {
          label: 'Видео-поиск: «Bybit linear скальпинг»',
          href: 'https://www.youtube.com/results?search_query=Bybit+linear+%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3',
        },
      ],
    },
    {
      id: 'dom',
      title: '3. Биржевой стакан (DOM / order book)',
      body: [
        'Стакан показывает неисполненные лимитные заявки: BID (покупка) и ASK (продажа) по ценам.',
        'Лучший BID — самая высокая цена покупки; лучший ASK — самая низкая цена продажи. Между ними — спред.',
        'Крупные объёмы на уровне называют плотностями / стенками (walls). Они часто совпадают с поддержкой/сопротивлением, но могут быть спуфом (сняли заявку).',
        'В sCalp стенки подсвечиваются бейджем WALL / BIG и порогом в $ — смотрите Настройки → Стакан.',
      ],
      links: [
        {
          label: 'Статья: как работает стакан Binance (CScalp / FSR)',
          href: 'https://fsr-develop.ru/blog_cscalp/tpost/abfxuua8s1-kak-rabotaet-birzhevoi-stakan-binance',
        },
        {
          label: 'Статья: DOM для скальпинга на криптобиржах (Incrypted)',
          href: 'https://incrypted.com/en/how-to-use-depth-of-market-for-scalping-on-crypto-exchanges/',
        },
        {
          label: 'Видео-поиск: «биржевой стакан DOM скальпинг»',
          href: 'https://www.youtube.com/results?search_query=%D0%B1%D0%B8%D1%80%D0%B6%D0%B5%D0%B2%D0%BE%D0%B9+%D1%81%D1%82%D0%B0%D0%BA%D0%B0%D0%BD+DOM+%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3',
        },
      ],
    },
    {
      id: 'read',
      title: '4. Как читать плотности и поглощение',
      body: [
        'Стена BID может «держать» цену (отскок вверх), стена ASK — давить вниз. Но важнее реакция: стену снимают или её «съедают» маркет-ордерами.',
        'Поглощение (absorption): крупный лимит стоит, а агрессивные сделки его размывают — часто сигнал к импульсу после пробоя.',
        'Спуфинг: крупный объём появляется и исчезает без исполнения. Не торгуйте «стенку» вслепую — смотрите ленту и график.',
        'В sCalp Telegram-алерты могут слать сообщения о крупных стенках/сделках (Настройки → Telegram).',
      ],
      links: [
        {
          label: 'Видео: DOM execution / скальп от стакана (EN)',
          href: 'https://www.youtube.com/watch?v=L3fCKxkW3sg',
        },
        {
          label: 'Видео-поиск: «плотности в стакане скальпинг»',
          href: 'https://www.youtube.com/results?search_query=%D0%BF%D0%BB%D0%BE%D1%82%D0%BD%D0%BE%D1%81%D1%82%D0%B8+%D0%B2+%D1%81%D1%82%D0%B0%D0%BA%D0%B0%D0%BD%D0%B5+%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3',
        },
        {
          label: 'Статья: скальпинг DOM для новичков (Bikotrading)',
          href: 'https://bikotrading.com/how-to-trade-the-dom-without-risk-scalping-for-beginners',
        },
      ],
    },
    {
      id: 'orders',
      title: '5. Лимит vs маркет, клики в стакане',
      body: [
        'Лимит — вы ставите цену и ждёте. Контроль цены, но нет гарантии исполнения.',
        'Маркет — исполнение сразу по доступной ликвидности. Быстрее, но хуже цена при тонком стакане.',
        'В sCalp: ЛКМ по уровню = LIMIT, Shift+ЛКМ = MARKET (после выключения «Только просмотр» и ключей API).',
        'Ask-сторона / клик sell — продажа; Bid / buy — покупка. Рабочий объём — слоты внизу стакана.',
      ],
      links: [
        {
          label: 'Видео-поиск: «лимитный ордер vs маркет Binance»',
          href: 'https://www.youtube.com/results?search_query=%D0%BB%D0%B8%D0%BC%D0%B8%D1%82%D0%BD%D1%8B%D0%B9+%D0%BE%D1%80%D0%B4%D0%B5%D1%80+vs+%D0%BC%D0%B0%D1%80%D0%BA%D0%B5%D1%82+Binance',
        },
        {
          label: 'Видео-поиск: «настройка рабочего места скальпера CScalp»',
          href: 'https://www.youtube.com/results?search_query=%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B0+%D1%80%D0%B0%D0%B1%D0%BE%D1%87%D0%B5%D0%B3%D0%BE+%D0%BC%D0%B5%D1%81%D1%82%D0%B0+%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B5%D1%80%D0%B0+CScalp',
        },
      ],
    },
    {
      id: 'risk',
      title: '6. Риск, комиссии, дисциплина',
      body: [
        'Скальп «убивают» комиссии и проскальзывание. Считайте round-trip fee до входа.',
        'Размер позиции: риск на сделку обычно доли процента депозита. Стоп — обязателен (мысленный или серверный).',
        'Не увеличивайте объём после серии убытков. Ведите журнал: вход, стена/импульс, результат.',
        'На фьючах следите за плечом и ликвидацией — для учёбы хватает ×2…×5, не ×50.',
      ],
      links: [
        {
          label: 'Видео-поиск: «риск менеджмент скальпинг крипто»',
          href: 'https://www.youtube.com/results?search_query=%D1%80%D0%B8%D1%81%D0%BA+%D0%BC%D0%B5%D0%BD%D0%B5%D0%B4%D0%B6%D0%BC%D0%B5%D0%BD%D1%82+%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3+%D0%BA%D1%80%D0%B8%D0%BF%D1%82%D0%BE',
        },
        {
          label: 'Бесплатный курс скальпинга (программа CScalp)',
          href: 'https://cscalp.net/kurs-obuchenija-skalpingu',
        },
      ],
    },
    {
      id: 'practice',
      title: '7. Практика в sCalp (этот терминал)',
      body: [
        'Запуск: python3 local/serve.py → http://127.0.0.1:4173/local/',
        'Смотрите Spot и Futures рядом, график сверху, история тикеров слева.',
        'Наблюдайте WALL/BIG, спред, imbalance. Включите Telegram-алерты на крупные стенки/сделки.',
        'Сначала paper/testnet и «Только просмотр». Торговлю включайте только с отдельными API-ключами без withdraw.',
        'Если стакан пишет ошибку HTTP 418 — Binance временно режет IP; подождите 1–2 минуты (терминал сам делает паузу).',
      ],
      links: [
        {
          label: 'Видео-поиск: «скальпинг Binance стакан обучение»',
          href: 'https://www.youtube.com/results?search_query=%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3+Binance+%D1%81%D1%82%D0%B0%D0%BA%D0%B0%D0%BD+%D0%BE%D0%B1%D1%83%D1%87%D0%B5%D0%BD%D0%B8%D0%B5',
        },
        {
          label: 'CScalp TV — плейлисты / стримы',
          href: 'https://www.youtube.com/@CScalpTV/videos',
        },
      ],
    },
    {
      id: 'next',
      title: '8. Куда углубляться дальше',
      body: [
        'Связка: стакан + лента (time & sales) + кластеры/футпринт — «трёхмерная» картина потока ордеров.',
        'Смотрите живые разборы на CScalp TV и ведите свои записи сделок.',
        'Не копируйте чужие сигналы в скальпе: задержка убивает edge. Учитесь процессу, не входам «вдогонку».',
      ],
      links: [
        {
          label: 'Видео-поиск: «футпринт кластеры скальпинг»',
          href: 'https://www.youtube.com/results?search_query=%D1%84%D1%83%D1%82%D0%BF%D1%80%D0%B8%D0%BD%D1%82+%D0%BA%D0%BB%D0%B0%D1%81%D1%82%D0%B5%D1%80%D1%8B+%D1%81%D0%BA%D0%B0%D0%BB%D1%8C%D0%BF%D0%B8%D0%BD%D0%B3',
        },
        {
          label: 'Видео-поиск: «лента сделок time and sales крипто»',
          href: 'https://www.youtube.com/results?search_query=%D0%BB%D0%B5%D0%BD%D1%82%D0%B0+%D1%81%D0%B4%D0%B5%D0%BB%D0%BE%D0%BA+time+and+sales+%D0%BA%D1%80%D0%B8%D0%BF%D1%82%D0%BE',
        },
        {
          label: 'Материалы курса / комьюнити CScalp',
          href: 'https://support.fsr-develop.ru/communities/46/topics/4445-besplatnyij-kurs-skalpinga2139.html?lang=ru',
        },
      ],
    },
  ]

  function LearnScalpUiAgent(bus, root) {
    this.bus = bus
    this.root = root
    this.step = 0
    try {
      this.step = Math.max(0, Math.min(LESSONS.length - 1, Number(localStorage.getItem('scalp-learn-step')) || 0))
    } catch (e) {}
    this._bind()
  }

  LearnScalpUiAgent.prototype._bind = function () {
    var self = this
    this.bus.on('ui:set-page', function (page) {
      self._show(page === 'learn')
      if (page === 'learn') self.render()
    })
  }

  LearnScalpUiAgent.prototype._show = function (on) {
    if (this.root) this.root.hidden = !on
  }

  LearnScalpUiAgent.prototype._saveStep = function () {
    try {
      localStorage.setItem('scalp-learn-step', String(this.step))
    } catch (e) {}
  }

  LearnScalpUiAgent.prototype.render = function () {
    if (!this.root) return
    var lesson = LESSONS[this.step] || LESSONS[0]
    var self = this
    var nav = LESSONS.map(function (L, i) {
      return (
        '<button type="button" class="learn-nav-item' +
        (i === self.step ? ' active' : '') +
        (i < self.step ? ' done' : '') +
        '" data-learn-goto="' +
        i +
        '"><span class="learn-num">' +
        (i + 1) +
        '</span>' +
        esc(L.title.replace(/^\d+\.\s*/, '')) +
        '</button>'
      )
    }).join('')

    var paras = lesson.body
      .map(function (p) {
        return '<p>' + esc(p) + '</p>'
      })
      .join('')

    var links = lesson.links
      .map(function (l) {
        return (
          '<a class="learn-link" href="' +
          esc(l.href) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(l.label) +
          ' ↗</a>'
        )
      })
      .join('')

    this.root.innerHTML = [
      '<header class="learn-head">',
      '  <div>',
      '    <h1>Скальпинг на криптобиржах</h1>',
      '    <p class="learn-sub">Последовательный мини-курс · шаг ' +
        (this.step + 1) +
        ' из ' +
        LESSONS.length +
        '</p>',
      '  </div>',
      '  <button type="button" class="btn ghost" data-learn-act="trade">← К торговле</button>',
      '</header>',
      '<div class="learn-layout">',
      '  <aside class="learn-nav">' + nav + '</aside>',
      '  <article class="learn-article">',
      '    <h2>' + esc(lesson.title) + '</h2>',
      paras,
      '    <h3>Материалы и видео</h3>',
      '    <div class="learn-links">' + links + '</div>',
      '    <footer class="learn-pager">',
      '      <button type="button" class="btn ghost" data-learn-act="prev"' +
        (this.step === 0 ? ' disabled' : '') +
        '>← Назад</button>',
      '      <button type="button" class="btn primary" data-learn-act="next">' +
        (this.step >= LESSONS.length - 1 ? 'В начало' : 'Далее →') +
        '</button>',
      '    </footer>',
      '  </article>',
      '</div>',
    ].join('')

    this.root.onclick = function (e) {
      var goto = e.target.closest('[data-learn-goto]')
      if (goto) {
        self.step = Number(goto.getAttribute('data-learn-goto')) || 0
        self._saveStep()
        self.render()
        return
      }
      var act = e.target.closest('[data-learn-act]')
      if (!act) return
      var a = act.getAttribute('data-learn-act')
      if (a === 'trade') self.bus.emit('ui:set-page', 'trade')
      if (a === 'prev' && self.step > 0) {
        self.step--
        self._saveStep()
        self.render()
      }
      if (a === 'next') {
        self.step = self.step >= LESSONS.length - 1 ? 0 : self.step + 1
        self._saveStep()
        self.render()
      }
    }
  }

  LearnScalpUiAgent.prototype.start = function () {
    this._show(false)
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  global.Scalp.LearnScalpUiAgent = LearnScalpUiAgent
  global.Scalp.LEARN_SCALP_LESSONS = LESSONS
})(typeof window !== 'undefined' ? window : globalThis)
