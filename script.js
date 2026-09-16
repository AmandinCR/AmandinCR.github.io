(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  /* ---------------------------------------------------------
     Background field: one canvas that plays a "solve" driven
     by scroll position.
       - contour lines of a potential u = sum q log|x - s|
         (sources drift and levels flow as you scroll)
       - an FMM-style adaptive quadtree over point clusters
         that refines one level at a time as you scroll down
       - an overlapping domain decomposition whose active
         subdomain sweeps left to right (highlighted contours)
       - a block-diagonal / hierarchical matrix that mirrors the
         tree and the sweep, drawn in the bottom-right corner where
         it doubles as the scroll indicator (click / drag)
     Everything is a pure function of scroll, so scrolling back
     up un-refines. It only redraws while the scroll position is
     changing, and is faded out behind the text column.
  --------------------------------------------------------- */
  var field = document.getElementById("bgField");
  var mCanvas = document.getElementById("matrixCanvas");

  if (field && mCanvas) {
    var ctx = field.getContext("2d");
    var mctx = mCanvas.getContext("2d");
    var mScroller = document.getElementById("matrixScroller");
    var mLabel = document.getElementById("matrixLabel");
    var column = document.querySelector(".main-content");

    var N_SUB = 4;           // subdomains
    var SUB_OVERLAP = 0.035; // overlap (fraction of width) on each side
    var MIN_DEPTH = 2;
    var MAX_DEPTH = 7;
    var LEAF_CAP = 8;        // points per leaf before refining
    var LEVEL_STEP = 0.2;    // contour spacing in u

    var W = 0, H = 0, S = 1, DPR = 1, GRID = 10, M_SIZE = 0;
    var colLeft = 0, colRight = 0, scrollMax = 1;
    var colors = {};
    var values = new Float32Array(0); // potential on the grid, reused between frames

    var seed = 20231;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }
    function gauss() {
      return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    }

    var sources = [
      { x: 0.12, y: 0.34, q: 1.0,  spread: 0.07, n: 90,  orbit: 0.05, phase: 0.0, speed: 0.8 },
      { x: 0.88, y: 0.26, q: -0.9, spread: 0.06, n: 80,  orbit: 0.04, phase: 2.1, speed: -1.0 },
      { x: 0.83, y: 0.80, q: 1.1,  spread: 0.08, n: 100, orbit: 0.05, phase: 4.0, speed: 0.6 },
      { x: 0.16, y: 0.84, q: -1.0, spread: 0.05, n: 70,  orbit: 0.04, phase: 1.3, speed: -0.7 },
      { x: 0.52, y: 0.58, q: 0.6,  spread: 0.10, n: 60,  orbit: 0.07, phase: 5.2, speed: 0.5 }
    ];
    var points = [];
    sources.forEach(function (s) {
      for (var k = 0; k < s.n; k++) {
        points.push({ src: s, ox: gauss() * s.spread, oy: gauss() * s.spread, x: 0, y: 0 });
      }
    });

    function readColors() {
      var cs = getComputedStyle(root);
      var dark = root.getAttribute("data-theme") === "dark";
      colors.ink = cs.getPropertyValue("--ink").trim();
      colors.soft = cs.getPropertyValue("--ink-soft").trim();
      colors.accent = cs.getPropertyValue("--accent").trim();
      // light mode needs more ink to read against the cream paper
      colors.tone = dark
        ? { line: 0.14, tree: 0.2, acc: 0.42, fade: 0.82, matrix: 0.6 }
        : { line: 0.3, tree: 0.4, acc: 0.62, fade: 0.78, matrix: 0.8 };
    }

    // Canvas sizes follow their CSS boxes. Reallocating a canvas is
    // expensive, so only do it when the size actually changed (phones
    // fire resize whenever the URL bar shows or hides).
    function measure() {
      var r = column.getBoundingClientRect();
      colLeft = r.left;
      colRight = r.right;
      scrollMax = Math.max(root.scrollHeight - window.innerHeight, 1);

      var w = field.clientWidth, h = field.clientHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var m = mCanvas.clientWidth;
      if (w === W && h === H && dpr === DPR && m === M_SIZE) return;
      W = w; H = h; DPR = dpr; M_SIZE = m;
      S = Math.min(W, H);
      GRID = Math.max(10, Math.round(W / 160)); // coarser grid on very wide screens
      field.width = Math.round(W * DPR);
      field.height = Math.round(H * DPR);
      mCanvas.width = mCanvas.height = Math.round(M_SIZE * DPR);
    }

    /* --- geometry at scroll progress p --- */
    function placeSources(p) {
      var i, s, pt;
      for (i = 0; i < sources.length; i++) {
        s = sources[i];
        var t = 2 * Math.PI * p * s.speed + s.phase;
        s.cx = (s.x + s.orbit * Math.cos(t)) * W;
        s.cy = (s.y + s.orbit * Math.sin(t)) * H;
      }
      for (i = 0; i < points.length; i++) {
        pt = points[i];
        pt.x = pt.src.cx + pt.ox * S;
        pt.y = pt.src.cy + pt.oy * S;
      }
    }

    function potential(x, y) {
      var u = 0;
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        var dx = (x - s.cx) / S, dy = (y - s.cy) / S;
        u += s.q * 0.5 * Math.log(dx * dx + dy * dy + 0.0015);
      }
      return u;
    }

    // marching squares: edge pairs per case (0 top, 1 right, 2 bottom, 3 left)
    var CASES = [[], [3, 2], [2, 1], [3, 1], [0, 1], [0, 1, 2, 3], [0, 2], [0, 3],
                 [0, 3], [0, 2], [0, 3, 1, 2], [0, 1], [3, 1], [1, 2], [3, 2], []];
    var ex = [0, 0, 0, 0], ey = [0, 0, 0, 0];

    // Returns the contour path. Segments inside a highlighted strip are
    // also added to that strip's own path, so the accent pass strokes
    // only those instead of re-stroking everything through a clip.
    function contours(phase, strips) {
      var cols = Math.ceil(W / GRID) + 1, rows = Math.ceil(H / GRID) + 1;
      if (values.length < cols * rows) values = new Float32Array(cols * rows);
      var v = values, i, j, k, m, n;
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) v[j * cols + i] = potential(i * GRID, j * GRID);
      }

      var path = new Path2D();
      for (j = 0; j < rows - 1; j++) {
        for (i = 0; i < cols - 1; i++) {
          var a = v[j * cols + i], b = v[j * cols + i + 1];
          var c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i];
          var k0 = Math.ceil((Math.min(a, b, c, d) - phase) / LEVEL_STEP);
          var k1 = Math.floor((Math.max(a, b, c, d) - phase) / LEVEL_STEP);
          if (k1 < k0) continue;
          var x0 = i * GRID, y0 = j * GRID, x1 = x0 + GRID, y1 = y0 + GRID;
          var mid = x0 + GRID / 2;
          for (k = k0; k <= k1; k++) {
            var L = phase + k * LEVEL_STEP;
            var seg = CASES[(a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0)];
            if (!seg.length) continue;
            ex[0] = x0 + GRID * (L - a) / (b - a); ey[0] = y0;
            ex[1] = x1; ey[1] = y0 + GRID * (L - b) / (c - b);
            ex[2] = x0 + GRID * (L - d) / (c - d); ey[2] = y1;
            ex[3] = x0; ey[3] = y0 + GRID * (L - a) / (d - a);
            for (m = 0; m < seg.length; m += 2) {
              path.moveTo(ex[seg[m]], ey[seg[m]]);
              path.lineTo(ex[seg[m + 1]], ey[seg[m + 1]]);
              for (n = 0; n < strips.length; n++) {
                if (mid >= strips[n].x0 && mid < strips[n].x1) {
                  strips[n].path.moveTo(ex[seg[m]], ey[seg[m]]);
                  strips[n].path.lineTo(ex[seg[m + 1]], ey[seg[m + 1]]);
                }
              }
            }
          }
        }
      }
      return path;
    }

    // adaptive quadtree; returns split lines grouped by child level
    function quadtree(depth) {
      var levels = [];
      for (var l = 0; l <= MAX_DEPTH; l++) levels.push(new Path2D());
      var cap = Math.ceil(depth);
      var R = Math.max(W, H);
      (function rec(x, y, s, lvl, pts) {
        if (lvl >= cap || (lvl >= MIN_DEPTH && pts.length <= LEAF_CAP)) return;
        var h = s / 2, mx = x + h, my = y + h;
        levels[lvl + 1].moveTo(mx, y); levels[lvl + 1].lineTo(mx, y + s);
        levels[lvl + 1].moveTo(x, my); levels[lvl + 1].lineTo(x + s, my);
        var q = [[], [], [], []];
        for (var i = 0; i < pts.length; i++) {
          q[(pts[i].x >= mx ? 1 : 0) + (pts[i].y >= my ? 2 : 0)].push(pts[i]);
        }
        rec(x, y, h, lvl + 1, q[0]);
        rec(mx, y, h, lvl + 1, q[1]);
        rec(x, my, h, lvl + 1, q[2]);
        rec(mx, my, h, lvl + 1, q[3]);
      })((W - R) / 2, (H - R) / 2, R, 0, points);
      return levels;
    }

    function weight(active, i) {
      return Math.max(0, 1 - Math.abs(active - i));
    }

    // block-diagonal matrix; each diagonal block splits further as the tree deepens
    function drawMatrix(p, depth, active) {
      var g = mctx, M = M_SIZE - 1, bs = M / N_SUB, i, l, k;
      var levels = Math.min(4, Math.floor(depth - MIN_DEPTH));
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, M_SIZE, M_SIZE);
      g.lineWidth = 1;
      g.globalAlpha = colors.tone.matrix;
      g.strokeStyle = colors.soft;
      g.strokeRect(0.5, 0.5, M, M);
      for (i = 0; i < N_SUB; i++) {
        for (l = 0; l <= levels; l++) {
          var s = bs / (1 << l);
          for (k = 0; k < 1 << l; k++) g.strokeRect(0.5 + i * bs + k * s, 0.5 + i * bs + k * s, s, s);
        }
      }

      g.fillStyle = g.strokeStyle = colors.accent;
      for (i = 0; i < N_SUB; i++) {
        var aw = weight(active, i);
        if (!aw) continue;
        g.globalAlpha = 0.25 * aw;
        g.fillRect(0.5 + i * bs, 0.5 + i * bs, bs, bs);
      }

      // scroll position: current row / column of the matrix
      var t = Math.round(p * M) + 0.5;
      g.globalAlpha = 0.45;
      g.beginPath();
      g.moveTo(0, t); g.lineTo(M + 1, t);
      g.moveTo(t, 0); g.lineTo(t, M + 1);
      g.stroke();
      g.globalAlpha = 1;
      g.fillRect(t - 2.5, t - 2.5, 5, 5);

      var label = "SUBDOMAIN \u03a9" + Math.min(N_SUB, Math.round(active) + 1) + "/" + N_SUB;
      if (mLabel.textContent !== label) mLabel.textContent = label;
    }

    function draw(p) {
      var tone = colors.tone, i;
      var depth = MIN_DEPTH + p * (MAX_DEPTH - MIN_DEPTH);
      var active = p * (N_SUB - 1);
      placeSources(p);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;

      // quadtree (newest level fades in)
      var tree = quadtree(depth);
      ctx.strokeStyle = colors.soft;
      for (i = 1; i <= MAX_DEPTH; i++) {
        var w = clamp(depth - (i - 1), 0, 1);
        if (!w) continue;
        ctx.globalAlpha = tone.tree * w;
        ctx.stroke(tree[i]);
      }

      // active subdomains (at most two while crossing between them)
      var strips = [];
      for (i = 0; i < N_SUB; i++) {
        var aw = weight(active, i);
        if (aw) {
          strips.push({
            w: aw,
            x0: Math.max(0, (i / N_SUB - SUB_OVERLAP) * W),
            x1: Math.min(W, ((i + 1) / N_SUB + SUB_OVERLAP) * W),
            path: new Path2D()
          });
        }
      }

      var path = contours(-p * LEVEL_STEP * 6, strips);
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = tone.line;
      ctx.stroke(path);

      // dashed subdomain interfaces, accent-coloured around the active ones
      ctx.setLineDash([3, 5]);
      for (i = 0; i < N_SUB; i++) {
        aw = weight(active, i);
        var x0 = Math.round((i / N_SUB - SUB_OVERLAP) * W) + 0.5;
        var x1 = Math.round(((i + 1) / N_SUB + SUB_OVERLAP) * W) + 0.5;
        ctx.strokeStyle = aw ? colors.accent : colors.soft;
        ctx.globalAlpha = Math.max(tone.line * 0.9, 0.7 * aw);
        ctx.beginPath();
        if (i > 0) { ctx.moveTo(x0, 0); ctx.lineTo(x0, H); }
        if (i < N_SUB - 1) { ctx.moveTo(x1, 0); ctx.lineTo(x1, H); }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = colors.accent;
      for (i = 0; i < strips.length; i++) {
        ctx.globalAlpha = tone.acc * strips[i].w;
        ctx.stroke(strips[i].path);
      }

      // fade everything out behind the text column
      if (colRight > colLeft) {
        var fade = "rgba(0,0,0," + tone.fade + ")";
        var e = Math.min(0.49, 140 / (colRight - colLeft + 160));
        var g = ctx.createLinearGradient(colLeft - 80, 0, colRight + 80, 0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(e, fade);
        g.addColorStop(1 - e, fade);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "source-over";
      }

      drawMatrix(p, depth, active);
    }

    /* --- scroll-driven loop: only runs while catching up --- */
    var targetP = 0, curP = 0, rafId = 0;

    function readScroll() {
      targetP = clamp(window.scrollY / scrollMax, 0, 1);
    }

    function tick() {
      rafId = 0;
      curP = reduceMotion ? targetP : curP + (targetP - curP) * 0.14;
      if (Math.abs(targetP - curP) < 0.0005) curP = targetP;
      draw(curP);
      if (curP !== targetP) rafId = requestAnimationFrame(tick);
    }

    function schedule() {
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function refresh() {
      measure();
      readScroll();
      draw(curP);
      schedule();
    }

    // matrix scroller: project the pointer onto the diagonal
    var dragging = false;
    function scrollFromPointer(e, behavior) {
      var r = mCanvas.getBoundingClientRect();
      var t = clamp((e.clientX - r.left + e.clientY - r.top) / (r.width + r.height), 0, 1);
      window.scrollTo({ top: t * scrollMax, behavior: behavior });
    }
    mScroller.addEventListener("pointerdown", function (e) {
      dragging = true;
      scrollFromPointer(e, reduceMotion ? "instant" : "smooth");
      try { mScroller.setPointerCapture(e.pointerId); } catch (err) {}
    });
    mScroller.addEventListener("pointermove", function (e) {
      if (dragging) scrollFromPointer(e, "instant");
    });
    mScroller.addEventListener("pointerup", function () { dragging = false; });
    mScroller.addEventListener("pointercancel", function () { dragging = false; });

    readColors();
    measure();
    readScroll();
    curP = targetP;
    draw(curP);

    window.addEventListener("scroll", function () { readScroll(); schedule(); }, { passive: true });
    window.addEventListener("resize", refresh);
    // page height changes (fonts, images) without a window resize
    if ("ResizeObserver" in window) new ResizeObserver(refresh).observe(document.body);
    new MutationObserver(function () { readColors(); draw(curP); })
      .observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* ---------------------------------------------------------
     Roll-reveal text links: duplicate each link's text so CSS
     can slide the copy up into place on hover.
  --------------------------------------------------------- */
  document.querySelectorAll("a").forEach(function (a) {
    var text = a.textContent.trim();
    if (a.children.length || !text) return;
    a.innerHTML = '<span class="roll"><span class="roll-inner">' +
      '<span class="roll-face"></span><span class="roll-face" aria-hidden="true"></span></span></span>';
    a.querySelectorAll(".roll-face").forEach(function (face) { face.textContent = text; });
  });

  /* ---------------------------------------------------------
     KZCOMP gallery + lightbox. The lightbox shows images/NAME-full.jpg
     for a tile image images/NAME.jpg (see make-images.py).
  --------------------------------------------------------- */
  var gallery = document.querySelector(".kreedz-gallery");
  var items = gallery ? [].slice.call(gallery.querySelectorAll(".gallery-item")) : [];
  var lightbox = document.getElementById("lightbox");

  // staggered wipe-in when the gallery scrolls into view
  if (gallery && !reduceMotion && "IntersectionObserver" in window) {
    gallery.classList.add("is-pending");
    var galleryObserver = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      gallery.classList.remove("is-pending");
      galleryObserver.disconnect();
    }, { threshold: 0.15 });
    galleryObserver.observe(gallery);
  }

  if (lightbox && items.length) {
    var lbImg = document.getElementById("lightboxImg");
    var lbCount = document.getElementById("lightboxCaption");
    var lbClose = document.getElementById("lightboxClose");
    var current = 0, lastFocused = null;

    var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };

    var show = function (index) {
      current = (index + items.length) % items.length;
      var thumb = items[current].querySelector("img");
      lbImg.src = thumb.getAttribute("src").replace(/\.jpg$/, "-full.jpg");
      lbImg.alt = thumb.alt;
      lbCount.textContent = pad2(current + 1) + " / " + pad2(items.length);
    };

    var open = function (index) {
      lastFocused = document.activeElement;
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
      show(index);
      lbClose.focus();
      document.body.style.overflow = "hidden";
    };

    var close = function () {
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
      lbImg.removeAttribute("src");
      document.body.style.overflow = "";
      if (lastFocused) lastFocused.focus();
    };

    items.forEach(function (item, i) {
      item.style.setProperty("--i", i);
      item.addEventListener("click", function () { open(i); });
    });
    lbClose.addEventListener("click", close);
    document.getElementById("lightboxPrev").addEventListener("click", function () { show(current - 1); });
    document.getElementById("lightboxNext").addEventListener("click", function () { show(current + 1); });
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(current - 1);
      else if (e.key === "ArrowRight") show(current + 1);
    });
  }

  /* ---------------------------------------------------------
     Dark mode toggle
  --------------------------------------------------------- */
  var darkToggle = document.getElementById("darkModeToggle");
  var syncToggle = function () {
    darkToggle.textContent = root.getAttribute("data-theme") === "dark" ? "[ LIGHT MODE ]" : "[ DARK MODE ]";
  };
  syncToggle();
  darkToggle.addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") !== "dark";
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) {}
    syncToggle();
  });
})();
