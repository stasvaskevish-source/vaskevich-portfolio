/**
 * IntroPlayer — самодостаточный модуль интро‑видео поверх лендинга.
 * Без зависимостей. ES6.
 *
 * @typedef {Object} IntroOptions
 * @property {string} [webmSrc]        Путь к WebM (VP9).
 * @property {string} [mp4Src]         Путь к MP4 (H.264 yuv420p).
 * @property {string} [posterSrc]      Путь к постеру.
 * @property {number} [durationMs]     Длительность видео, мс (для fallback‑таймера).
 * @property {boolean}[showOncePerSession] Показывать 1 раз за сессию (sessionStorage).
 * @property {number} [ttlHours]       TTL в localStorage; 0 — не использовать TTL.
 * @property {string} [storageKey]     Ключ хранилища.
 * @property {'skip'|'poster'|'play'} [reducedMotionMode] Поведение при reduced motion.
 * @property {boolean}[transparent]    RGBA‑видео; на iOS при true интро выключается.
 * @property {string} [overlaySelector] Селектор оверлея.
 * @property {string} [siteSelector]    Селектор основного контента.
 * @property {string} [restoreFocusSelector] Куда вернуть фокус после интро.
 * @property {Function}[onDone]        Колбэк после завершения.
 */

class IntroPlayer {
  /** @param {IntroOptions} [options] */
  constructor(options = {}) {
    /** @type {Required<IntroOptions>} */
    this.opts = Object.assign({
      webmSrc: 'intro.webm',
      mp4Src: 'intro.mp4',
      posterSrc: 'intro-poster.jpg',
      durationMs: 2000,
      showOncePerSession: true,
      ttlHours: 24,
      storageKey: 'introSeen',
      reducedMotionMode: 'skip',
      transparent: false,
      overlaySelector: '#intro-overlay',
      siteSelector: '#site',
      restoreFocusSelector: '',
      onDone: () => {}
    }, options);

    this.overlay = this.opts.overlaySelector ? document.querySelector(this.opts.overlaySelector) : null;
    this.site = this.opts.siteSelector ? document.querySelector(this.opts.siteSelector) : null;
    this.video = this.overlay ? this.overlay.querySelector('video') : null;
    this.skipBtn = this.overlay ? this.overlay.querySelector('.intro-skip') : null;

    this._fallbackTimer = null;
    this._done = false;         // защита от двойного завершения
    this._started = false;

    // Бинды, чтобы можно было снять слушатели в destroy().
    this._onEnded = this._onEnded.bind(this);
    this._onError = this._onError.bind(this);
    this._onSkipClick = this.skip.bind(this);
    this._onKeydown = this._onKeydown.bind(this);
  }

  /* ---------- Утилиты ---------- */

  _isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
      // iPadOS 13+ маскируется под Mac
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  _prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Уже видели интро? (session + опциональный TTL). */
  _alreadySeen() {
    try {
      if (this.opts.showOncePerSession &&
          sessionStorage.getItem(this.opts.storageKey)) {
        return true;
      }
      if (this.opts.ttlHours > 0) {
        const raw = localStorage.getItem(this.opts.storageKey);
        if (raw) {
          const ts = parseInt(raw, 10);
          const ageMs = Date.now() - ts;
          if (ageMs < this.opts.ttlHours * 3600 * 1000) return true;
        }
      }
    } catch (_) { /* storage может быть недоступен (private mode) */ }
    return false;
  }

  _markSeen() {
    try {
      if (this.opts.showOncePerSession) {
        sessionStorage.setItem(this.opts.storageKey, '1');
      }
      if (this.opts.ttlHours > 0) {
        localStorage.setItem(this.opts.storageKey, String(Date.now()));
      }
    } catch (_) { /* ignore */ }
  }

  /* ---------- Публичный API ---------- */

  /**
   * Запустить интро, если нужно. Иначе — сразу показать сайт.
   */
  playIfNeeded() {
    // Нет разметки — деградируем: показываем сайт.
    if (!this.overlay || !this.video) {
      this._revealSite();
      return;
    }

    // Прозрачное видео на iOS не поддерживается — выключаем интро.
    if (this.opts.transparent && this._isIOS()) {
      this._finish(true);
      return;
    }

    if (this._alreadySeen()) {
      this._finish(true);
      return;
    }

    if (this.opts.transparent) {
      this.overlay.classList.add('is-transparent');
    }

    // Reduced motion.
    if (this._prefersReducedMotion() && this.opts.reducedMotionMode !== 'play') {
      this._markSeen();
      this._dispatch('intro:shown');
      this._focusSkip();
      this._bindControls(); // Esc/кнопка всё равно работают

      if (this.opts.reducedMotionMode === 'skip') {
        this._finish();
        return;
      }
      // 'poster': показать постер ~400 мс, затем завершить.
      this.video.removeAttribute('autoplay');
      this._fallbackTimer = setTimeout(() => this._finish(), 400);
      return;
    }

    // Обычный путь: играем видео.
    this._start();
  }

  /**
   * Пропустить интро прямо сейчас (кнопка / Esc / программно).
   */
  skip() {
    this._finish();
  }

  /**
   * Снять все слушатели и убрать оверлей из DOM.
   */
  destroy() {
    clearTimeout(this._fallbackTimer);
    if (this.video) {
      this.video.removeEventListener('ended', this._onEnded);
      this.video.removeEventListener('error', this._onError);
      try { this.video.pause(); } catch (_) {}
    }
    if (this.skipBtn) {
      this.skipBtn.removeEventListener('click', this._onSkipClick);
    }
    document.removeEventListener('keydown', this._onKeydown);
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }

  /* ---------- Внутреннее ---------- */

  _start() {
    this._started = true;
    this._markSeen();
    this._bindControls();
    this._dispatch('intro:shown');
    this._focusSkip();

    // Fallback‑таймер: если ended не пришёл — принудительно закрыть.
    const guard = this.opts.durationMs + 500;
    this._fallbackTimer = setTimeout(() => this._finish(), guard);

    this.video.addEventListener('ended', this._onEnded);
    this.video.addEventListener('error', this._onError);

    // Автоплей может быть отклонён (нет muted, политика браузера, iOS).
    const p = this.video.play();
    if (p && typeof p.then === 'function') {
      p.catch(() => {
        // Автоплей не стартовал — сразу завершаем, показываем сайт.
        this._finish();
      });
    }
  }

  _bindControls() {
    if (this.skipBtn) {
      this.skipBtn.addEventListener('click', this._onSkipClick);
    }
    document.addEventListener('keydown', this._onKeydown);
  }

  _onKeydown(e) {
    if (e.key === 'Escape') this.skip();
  }

  _onEnded() { this._finish(); }

  _onError() { this._finish(); } // ошибка загрузки/воспроизведения → завершить

  _focusSkip() {
    if (this.skipBtn) {
      // requestAnimationFrame — чтобы фокус лёг после отрисовки.
      requestAnimationFrame(() => this.skipBtn.focus());
    }
  }

  /**
   * Завершение: fade → удаление DOM → показ сайта → событие/колбэк.
   * @param {boolean} [instant] Без анимации (уже видели / выключено).
   */
  _finish(instant = false) {
    if (this._done) return;      // однократно
    this._done = true;
    clearTimeout(this._fallbackTimer);

    const cleanup = () => {
      this.destroy();
      this._revealSite();
      this._dispatch('intro:done');
      try { this.opts.onDone(); } catch (_) {}
    };

    if (!this.overlay) { cleanup(); return; }

    const reduced = this._prefersReducedMotion();
    if (instant || reduced) {
      cleanup();
      return;
    }

    // Плавный fade, затем очистка. transitionend + страховочный таймаут.
    let finished = false;
    const onEnd = () => {
      if (finished) return;
      finished = true;
      this.overlay.removeEventListener('transitionend', onEnd);
      cleanup();
    };
    this.overlay.addEventListener('transitionend', onEnd);
    this.overlay.classList.add('is-hiding');
    setTimeout(onEnd, 900); // страховка, если transitionend не сработает
  }

  /** Сделать сайт видимым и доступным для фокуса, вернуть фокус. */
  _revealSite() {
    if (this.site) {
      this.site.classList.add('is-visible');
      this.site.removeAttribute('aria-hidden');
      this.site.removeAttribute('inert');
    }
    // Возврат фокуса.
    let target = null;
    if (this.opts.restoreFocusSelector) {
      target = document.querySelector(this.opts.restoreFocusSelector);
    }
    if (target && typeof target.focus === 'function') {
      target.focus();
    } else if (document.body) {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
    }
  }

  _dispatch(name) {
    window.dispatchEvent(new Event(name));
  }
}

// Экспорт для модульной сборки (опционально), плюс глобал для копипасты.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IntroPlayer;
}
