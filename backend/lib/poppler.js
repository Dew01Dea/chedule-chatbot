const path = require("path");
const { execFile } = require("child_process");

/**
 * Locating poppler's pdftoppm.
 *
 * Relying on PATH alone turns out to be fragile in practice, especially on
 * Windows: a process inherits PATH when it starts, and an editor's integrated
 * terminal inherits it from the editor, which inherited it at launch. Someone
 * can install poppler, see it work in a fresh shell, and still have a server
 * that cannot find it — with no way to tell the two apart from the outside.
 *
 * So POPPLER_PATH is the escape hatch: point it at poppler's bin directory and
 * PATH stops mattering. Everything that needs pdftoppm resolves it through
 * here, so the setup check and the server can never disagree about it.
 */
function pdftoppmCommand() {
  const dir = process.env.POPPLER_PATH?.trim();
  // No extension: on Windows the runtime appends .exe from PATHEXT.
  return dir ? path.join(dir, "pdftoppm") : "pdftoppm";
}

/** Where we are looking, for error messages and diagnostics. */
function popplerSource() {
  const dir = process.env.POPPLER_PATH?.trim();
  return dir ? `POPPLER_PATH (${dir})` : "PATH ของโปรเซสเซิร์ฟเวอร์";
}

/**
 * Resolves whether pdftoppm can actually be run.
 * `pdftoppm -v` prints its banner to stderr and may exit non-zero, so a
 * non-ENOENT failure still means the binary is there.
 */
function checkPoppler() {
  return new Promise((resolve) => {
    execFile(pdftoppmCommand(), ["-v"], (error, stdout, stderr) => {
      if (error && (error.code === "ENOENT" || error.code === "EACCES")) {
        return resolve({
          available: false,
          lookedIn: popplerSource(),
          reason:
            error.code === "EACCES"
              ? "พบไฟล์ pdftoppm แต่รันไม่ได้ (สิทธิ์ไม่พอ)"
              : "ไม่พบคำสั่ง pdftoppm",
        });
      }

      const banner = String(stderr || stdout || "").trim().split("\n")[0] || null;
      return resolve({ available: true, lookedIn: popplerSource(), version: banner });
    });
  });
}

module.exports = { pdftoppmCommand, popplerSource, checkPoppler };
