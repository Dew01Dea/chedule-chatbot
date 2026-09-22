/**
 * A PDF's first bytes are "%PDF-". The upload route checks this rather than
 * trusting the multipart Content-Type, which the client supplies and can set
 * to anything.
 */
function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

module.exports = { looksLikePdf };
