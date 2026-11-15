(function () {
  var CONFIG = {
    base: "/AK-Sub-AI/",
    manifest: 'manifest.webmanifest',
    sw: true,
    accent: ["#8b78ff", "#22d3ee"],
    fg: "#080b14",
    linkIcon: "/AK-Sub-AI/icon-192.png",
    appleIcon: "/AK-Sub-AI/icon-192.png"
  };

  function addLink(rel, href, extra) {
    var old = document.querySelector('link[rel="' + rel + '"]');
    if (old) {
      if (old.getAttribute("href") === href) return;
      old.parentNode.removeChild(old);
    }
    var link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    if (extra) Object.keys(extra).forEach(function (key) { link.setAttribute(key, extra[key]); });
    document.head.appendChild(link);
  }

  if (CONFIG.manifest) addLink("manifest", CONFIG.base + CONFIG.manifest);
  addLink("apple-touch-icon", CONFIG.appleIcon);
  addLink("icon", CONFIG.linkIcon, { sizes: "192x192", type: "image/png" });

  if (CONFIG.sw && "serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(CONFIG.base + "sw.js").catch(function () {});
    });
  }

  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) return;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var deferred = null;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "\u2B07 Install app";
  btn.setAttribute("aria-label", "Install this app on your phone");
  btn.style.cssText = [
    "position:fixed", "right:16px", "bottom:16px", "z-index:2147483000",
    "display:none", "align-items:center", "gap:8px",
    "padding:12px 18px", "border:0", "border-radius:999px",
    "font:700 14px/1 system-ui,-apple-system,Segoe UI,sans-serif",
    "color:" + CONFIG.fg, "cursor:pointer",
    "background:linear-gradient(135deg," + CONFIG.accent[0] + "," + CONFIG.accent[1] + ")",
    "box-shadow:0 10px 30px rgba(0,0,0,.45)", "opacity:.97"
  ].join(";");

  function show() { btn.style.display = "inline-flex"; }

  btn.addEventListener("click", function () {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.then(function () { btn.style.display = "none"; }).catch(function () {});
      deferred = null;
      return;
    }
    if (isIOS) {
      alert("iPhone / iPad par: Share button dabayen, phir 'Add to Home Screen' chunein.");
    } else {
      alert("Browser menu (\u22ee) kholein, phir 'Install app' ya 'Add to Home screen' chunein.");
    }
  });

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferred = event;
    show();
  });
  window.addEventListener("appinstalled", function () { btn.style.display = "none"; });

  function mount() {
    document.body.appendChild(btn);
    show();
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
