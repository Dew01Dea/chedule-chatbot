const test = require("node:test");
const assert = require("node:assert/strict");

const { handleRouteError } = require("../lib/httpError");

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// handleRouteError logs; keep the test output readable.
function quietly(run) {
  const original = console.error;
  console.error = () => {};
  try { return run(); } finally { console.error = original; }
}

test("admin routes get the underlying cause, public routes do not", () => {
  const error = Object.assign(new Error('violates check constraint "entries_time_format"'), {
    code: "STORE_ERROR",
  });

  const adminRes = quietly(() => {
    const res = fakeRes();
    handleRouteError(res, error, "test", { detailed: true });
    return res;
  });
  assert.match(adminRes.body.error.detail, /entries_time_format/);

  const publicRes = quietly(() => {
    const res = fakeRes();
    handleRouteError(res, error, "test");
    return res;
  });
  assert.equal(publicRes.body.error.detail, undefined, "a public caller learns nothing extra");
});

test("an unrecognised error keeps its code instead of becoming INTERNAL_ERROR", () => {
  const res = quietly(() => {
    const r = fakeRes();
    handleRouteError(r, Object.assign(new Error("boom"), { code: "SOMETHING_ODD" }), "test", {
      detailed: true,
    });
    return r;
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, "SOMETHING_ODD");
  assert.equal(res.body.error.detail, "boom");
});

test("credentials are stripped from the detail", () => {
  const cases = [
    ["token eyJhbGciOiJIUzI1NiJ9.abcdefghijk.signature123", /<redacted-jwt>/],
    ["key sb_secret_abcdefghijklmnop", /<redacted-key>/],
    ["key sk-abcdefghijklmnopqrst", /<redacted-key>/],
  ];

  for (const [message, expected] of cases) {
    const res = quietly(() => {
      const r = fakeRes();
      handleRouteError(r, Object.assign(new Error(message), { code: "STORE_ERROR" }), "test", {
        detailed: true,
      });
      return r;
    });

    assert.match(res.body.error.detail, expected);
    assert.ok(!/eyJhbGci|sb_secret_abc|sk-abcdefghij/.test(res.body.error.detail), message);
  }
});

test("a missing storage bucket is reported as its own problem", () => {
  const res = quietly(() => {
    const r = fakeRes();
    handleRouteError(
      r,
      Object.assign(new Error('bucket "schedule-pdfs" does not exist'), {
        code: "STORAGE_BUCKET_MISSING",
      }),
      "test",
      { detailed: true }
    );
    return r;
  });

  assert.match(res.body.error.message, /schedule-pdfs/);
});
