const crypto = require("crypto");

/**
 * Admin authentication for every write path.
 *
 * Tokens are configured server-side as ADMIN_TOKENS="name:token,name2:token2".
 * Mapping a name to each token is not decoration: reviewer identity is
 * recorded against published schedules and edited entries, so corrections are
 * attributable.
 *
 * Before this existed, /api/schedule/extract was unauthenticated and would
 * overwrite the live schedule for anyone who posted a PDF to it.
 */
/**
 * Strips one layer of wrapping quotes. Quoting the value in .env is a common
 * habit, and without this the quote ends up inside the token, so the token
 * the admin actually types never matches and nothing says why.
 */
function unquote(value) {
  const trimmed = value.trim();
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));

  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseAdminTokens(rawValue = process.env.ADMIN_TOKENS || "") {
  const tokens = new Map();
  const raw = unquote(rawValue);

  for (const pair of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const separator = pair.indexOf(":");

    // A bare token with no "name:" prefix is what most people write first, so
    // accept it rather than silently ignoring the whole entry and reporting
    // the admin system as unconfigured. Attribution falls back to "admin".
    if (separator === -1) {
      tokens.set(unquote(pair), "admin");
      continue;
    }

    const name = unquote(pair.slice(0, separator));
    const token = unquote(pair.slice(separator + 1));

    if (token) tokens.set(token, name || "admin");
  }

  return tokens;
}

/** Constant-time compare so a wrong token cannot be found a byte at a time. */
function matchToken(tokens, presented) {
  const presentedBuffer = Buffer.from(presented);

  for (const [token, name] of tokens) {
    const tokenBuffer = Buffer.from(token);
    if (tokenBuffer.length !== presentedBuffer.length) continue;
    if (crypto.timingSafeEqual(tokenBuffer, presentedBuffer)) return name;
  }

  return null;
}

function requireAdmin(req, res, next) {
  const tokens = parseAdminTokens();

  // Refuse rather than fall open when no tokens are configured. The two
  // cases need different advice, so say which one this is.
  if (tokens.size === 0) {
    const raw = process.env.ADMIN_TOKENS;

    console.error(
      raw
        ? "[auth] ADMIN_TOKENS is set but no usable token could be read from it. " +
            'Expected "name:token" pairs separated by commas, or a bare token. ' +
            "Check for stray quotes or a missing value after the colon."
        : "[auth] ADMIN_TOKENS is not set; refusing all admin requests."
    );

    return res.status(503).json({
      error: { code: "ADMIN_NOT_CONFIGURED", message: "ระบบผู้ดูแลยังไม่ได้ตั้งค่า" },
    });
  }

  const header = req.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!presented) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "ต้องเข้าสู่ระบบผู้ดูแลก่อน" },
    });
  }

  const name = matchToken(tokens, presented);
  if (!name) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "ไม่มีสิทธิ์ดำเนินการนี้" },
    });
  }

  req.admin = { name };
  return next();
}

module.exports = { requireAdmin, parseAdminTokens };
