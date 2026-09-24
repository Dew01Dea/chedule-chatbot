const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { pdfBufferToPngPages, renderWithPdfjs } = require("../services/pdfToImages");

/**
 * A one-page A4 PDF drawing a line of text in a standard font, written by hand
 * so the test needs no fixture file and no PDF library. The byte offsets in
 * the xref table are computed, not typed, so the file is well-formed and pdf.js
 * reads it without falling back to repair.
 */
function minimalPdf(text = "Schedule 2569") {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

function pngSize(base64) {
  const png = Buffer.from(base64, "base64");
  assert.equal(png.subarray(1, 4).toString(), "PNG", "output is a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// The renderer used wherever poppler cannot be installed — a serverless
// function in particular — so it is tested on its own, whatever this machine
// happens to have installed.
test("pdf.js renders each page to a PNG at the requested resolution", async () => {
  const pages = await renderWithPdfjs(minimalPdf(), 200);

  assert.equal(pages.length, 1);
  // A4 at 200 dpi: 595 x 842 points, 72 points to the inch.
  assert.deepEqual(pngSize(pages[0]), {
    width: Math.ceil((595 * 200) / 72),
    height: Math.ceil((842 * 200) / 72),
  });
});

test("rendering leaves the caller's buffer intact for the checksum and storage", async () => {
  const pdf = minimalPdf();
  const before = crypto.createHash("sha256").update(pdf).digest("hex");

  await renderWithPdfjs(pdf, 72);

  assert.equal(crypto.createHash("sha256").update(pdf).digest("hex"), before);
});

test("a file that is not really a PDF is reported as unreadable, not as a crash", async () => {
  await assert.rejects(
    renderWithPdfjs(Buffer.from("%PDF-1.4\nnothing else here"), 72),
    (error) => error.code === "PDF_RENDER_FAILED"
  );
});

test("without poppler, rendering falls back to pdf.js instead of failing", async () => {
  // Point the poppler lookup at a directory with no pdftoppm in it, which is
  // exactly the situation in a serverless function.
  const saved = process.env.POPPLER_PATH;
  process.env.POPPLER_PATH = "/nonexistent-poppler-bin";

  try {
    const pages = await pdfBufferToPngPages(minimalPdf(), 72);
    assert.equal(pages.length, 1);
    assert.deepEqual(pngSize(pages[0]), { width: 595, height: 842 });
  } finally {
    if (saved === undefined) delete process.env.POPPLER_PATH;
    else process.env.POPPLER_PATH = saved;
  }
});
