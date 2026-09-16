(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------
     Barcode scroll indicator (the strip itself scrolls)
  --------------------------------------------------------- */
  var barcode = document.getElementById("barcodeScrollbar");
  var bars = barcode ? barcode.querySelector(".barcode-bars") : null;

  function scrollableHeight() {
    return Math.max(
      document.documentElement.scrollHeight - window.innerHeight,
      1
    );
  }

  function updateBarcodeBars() {
    var ratio = (window.scrollY || window.pageYOffset) / scrollableHeight();
    ratio = Math.min(Math.max(ratio, 0), 1);
    var travel = bars.offsetHeight - barcode.clientHeight;
    bars.style.transform = "translateY(" + (-ratio * travel) + "px)";
  }

  if (barcode && bars) {
    window.addEventListener("scroll", updateBarcodeBars, { passive: true });
    window.addEventListener("resize", updateBarcodeBars);
    updateBarcodeBars();

    barcode.addEventListener("click", function (e) {
      var rect = barcode.getBoundingClientRect();
      var ratio = (e.clientY - rect.top) / rect.height;
      var behavior = reduceMotion ? "auto" : "smooth";
      window.scrollTo({ top: ratio * scrollableHeight(), behavior: behavior });
    });
  }

  /* ---------------------------------------------------------
     Blob tracker: scattered boxes of different sizes only show
     up within an annulus (a ring, not a filled disc) around the
     cursor - hidden both when far away and when right on top of
     the cursor. Currently-visible boxes tether to each other
     (not to the cursor) whenever two of them are close enough,
     forming a small constellation that shifts as you move. Each
     visible box also fades in a small patch of the background
     grid at its own position (a real element that fades via
     opacity, not a mask reveal), so the grid only ever appears
     co-located with a box.
  --------------------------------------------------------- */
  function matrixLabel(size) {
    var n = size < 18 ? 4 : size < 24 ? 8 : size < 32 ? 16 : size < 40 ? 32 : size < 48 ? 64 : 128;
    return n + "x" + n;
  }

  var blobTracker = document.getElementById("blobTracker");
  if (blobTracker) {
    var SVG_NS2 = "http://www.w3.org/2000/svg";
    var ANNULUS_INNER = 260;
    var ANNULUS_OUTER = 620;
    var BOX_LINK_DIST = 380;
    var blobAnchors = [
      { xPct: 0.08, yPct: 0.1, size: 30 },
      { xPct: 0.34, yPct: 0.06, size: 20 },
      { xPct: 0.62, yPct: 0.09, size: 44 },
      { xPct: 0.9, yPct: 0.12, size: 54 },
      { xPct: 0.06, yPct: 0.38, size: 24 },
      { xPct: 0.28, yPct: 0.32, size: 16 },
      { xPct: 0.5, yPct: 0.28, size: 38 },
      { xPct: 0.72, yPct: 0.35, size: 22 },
      { xPct: 0.94, yPct: 0.4, size: 48 },
      { xPct: 0.1, yPct: 0.65, size: 40 },
      { xPct: 0.32, yPct: 0.7, size: 18 },
      { xPct: 0.56, yPct: 0.6, size: 28 },
      { xPct: 0.8, yPct: 0.68, size: 34 },
      { xPct: 0.9, yPct: 0.88, size: 50 },
      { xPct: 0.6, yPct: 0.9, size: 22 },
      { xPct: 0.2, yPct: 0.9, size: 32 },
      { xPct: 0.18, yPct: 0.2, size: 26 },
      { xPct: 0.46, yPct: 0.14, size: 18 },
      { xPct: 0.78, yPct: 0.2, size: 36 },
      { xPct: 0.16, yPct: 0.5, size: 20 },
      { xPct: 0.4, yPct: 0.48, size: 30 },
      { xPct: 0.64, yPct: 0.46, size: 16 },
      { xPct: 0.86, yPct: 0.52, size: 26 },
      { xPct: 0.06, yPct: 0.85, size: 22 },
      { xPct: 0.46, yPct: 0.75, size: 44 },
      { xPct: 0.7, yPct: 0.85, size: 20 },
      { xPct: 0.94, yPct: 0.75, size: 32 },
      { xPct: 0.28, yPct: 0.05, size: 14 }
    ];

    blobAnchors.forEach(function (a) {
      a.rect = document.createElementNS(SVG_NS2, "rect");
      a.rect.setAttribute("class", "blob-box");
      blobTracker.appendChild(a.rect);

      a.label = document.createElementNS(SVG_NS2, "text");
      a.label.setAttribute("class", "blob-label");
      a.label.textContent = matrixLabel(a.size);
      blobTracker.appendChild(a.label);

      a.patch = document.createElement("div");
      a.patch.className = "grid-patch";
      document.body.appendChild(a.patch);
    });

    var blobLinks = [];
    for (var i = 0; i < blobAnchors.length; i++) {
      for (var j = i + 1; j < blobAnchors.length; j++) {
        var link = document.createElementNS(SVG_NS2, "line");
        link.setAttribute("class", "blob-line");
        blobTracker.appendChild(link);
        blobLinks.push({ a: blobAnchors[i], b: blobAnchors[j], el: link });
      }
    }

    var blobTargetX = window.innerWidth / 2;
    var blobTargetY = window.innerHeight / 2;
    var blobCurX = blobTargetX;
    var blobCurY = blobTargetY;
    var blobActive = false;

    function updateBlobPositions() {
      blobAnchors.forEach(function (a) {
        a.x = a.xPct * window.innerWidth;
        a.y = a.yPct * window.innerHeight;
        a.rect.setAttribute("x", a.x - a.size / 2);
        a.rect.setAttribute("y", a.y - a.size / 2);
        a.rect.setAttribute("width", a.size);
        a.rect.setAttribute("height", a.size);
        a.label.setAttribute("x", a.x + a.size / 2 + 6);
        a.label.setAttribute("y", a.y + 3);
        a.patch.style.left = a.x + "px";
        a.patch.style.top = a.y + "px";
      });
    }
    updateBlobPositions();
    window.addEventListener("resize", updateBlobPositions);

    window.addEventListener(
      "mousemove",
      function (e) {
        blobTargetX = e.clientX;
        blobTargetY = e.clientY;
        if (!blobActive) {
          blobActive = true;
          blobTracker.classList.add("is-active");
          blobCurX = blobTargetX;
          blobCurY = blobTargetY;
        }
      },
      { passive: true }
    );

    document.addEventListener("mouseleave", function () {
      blobActive = false;
      blobTracker.classList.remove("is-active");
    });

    (function blobTick() {
      var lerpFactor = reduceMotion ? 1 : 0.18;
      blobCurX += (blobTargetX - blobCurX) * lerpFactor;
      blobCurY += (blobTargetY - blobCurY) * lerpFactor;

      blobAnchors.forEach(function (a) {
        var dx = a.x - blobCurX;
        var dy = a.y - blobCurY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        a.visible = dist > ANNULUS_INNER && dist < ANNULUS_OUTER;
        a.rect.classList.toggle("is-near", a.visible);
        a.label.classList.toggle("is-near", a.visible);
        a.patch.classList.toggle("is-near", a.visible);
      });

      blobLinks.forEach(function (link) {
        var show = link.a.visible && link.b.visible;
        if (show) {
          show = Math.hypot(link.a.x - link.b.x, link.a.y - link.b.y) < BOX_LINK_DIST;
        }
        link.el.classList.toggle("is-near", show);
        if (show) {
          link.el.setAttribute("x1", link.a.x);
          link.el.setAttribute("y1", link.a.y);
          link.el.setAttribute("x2", link.b.x);
          link.el.setAttribute("y2", link.b.y);
        }
      });

      requestAnimationFrame(blobTick);
    })();
  }

  /* ---------------------------------------------------------
     Ambient grid patches: a handful of spots that periodically
     fade in and out on their own (CSS-driven, staggered),
     independent of the cursor, so the grid isn't only ever tied
     to the boxes.
  --------------------------------------------------------- */
  [
    { xPct: 0.15, yPct: 0.22 },
    { xPct: 0.85, yPct: 0.15 },
    { xPct: 0.5, yPct: 0.45 },
    { xPct: 0.1, yPct: 0.7 },
    { xPct: 0.9, yPct: 0.6 },
    { xPct: 0.4, yPct: 0.85 }
  ].forEach(function (p, idx) {
    var el = document.createElement("div");
    el.className = "grid-patch is-ambient";
    el.style.animationDelay = idx * 2.6 + "s";
    document.body.appendChild(el);

    function place() {
      el.style.left = p.xPct * window.innerWidth + "px";
      el.style.top = p.yPct * window.innerHeight + "px";
    }
    place();
    window.addEventListener("resize", place);
  });

  /* ---------------------------------------------------------
     Roll-reveal text links: wrap link text in duplicated
     "roll-face" spans so CSS can slide the old copy up and
     the new copy in underneath on hover.
  --------------------------------------------------------- */
  document.querySelectorAll("a").forEach(function (a) {
    if (a.children.length > 0) return;
    var text = a.textContent;
    if (!text || !text.trim()) return;

    var roll = document.createElement("span");
    roll.className = "roll";
    var inner = document.createElement("span");
    inner.className = "roll-inner";
    var face1 = document.createElement("span");
    face1.className = "roll-face";
    face1.textContent = text;
    var face2 = document.createElement("span");
    face2.className = "roll-face";
    face2.setAttribute("aria-hidden", "true");
    face2.textContent = text;

    inner.appendChild(face1);
    inner.appendChild(face2);
    roll.appendChild(inner);

    a.textContent = "";
    a.appendChild(roll);
  });

  /* ---------------------------------------------------------
     KZCOMP gallery: grayscale reveal (the size increase on
     hover/focus is handled purely in CSS)
  --------------------------------------------------------- */
  var galleryItems = document.querySelectorAll(".gallery-item");

  galleryItems.forEach(function (item) {
    var img = item.querySelector("img");
    if (img) img.style.filter = "grayscale(var(--gray))";
  });

  /* ---------------------------------------------------------
     KZCOMP gallery lightbox
  --------------------------------------------------------- */
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  var lightboxClose = document.getElementById("lightboxClose");
  var lastFocused = null;

  function openLightbox(src, alt) {
    lastFocused = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = alt || "";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    lightboxClose.focus();
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    lightboxImg.src = "";
    document.body.style.overflow = "";
    if (lastFocused) {
      lastFocused.focus();
    }
  }

  galleryItems.forEach(function (item) {
    item.addEventListener("click", function () {
      var full = item.getAttribute("data-full");
      var img = item.querySelector("img");
      openLightbox(full, img ? img.alt : "");
    });
  });

  if (lightboxClose) {
    lightboxClose.addEventListener("click", closeLightbox);
  }

  if (lightbox) {
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) {
        closeLightbox();
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && lightbox.classList.contains("is-open")) {
      closeLightbox();
    }
  });

  /* ---------------------------------------------------------
     Dark mode toggle
  --------------------------------------------------------- */
  var darkToggle = document.getElementById("darkModeToggle");
  var darkToggleLabel = darkToggle
    ? darkToggle.querySelector(".dark-toggle-label")
    : null;

  function syncDarkToggle() {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (darkToggleLabel) darkToggleLabel.textContent = isDark ? "LIGHT MODE" : "DARK MODE";
    if (darkToggle) darkToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
  }

  if (darkToggle) {
    syncDarkToggle();
    darkToggle.addEventListener("click", function () {
      var isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        try { localStorage.setItem("theme", "light"); } catch (e) {}
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        try { localStorage.setItem("theme", "dark"); } catch (e) {}
      }
      syncDarkToggle();
    });
  }
})();
