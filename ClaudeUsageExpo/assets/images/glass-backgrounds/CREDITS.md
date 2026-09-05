# Glass background image credits

These four images were downloaded from Unsplash on 2026-09-05. Their source pages identify them as free under the [Unsplash License](https://unsplash.com/license), which permits downloading and bundling them in a commercial app. They are not Unsplash+ assets.

| App label | Bundled filename | Creator | Source |
| --- | --- | --- | --- |
| Hologram (default) | aurora-weave.jpg | Emily Bernal | [Crumpled iridescent plastic film](https://unsplash.com/photos/crumpled-iridescent-plastic-film-texture-r2F5ZIEUPtk) |
| Prisma | topographic-metal.jpg | Carlos Vega | [Iridescent glass](https://unsplash.com/photos/a-blurry-image-of-a-blue-and-pink-background-CuOLJFf-gfs) |
| Färgflöde | neon-grid.jpg | Pawel Czerwinski | [Blue and pink fluid painting](https://unsplash.com/photos/blue-and-pin-abstract-painting-8uZPynIu-rQ) |
| Regnbågsmarmor | cosmic-ink.jpg | Daniel Olah | [Iridescent soap film](https://unsplash.com/photos/swirling-iridescent-soap-film-patterns-VS_kFx4yF5g) |

The legacy preset IDs and filenames are intentionally retained for compatibility with saved preferences. The earlier generated artwork is replaced; its originals remain available in Git history.

## Download variants

Each Unsplash image URL uses `fm=jpg&q=85&w=2400&h=2400&fit=max`: JPEG, original aspect ratio, at most 2400 pixels on either side, with no baked-in crop or color edits. These are ordinary SDR JPEG assets, not HDR10 files. The app uses `cover` to fill the display and adds its existing contrast scrim at runtime. All four assets are bundled for offline use; the app does not call the Unsplash API.

### Bundled variants are downscaled

The bundled copies are resampled to at most 1600 pixels on the long side at JPEG quality 80. What matters is not the file size but the decoded bitmap: at 2400 pixels each background costs 12 to 15 MB of RAM while it is on screen, and the four together came to 57 MB. At 1600 that falls to 25 MB, and the bundled bytes drop from 2.75 MB to 1.51 MB.

1600 covers a phone at native resolution and upscales only modestly on a tablet, which is invisible here because every background sits behind a 0.42 contrast scrim and is blurred by the panes on top of it. Fine detail is destroyed by the design before it ever reaches the eye.

To regenerate from the original URLs, download at `w=2400` and then run:

```bash
sips -Z 1600 --setProperty formatOptions 80 image.jpg --out image.jpg
```

- Hologram: `https://images.unsplash.com/photo-1603847734787-9e8a3f3e9d60`
- Prisma: `https://images.unsplash.com/photo-1634244106844-107aa05a2df0`
- Färgflöde: `https://images.unsplash.com/photo-1553356084-58ef4a67b2a7`
- Regnbågsmarmor: `https://images.unsplash.com/photo-1541356665065-22676f35dd40`
