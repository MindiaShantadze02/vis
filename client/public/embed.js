/**
 * Vis booking embed helper.
 *
 * Usage on any website:
 *   <iframe data-vis src="https://vis.ge/book/YOUR-SLUG?embed=1&lang=en"
 *           style="width:100%;border:0"></iframe>
 *   <script src="https://vis.ge/embed.js" async></script>
 *
 * It auto-sizes every iframe[data-vis] to its content, and breaks the payment
 * redirect out to the top window. Messages are only accepted from the iframe's
 * own origin.
 */
(function () {
  function iframes() {
    return Array.prototype.slice.call(document.querySelectorAll('iframe[data-vis]'));
  }

  // Ping each embedded iframe so it (re)sends its current height — covers the
  // race where this async script attaches after the iframe's first height burst.
  function ping() {
    iframes().forEach(function (f) {
      // '*' target: the "hello" carries no data, and early pings may hit the
      // iframe while it's still about:blank (parent origin), so a specific
      // targetOrigin would just log a benign console warning.
      try { if (f.contentWindow) f.contentWindow.postMessage({ source: 'vis-host', type: 'vis:hello' }, '*'); } catch (_) {}
    });
  }
  iframes().forEach(function (f) { f.addEventListener('load', ping); });
  if (document.readyState === 'complete') ping(); else window.addEventListener('load', ping);
  setTimeout(ping, 300);
  setTimeout(ping, 1000);

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.source !== 'vis') return;

    // Only trust messages coming from the embedded iframe's own origin.
    var frame = iframes().filter(function (f) {
      try { return new URL(f.src).origin === e.origin; } catch (_) { return false; }
    })[0];
    if (!frame) return;

    if (data.type === 'vis:resize' && data.height) {
      frame.style.height = data.height + 'px';
    } else if (data.type === 'vis:redirect' && data.url) {
      // Payment gateways refuse to load inside an iframe — send the top window.
      // Scheme-check first: this navigates the HOST page, so an unchecked value
      // would let a `javascript:` URL run script in the host site's origin. The
      // origin check above already restricts who can send this, but a redirect
      // primitive aimed at someone else's page deserves its own guard.
      var dest;
      try { dest = new URL(data.url, location.href); } catch (_) { return; }
      if (dest.protocol !== 'https:' && dest.protocol !== 'http:') return;
      window.top.location.href = dest.href;
    } else if (data.type === 'vis:booked') {
      // Let the host page react to a completed booking if it wants to.
      frame.dispatchEvent(new CustomEvent('vis:booked', { detail: data }));
    }
  });
})();
