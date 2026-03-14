// i18n.js — must be loaded AFTER locale files (locales/en.js, locales/uk.js, …)
// and BEFORE app.js and Alpine.js.
//
// Runtime locale switching
// ─────────────────────────
// window.LOCALES          — registry: { en: {...}, uk: {...} }
// window.setLocale(code)  — swap active locale, persist to localStorage,
//                           bump window.__localeRev so Alpine re-evaluates t()
// window.t(key)           — translate a dot-separated key; returns key on miss
//
// Alpine reactivity trick
// ────────────────────────
// Any x-text / x-bind that calls t() will re-run whenever the Alpine data
// that contains __localeRev changes.  The root app() component exposes
// __localeRev as a reactive property and Alpine.effect re-runs bindings that
// read it.  Because t() references window.__localeRev, Alpine's dependency
// tracking won't see it directly — so instead, every template that needs
// reactivity must reference the reactive property on app() by calling
// t(key, __localeRev) where the second argument is only used as a
// cache-buster for Alpine's tracker.
//
// Simpler alternative used here: window.__localeRev is a plain number.
// The root app() stores it as this.localeRev and calls window.setLocale(),
// which updates both window.__localeRev and this.localeRev.  Alpine sees
// localeRev change on the root scope and re-renders any x-text that reads
// a data property — but because t() is a *global function* Alpine does NOT
// automatically re-run it.
//
// The cleanest no-build solution: make t() a method on the root component
// so Alpine tracks it.  We expose it on window only as a convenience for
// inline JS expressions that live outside of a component scope.
// app() defines this.t(key) which reads this.localeRev (reactive) and
// delegates to the module-level resolve() below.

(function () {
  window.LOCALES = window.LOCALES || {};

  // resolve a dot-path key inside a locale object
  function resolve(locale, key) {
    if (!locale) return key;
    var parts = key.split(".");
    var value = locale;
    for (var i = 0; i < parts.length; i++) {
      if (value == null || typeof value !== "object") return key;
      value = value[parts[i]];
    }
    return (value !== undefined && value !== null) ? String(value) : key;
  }

  // active locale code (read by app() on init to restore from localStorage)
  window.__localeCode = localStorage.getItem("locale") || "en";
  if (!window.LOCALES[window.__localeCode]) {
    window.__localeCode = "en";
    localStorage.setItem("locale", "en");
  }
  window.LOCALE = window.LOCALES[window.__localeCode] || null;

  window.setLocale = function (code) {
    if (!window.LOCALES[code]) return;
    window.__localeCode = code;
    window.LOCALE = window.LOCALES[code];
    localStorage.setItem("locale", code);
    // Notify the root Alpine component so reactive bindings update
    document.dispatchEvent(new CustomEvent("locale-changed", { detail: { code: code } }));
  };

  // Non-reactive global helper (usable in plain JS outside Alpine templates)
  window.t = function (key) {
    return resolve(window.LOCALE, key);
  };

  // Expose resolve so app() can build a reactive t() method
  window.__i18nResolve = resolve;
})();
