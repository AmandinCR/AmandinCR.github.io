# AmandinCR.github.io

Static site: `index.html`, `style.css`, `script.js`. No build step.

## Adding things

- **Talk / publication / teaching entry:** copy an `<li class="entry">` block in `index.html`.
- **Gallery image:** put the full-size file in `originals/`, run `python make-images.py`
  (needs Pillow), then add a line to the gallery in `index.html`:

  ```html
  <button class="gallery-item"><img src="images/NAME.jpg" alt="..." loading="lazy" decoding="async"></button>
  ```

  The first tile is the large one. Numbering and the lightbox (which loads
  `images/NAME-full.jpg`) are automatic.

## Images

`originals/` holds the full-size files and is never loaded by the page.
`images/` is generated from it by `make-images.py`.
