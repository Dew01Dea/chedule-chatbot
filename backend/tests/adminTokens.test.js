const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAdminTokens } = require("../middleware/requireAdmin");

test("the documented name:token form works", () => {
  const tokens = parseAdminTokens("dew:abc123");
  assert.equal(tokens.get("abc123"), "dew");
});

test("several reviewers can be configured", () => {
  const tokens = parseAdminTokens("dew:abc, somchai:xyz");
  assert.equal(tokens.get("abc"), "dew");
  assert.equal(tokens.get("xyz"), "somchai");
});

test("a bare token with no name is accepted", () => {
  // The whole entry used to be skipped, which reported the admin system as
  // unconfigured while ADMIN_TOKENS was plainly set.
  const tokens = parseAdminTokens("abc123");
  assert.equal(tokens.get("abc123"), "admin");
});

test("wrapping quotes do not end up inside the token", () => {
  for (const raw of ['"dew:abc123"', "'dew:abc123'", '"abc123"']) {
    const tokens = parseAdminTokens(raw);
    assert.ok(tokens.has("abc123"), `${raw} should yield the bare token`);
  }
});

test("an entry with no token is rejected rather than matching an empty string", () => {
  for (const raw of ["dew:", "", "   ", ","]) {
    assert.equal(parseAdminTokens(raw).size, 0, `${JSON.stringify(raw)} must yield nothing`);
  }
});

test("a token that is only whitespace is not usable", () => {
  assert.equal(parseAdminTokens("dew:   ").size, 0);
});
