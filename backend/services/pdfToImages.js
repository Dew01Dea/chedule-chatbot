const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pdftoppmCommand, popplerSource } = require("../lib/poppler");

/**
 * Rasterizes every page of a PDF into PNG images using poppler's `pdftoppm`.
 * Typhoon OCR (like most document-vision models) reads page images, not raw
 * PDF bytes, so this conversion step happens before every OCR call.
 *
 * Requires poppler-utils installed on the host machine:
 *   - macOS:  brew install poppler
 *   - Ubuntu: sudo apt-get install poppler-utils
 *   - Windows: install poppler and add its /bin folder to PATH
 *
 * Returns an array of base64-encoded PNG strings, one per page, in order.
 */
function pdfBufferToPngPages(pdfBuffer, dpi = 200) {
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

          // ENOENT means the binary itself is not on PATH, which is a setup
          // problem the operator can fix — quite different from a PDF that
          // poppler could not read. They need different advice, so they get
          // different codes.
          //
          // And a missing binary splits again by where the server runs. On a
          // host with a filesystem, poppler can be installed and pointed at.
          // In a serverless function it cannot be installed at all, so the
          // usual advice would send an operator hunting for a setting that
          // could never have worked. VERCEL is set by that platform itself.
          const missing = err.code === "ENOENT";
          const serverless = Boolean(process.env.VERCEL);

          const error = new Error(
            !missing
              ? `pdftoppm failed to render the PDF: ${err.message}`
              : serverless
                ? "pdftoppm cannot exist in a serverless function, so this deployment " +
                  "cannot rasterize PDFs. Run the backend where poppler is installed."
                : `pdftoppm was not found. Looked in: ${popplerSource()}. ` +
                  "Set POPPLER_PATH in backend/.env to poppler's bin directory."
          );
          error.code = !missing
            ? "PDF_RENDER_FAILED"
            : serverless
              ? "POPPLER_UNAVAILABLE"
              : "POPPLER_MISSING";

          return reject(error);
        }

        try {
          const files = fs
            .readdirSync(tmpDir)
            .filter((f) => f.startsWith("page") && f.endsWith(".png"))
            .sort(); // page-1.png, page-2.png, ... sorts correctly for <10 pages

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

function cleanup(dir) {
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

module.exports = { pdfBufferToPngPages };
