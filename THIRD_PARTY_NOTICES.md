# Third-party notices

Didascalie itself is BSD-3-Clause (see [`LICENSE`](LICENSE)). It bundles the
third-party assets below into its installers, which carry their own terms.

Dependency licences are declared in `package.json` / `Cargo.toml` and the
respective lockfiles; this file covers the binary assets that are redistributed
verbatim inside the application, where the licence asks for attribution.

## didascalie-bioformats (microscopy reader)

- Program: `didascalie-bioformats`, shipped next to the application on
  Windows, macOS and Linux (not on Android)
- Source: <https://github.com/ClementPla/didascalie-bioformats>; the version
  shipped is the release tag named in `.github/workflows/main.yml`
  (`READER_VERSION`)
- Built on [bioformats-rs](https://github.com/henriksson-lab/bioformats-rs), a
  Rust translation of [Bio-Formats](https://www.openmicroscopy.org/bio-formats/)
- Licence: GNU General Public License, version 2 or later. The licence text is
  installed with it (`licenses/didascalie-bioformats-LICENSE.txt`).

It is a separate program: Didascalie runs it to read microscopy files (CZI,
LIF, ND2, OME-TIFF, ...) when they are imported, and exchanges only its
command line and JSON output with it. Didascalie itself stays under the
BSD-3-Clause licence.

## Material Symbols (icon font)

- Package: [`@material-symbols/font-400`](https://www.npmjs.com/package/@material-symbols/font-400)
- Upstream: [google/material-design-icons](https://github.com/google/material-design-icons)
- Copyright: Google LLC
- Licence: Apache License 2.0 — <https://www.apache.org/licenses/LICENSE-2.0>

Only the *Outlined* style is bundled (`material-symbols-outlined.woff2`). The
font file is served from inside the application; Didascalie does **not** load it
from Google Fonts or any other remote host, so the application keeps working
offline and makes no network request for it.

## PrimeIcons (icon font)

- Package: [`primeicons`](https://www.npmjs.com/package/primeicons)
- Copyright: PrimeTek
- Licence: MIT

## PrimeNG / PrimeNG Themes

- Packages: [`primeng`](https://www.npmjs.com/package/primeng), `@primeng/themes`
- Copyright: PrimeTek
- Licence: MIT (PrimeNG Community version)

## Catppuccin palette

- Package: [`@catppuccin/palette`](https://www.npmjs.com/package/@catppuccin/palette)
- Licence: MIT

## Machine-learning model weights

Encoder weights (DINOv3 and others) are **not** bundled. They are downloaded on
request, from the source named in the model picker, and carry their own licence
terms — which you should check before using them in your own work.
