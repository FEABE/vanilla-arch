# Changelog

## 0.1.1 — 2026-11-27

- **Canvas size limit.** The canvas used to grow with the coordinates without bound (a node at `x: 10000` asked for
  an enormous canvas, which browsers refuse or leave blank). It is now capped by `VanillaArch.LIMITS`: at most 8192
  CSS px per side and 16,777,216 backing pixels after the device pixel ratio. A too-large canvas first gets a lower
  pixel ratio; a too-wide drawing gets a smaller cell size. Nothing throws. Ordinary diagrams render exactly as in
  0.1.0 (checked pixel for pixel).
- `validate()` reports coordinate spans that are too big for one canvas.
- **`vanilla-arch.min.js`**: a minified build (36 KB / 13.6 KB gzipped), made with the vanilla-kit minifier by
  `scripts/build-min.js`. The test suite runs against it as well (`test/min.test.js`).
- Non-finite drawing extents (for example from broken zone coordinates) no longer produce a NaN-sized canvas.

## 0.1.0 — 2026-11-26

- First release: isometric architecture diagrams on Canvas 2D, scenarios with animated packets, light and dark
  palettes, CSS custom properties, `validate()`, `iconOf()`, `toDataURL()`, `still` mode.
