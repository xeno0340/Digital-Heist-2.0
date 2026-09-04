// Digital Heist 2.0 — early theme setter.
//
// Include this with a plain <script src="theme.js"></script> placed in
// <head>, BEFORE any stylesheet/content that would flash the wrong colors.
// It runs synchronously the moment the browser reaches it, so
// document.documentElement gets data-theme set before first paint — no
// flash of the wrong theme on load.
//
// Preference is persisted in localStorage under DH_THEME_KEY. Dark is the
// brand default (matches theme.css); if nothing is stored yet, dark is
// used rather than reading prefers-color-scheme, so the poster-matched
// dark UI is what first-time visitors see regardless of OS setting.
(function () {
    var KEY = "dh_theme";
    var stored = null;
    try {
        stored = localStorage.getItem(KEY);
    } catch (e) {
        // localStorage can throw in locked-down browser contexts — fall back
        // to the default rather than breaking page load.
    }
    var theme = stored === "light" || stored === "dark" ? stored : "dark";
    document.documentElement.setAttribute("data-theme", theme);
})();

// Everything below can run after DOM parsing — it wires up any
// .theme-toggle element(s) on the page. Markup convention (see theme.css):
//   <button class="theme-toggle" data-theme-toggle>
//     <span class="seg" data-seg="dark">Dark</span>
//     <span class="seg" data-seg="light">Light</span>
//   </button>
// Multiple toggles on one page (e.g. a persistent top bar plus a login
// card) all stay in sync automatically.
window.DHTheme = {
    KEY: "dh_theme",

    get: function () {
        return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    },

    set: function (theme) {
        var t = theme === "light" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", t);
        try {
            localStorage.setItem(this.KEY, t);
        } catch (e) {
            /* ignore — theme just won't persist across reloads */
        }
        this._sync();
    },

    toggle: function () {
        this.set(this.get() === "dark" ? "light" : "dark");
    },

    // Updates the .active class on every .theme-toggle's two .seg children
    // to match the current theme. Safe to call anytime, including before
    // any toggles exist in the DOM yet.
    _sync: function () {
        var current = this.get();
        document.querySelectorAll(".theme-toggle").forEach(function (el) {
            el.querySelectorAll(".seg").forEach(function (seg) {
                seg.classList.toggle("active", seg.getAttribute("data-seg") === current);
            });
        });
    },

    // Call once after DOMContentLoaded (or immediately if the DOM is
    // already parsed) to wire up click handlers on every .theme-toggle
    // present on the page.
    init: function () {
        var self = this;
        document.querySelectorAll(".theme-toggle").forEach(function (el) {
            if (el._dhWired) return;
            el._dhWired = true;
            el.addEventListener("click", function () {
                self.toggle();
            });
        });
        self._sync();
    },
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
        window.DHTheme.init();
    });
} else {
    window.DHTheme.init();
}