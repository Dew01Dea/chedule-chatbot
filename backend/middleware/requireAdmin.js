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
function parseAdminTokens(raw = process.env.ADMIN_TOKENS || "") {
  const tokens = new Map();

  for (const pair of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const separator = pair.indexOf(":");
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    const token = pair.slice(separator + 1).trim();
    if (name && token) tokens.set(token, name);
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

  // Refuse rather than fall open when no tokens are configured.
  if (tokens.size === 0) {
    console.error("[auth] ADMIN_TOKENS is not configured; refusing all admin requests.");
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
