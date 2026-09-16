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
     KZCOMP gallery: fisheye hover distortion
  --------------------------------------------------------- */
  var galleryItems = document.querySelectorAll(".gallery-item");
  var SVG_NS = "http://www.w3.org/2000/svg";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var DISPLACEMENT_MAP =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3CradialGradient id='g' cx='50%25' cy='50%25' r='70%25'%3E%3Cstop offset='0%25' stop-color='%23808080'/%3E%3Cstop offset='50%25' stop-color='%23ffffff'/%3E%3Cstop offset='100%25' stop-color='%23808080'/%3E%3C/radialGradient%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3C/svg%3E";

  if (galleryItems.length && !reduceMotion) {
    var defsHost = document.createElementNS(SVG_NS, "svg");
    defsHost.setAttribute("width", "0");
    defsHost.setAttribute("height", "0");
    defsHost.style.position = "absolute";
    defsHost.setAttribute("aria-hidden", "true");
    document.body.appendChild(defsHost);

    galleryItems.forEach(function (item, idx) {
      var img = item.querySelector("img");
      if (!img) return;

      var filterId = "fisheye-" + idx;
      var filter = document.createElementNS(SVG_NS, "filter");
      filter.setAttribute("id", filterId);
      filter.setAttribute("x", "-20%");
      filter.setAttribute("y", "-20%");
      filter.setAttribute("width", "140%");
      filter.setAttribute("height", "140%");

      var feImage = document.createElementNS(SVG_NS, "feImage");
      feImage.setAttributeNS(XLINK_NS, "href", DISPLACEMENT_MAP);
      feImage.setAttribute("preserveAspectRatio", "none");
      feImage.setAttribute("result", "map");

      var feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
      feDisp.setAttribute("in", "SourceGraphic");
      feDisp.setAttribute("in2", "map");
      feDisp.setAttribute("scale", "0");
      feDisp.setAttribute("xChannelSelector", "R");
      feDisp.setAttribute("yChannelSelector", "R");

      filter.appendChild(feImage);
      filter.appendChild(feDisp);
      defsHost.appendChild(filter);

      img.style.filter = "grayscale(var(--gray)) url(#" + filterId + ")";

      var current = 0;
      var raf = null;

      function animateTo(target) {
        if (raf) cancelAnimationFrame(raf);
        var start = current;
        var startTime = performance.now();
        var duration = 350;
        function step(now) {
          var t = Math.min((now - startTime) / duration, 1);
          var eased = 1 - Math.pow(1 - t, 3);
          current = start + (target - start) * eased;
          feDisp.setAttribute("scale", current.toFixed(2));
          if (t < 1) {
            raf = requestAnimationFrame(step);
          }
        }
        raf = requestAnimationFrame(step);
      }

      item.addEventListener("mouseenter", function () { animateTo(28); });
      item.addEventListener("mouseleave", function () { animateTo(0); });
      item.addEventListener("focus", function () { animateTo(28); });
      item.addEventListener("blur", function () { animateTo(0); });
    });
  } else {
    galleryItems.forEach(function (item) {
      var img = item.querySelector("img");
      if (img) img.style.filter = "grayscale(var(--gray))";
    });
  }

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
})();
