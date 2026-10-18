// Same-origin bootstrap for FFmpeg.wasm on GitHub Pages.
// FFmpeg's class worker must be served from the page's origin.
// The actual official worker is then loaded as an ES module from jsDelivr.
import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js")
  .catch((error) => {
    self.postMessage({
      type: "ERROR",
      data: String(error && error.message ? error.message : error)
    });
  });
