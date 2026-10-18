// Same-origin bootstrap for FFmpeg.wasm on GitHub Pages.
// FFmpeg's class worker must be served from the page's origin.
// The actual official worker is then loaded as an ES module from jsDelivr.
//
// IMPORTANT: the page posts the "LOAD" message right after creating this worker,
// but the official worker only installs its onmessage handler after the dynamic
// import finishes. Without buffering, that first message is lost and
// ffmpeg.load() hangs forever. So we queue messages and replay them.
const queue = [];
const buffer = (event) => queue.push(event);
self.onmessage = buffer;

import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js")
  .then(() => {
    const handler = self.onmessage;
    if (typeof handler === "function" && handler !== buffer) {
      while (queue.length) handler.call(self, queue.shift());
    }
  })
  .catch((error) => {
    self.postMessage({
      type: "ERROR",
      data: String(error && error.message ? error.message : error)
    });
  });
