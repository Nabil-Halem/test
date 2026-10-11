# Sky Mirror website

The website for **Sky Mirror** and the SM-150/750 telescope, built around a live 3D model exported from the Fusion design (V5 Kit, version 15).

- `site/index.html`: home page. The telescope stays on screen in 3D while the story scrolls over it: optics with the light path, carbon truss, fork mount, the kit in pieces, a nine-step build that assembles as you scroll, and the phone adapter. Below that: what you'll see (with an eyepiece field-of-view demo), specifications, project status, sign-up and FAQ.
- `site/explore.html`: the 3D explorer. Turn the telescope, take it apart, cut it open, show the light path and click any of the 96 part types for a description and mass.
- `site/impressum.html`, `site/datenschutz.html`: German legal pages. **These are drafts**: fill in the bracketed placeholders and have them checked before going live.

Everything is static HTML, CSS and JavaScript with no build step. Fonts, three.js and the model are served from the site itself, so a visit sends no data to Google Fonts, CDNs or trackers (simpler under GDPR).

## Run it locally

```bash
npm run serve        # or: python3 -m http.server 8080 --directory site
```

Open <http://localhost:8080>. The pages must be served over HTTP; opening `index.html` as a file will not load the 3D model.

## Deploy

Upload the contents of `site/` to any static web host, for example your current skymirrors.de webspace (IONOS, Strato, all-inkl…), Netlify, Cloudflare Pages or GitHub Pages. No server code is needed. Make sure the host serves `.glb` files (the default MIME type `model/gltf-binary` or `application/octet-stream` both work).

## Before going live

1. **Legal pages**: replace every `[…]` placeholder in `impressum.html` and `datenschutz.html` (name, address, email, hosting provider, newsletter service) and remove the draft notices.
2. **Sign-up form**: choose a newsletter service with double opt-in (e.g. Brevo or CleverReach, both EU-based) and put its form endpoint into `data-endpoint` on `<form id="notify-form">` in `index.html`. Until then the form says sign-up is not connected yet.
3. **3D model**: `site/assets/models/sm150-v5.glb` is the full design model, internal mechanics included. Anyone visiting the site can download it. Decide whether that is what you want, or export a version with only the outside visible.

## Updating the 3D model after a new Fusion version

The model and its part data come from the Sky Mirror design viewer page (the "SM-150/750 V5 Kit" artifact), which embeds a meshopt-compressed GLB plus a `META` part list. To update:

1. Replace `site/assets/models/sm150-v5.glb` with the new export (same node names: `OTA`, `MOUNT`, and one node per part named like `SM-301 Primary Cell #1`).
2. Update `site/assets/data/sm150-v5.json`: `parts` (node, name, material, group, mass), `H` (altitude-axis height), `zp`/`yp` (axis position in the tube frame) and `steps`.
3. Check the figures quoted in `index.html` (masses, part count, version).

## Third-party code

- [three.js](https://threejs.org) 0.169.0, MIT licence (`site/assets/vendor/three/LICENSE`)
- Fonts: Saira Semi Condensed, IBM Plex Sans, IBM Plex Mono, SIL Open Font License (`site/assets/fonts/*-LICENSE.txt`)

To refresh them: `npm install && npm run vendor`.
