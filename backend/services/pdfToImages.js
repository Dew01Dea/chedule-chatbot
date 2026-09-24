const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pdftoppmCommand, popplerSource } = require("../lib/poppler");

/**
 * Rasterizes every page of a PDF into PNG images. Typhoon OCR (like most
 * document-vision models) reads page images, not raw PDF bytes, so this
 * conversion step happens before every OCR call.
 *
 * Two renderers, tried in order:
 *
 *   1. poppler's `pdftoppm`, when it is installed. It resolves fonts a PDF does
 *      not embed through the system's font configuration, so it is the more
 *      faithful of the two on a machine that has it.
 *   2. pdf.js drawing onto @napi-rs/canvas. Both ship as npm packages with
 *      prebuilt binaries, so this works where nothing can be installed — a
 *      serverless function in particular, where poppler cannot exist.
 *
 * Only a missing pdftoppm falls through to pdf.js. A PDF that poppler found
 * and could not read is reported as unreadable rather than retried, since the
 * file is the likelier culprit than the renderer.
 *
 * Returns an array of base64-encoded PNG strings, one per page, in order.
 */
async function pdfBufferToPngPages(pdfBuffer, dpi = 200) {
  try {
    return await renderWithPoppler(pdfBuffer, dpi);
  } catch (error) {
    if (error.code !== "POPPLER_MISSING") throw error;
  }

  return renderWithPdfjs(pdfBuffer, dpi);
}

/* -------------------------------------------------------------------------- */
/* poppler                                                                    */
/* -------------------------------------------------------------------------- */

function renderWithPoppler(pdfBuffer, dpi) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-ocr-"));
    const pdfPath = path.join(tmpDir, "input.pdf");
    const outPrefix = path.join(tmpDir, "page");

    fs.writeFileSync(pdfPath, pdfBuffer);

    execFile(
      pdftoppmCommand(),
      ["-png", "-r", String(dpi), pdfPath, outPrefix],
      (err) => {
        if (err) {
          cleanup(tmpDir);

          // ENOENT means the binary itself is not there. That is no longer an
          // error on its own — the caller falls back to pdf.js — so the code
          // is internal and never reaches a response.
          const missing = err.code === "ENOENT";
          const error = new Error(
            missing
              ? `pdftoppm was not found. Looked in: ${popplerSource()}.`
              : `pdftoppm failed to render the PDF: ${err.message}`
          );
          error.code = missing ? "POPPLER_MISSING" : "PDF_RENDER_FAILED";

          return reject(error);
        }

        try {
          const files = fs
            .readdirSync(tmpDir)
            .filter((f) => f.startsWith("page") && f.endsWith(".png"))
            .sort(byPageNumber);

          const pages = files.map((f) =>
            fs.readFileSync(path.join(tmpDir, f)).toString("base64")
          );

          cleanup(tmpDir);
          resolve(pages);
        } catch (readErr) {
          cleanup(tmpDir);
          reject(readErr);
        }
      }
    );
  });
}

/**
 * pdftoppm pads page numbers to the width of the largest one (page-01 …
 * page-12), so a plain sort is already right; comparing the numbers keeps it
 * right even if that padding ever differs.
 */
function byPageNumber(a, b) {
  const n = (name) => Number(name.match(/(\d+)\.png$/)?.[1] ?? 0);
  return n(a) - n(b);
}

function cleanup(dir) {
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

/* -------------------------------------------------------------------------- */
/* pdf.js                                                                     */
/* -------------------------------------------------------------------------- */

let pdfjsPromise = null;

/**
 * pdf.js ships only as ES modules and this file is CommonJS, so it is loaded
 * with import(), once per process.
 *
 * The worker module is imported alongside it and handed over through
 * globalThis.pdfjsWorker. Left alone, pdf.js would locate its worker by a path
 * it computes at runtime — which a bundler tracing this function's files
 * cannot follow, so the deployed function would lack the file. Two literal
 * import() specifiers are something the tracer can see.
 */
function loadPdfjs() {
  pdfjsPromise ??= Promise.resolve()
    .then(() => {
      // pdf.js draws onto @napi-rs/canvas in Node, but loads it through a
      // require it builds at runtime — invisible to the tracer, which would
      // leave the package (and its native binary) out of a deployed function.
      // Requiring it here by name is what puts it in the bundle; pdf.js then
      // finds the same module already loaded.
      require("@napi-rs/canvas");
    })
    .then(() =>
      Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ])
    )
    .then(([pdfjs, worker]) => {
      globalThis.pdfjsWorker = worker;
      return pdfjs;
    })
    .catch((cause) => {
      // Let a later request try again rather than caching the failure.
      pdfjsPromise = null;
      const error = new Error(`pdf.js could not be loaded: ${cause.message}`);
      error.code = "PDF_RENDERER_UNAVAILABLE";
      error.cause = cause;
      throw error;
    });

  return pdfjsPromise;
}

/**
 * Data pdf.js reads from disk: the 14 standard fonts for PDFs that name one
 * without embedding it, and the CMaps that map character codes in CJK-encoded
 * fonts. Paths, not URLs — in Node pdf.js reads them with fs. Both need the
 * trailing separator.
 */
function pdfjsAssetDir(name) {
  return path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), name) + path.sep;
}

async function renderWithPdfjs(pdfBuffer, dpi) {
  const pdfjs = await loadPdfjs();

  const loadingTask = pdfjs.getDocument({
    // A copy: pdf.js takes ownership of the bytes it is given, and the
    // caller still needs the original buffer for the checksum and storage.
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl: pdfjsAssetDir("standard_fonts"),
    cMapUrl: pdfjsAssetDir("cmaps"),
    cMapPacked: true,
    isEvalSupported: false,
    verbosity: 0,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (cause) {
    await loadingTask.destroy();
    const error = new Error(`pdf.js could not open the PDF: ${cause.message}`);
    error.code = "PDF_RENDER_FAILED";
    error.cause = cause;
    throw error;
  }

  try {
    const pages = [];

    // One page at a time: each canvas at 200 dpi is several megabytes of raw
    // pixels, and nothing is gained by holding all of them at once.
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const { canvas } = doc.canvasFactory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
      );

      // A transparent background would reach the OCR model as whatever colour
      // it assumes behind the alpha; paper is white.
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;

      pages.push(canvas.toBuffer("image/png").toString("base64"));
      page.cleanup();
    }

    return pages;
  } catch (cause) {
    const error = new Error(`pdf.js failed to render the PDF: ${cause.message}`);
    error.code = "PDF_RENDER_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    // Releases the worker and the document's memory; the loading task owns
    // both, not the document.
    await loadingTask.destroy();
  }
}

module.exports = { pdfBufferToPngPages, renderWithPdfjs };
