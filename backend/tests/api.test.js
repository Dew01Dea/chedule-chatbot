const test = require("node:test");
const assert = require("node:assert/strict");

const { loadAppWith, startServer } = require("./helpers/testApp");
const { createFakeStore } = require("./helpers/fakeStore");

const ADMIN_TOKEN = "test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_LENGTH_TOKEN = "short";

function scheduleDocument(teacherName, subjectName, subjectCode) {
  return {
    college: "วิทยาลัยเทคนิคสัตหีบ",
    semester: "1/2569",
    teacher: { name: teacherName },
    subjects: [{ code: subjectCode, name: subjectName }],
    sessions: [
      {
        id: `${subjectCode}-entry`,
        day: "จันทร์",
        timeStart: "09:00",
        timeEnd: "11:00",
        subjectCode,
        type: "ปฏิบัติ",
        room: "COM602",
        group: "สท.4/2",
      },
    ],
  };
}

/**
 * Builds an app whose Typhoon call records the schedule it was handed, so
 * tests can assert exactly which teacher's data reached the model.
 */
function setup({ store }) {
  const seen = [];

  const loaded = loadAppWith({
    store,
    typhoon: {
      async answerScheduleQuestion(question, scheduleData) {
        seen.push(scheduleData);
        return `ANSWERED_FOR:${scheduleData.teacher?.name}`;
      },
      async ocrPdfWithTyphoon() {
        return "| ตารางสอน |";
      },
      async structureScheduleFromMarkdown() {
        return scheduleDocument("นายใหม่ ทดสอบ", "วิชาใหม่", "NEW-001");
      },
    },
  });

  return { ...loaded, seen };
}

function twoTeacherStore() {
  const store = createFakeStore();

  store.addTeacher({ id: "t-maitri", code: "maitri", fullName: "นายไมตรี นาโพธิ์" });
  store.addTeacher({ id: "t-somying", code: "somying", fullName: "นางสาวสมหญิง ใจดี" });
  store.addTeacher({ id: "t-draft", code: "draftonly", fullName: "นายยังไม่ตรวจ สอบ" });

  store.addSchedule({
    id: "s-maitri",
    teacherId: "t-maitri",
    academicYear: 2569,
    semester: 1,
    status: "published",
    version: 1,
    document: scheduleDocument("นายไมตรี นาโพธิ์", "เทคโนโลยีการจัดการฐานข้อมูล", "31901-2007"),
  });

  store.addSchedule({
    id: "s-somying",
    teacherId: "t-somying",
    academicYear: 2569,
    semester: 1,
    status: "published",
    version: 1,
    document: scheduleDocument("นางสาวสมหญิง ใจดี", "ภาษาไทย", "TH-101"),
  });

  // Uploaded and validated, but not published: must stay invisible.
  store.addSchedule({
    id: "s-draft",
    teacherId: "t-draft",
    academicYear: 2569,
    semester: 1,
    status: "needs_review",
    version: 1,
    document: scheduleDocument("นายยังไม่ตรวจ สอบ", "วิชาที่ยังไม่ตรวจ", "X-1"),
  });

  return store;
}

async function withServer(store, run) {
  process.env.ADMIN_TOKENS = `ผู้ดูแลทดสอบ:${ADMIN_TOKEN}`;
  const { app, cleanup, seen } = setup({ store });
  const server = await startServer(app);
  try {
    await run(server, seen);
  } finally {
    await server.close();
    cleanup();
  }
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* -------------------------------------------------------------------------- */
/* Teacher listing                                                            */
/* -------------------------------------------------------------------------- */

test("the picker lists only teachers with a published schedule", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await server.request("/api/teachers");

    assert.equal(status, 200);
    const ids = body.teachers.map((t) => t.id).sort();
    assert.deepEqual(ids, ["t-maitri", "t-somying"]);
    assert.ok(!ids.includes("t-draft"), "a teacher with only an unreviewed draft is not offered");
  });
});

/* -------------------------------------------------------------------------- */
/* Chat scoping                                                               */
/* -------------------------------------------------------------------------- */

test("a question must name a teacher", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await server.request("/api/chat", json({ message: "วันจันทร์สอนอะไร" }));

    assert.equal(status, 400);
    assert.equal(body.error.code, "TEACHER_REQUIRED");
  });
});

test("only the selected teacher's schedule reaches the model", async () => {
  await withServer(twoTeacherStore(), async (server, seen) => {
    const { status, body } = await server.request(
      "/api/chat",
      json({ message: "วันจันทร์สอนอะไร", teacherId: "t-somying" })
    );

    assert.equal(status, 200);
    assert.equal(body.reply, "ANSWERED_FOR:นางสาวสมหญิง ใจดี");

    assert.equal(seen.length, 1);
    assert.equal(seen[0].teacher.name, "นางสาวสมหญิง ใจดี");

    // The decisive check: the other teacher's data is nowhere in the context.
    const context = JSON.stringify(seen[0]);
    assert.ok(!context.includes("ไมตรี"), "no trace of the other teacher");
    assert.ok(!context.includes("31901-2007"), "no trace of the other teacher's subjects");
  });
});

test("each teacher is answered from their own schedule", async () => {
  await withServer(twoTeacherStore(), async (server, seen) => {
    await server.request("/api/chat", json({ message: "สอนอะไร", teacherId: "t-maitri" }));
    await server.request("/api/chat", json({ message: "สอนอะไร", teacherId: "t-somying" }));

    assert.equal(seen[0].subjects[0].name, "เทคโนโลยีการจัดการฐานข้อมูล");
    assert.equal(seen[1].subjects[0].name, "ภาษาไทย");
  });
});

test("an unknown teacher id is refused, not answered from someone else's data", async () => {
  await withServer(twoTeacherStore(), async (server, seen) => {
    const { status, body } = await server.request(
      "/api/chat",
      json({ message: "สอนอะไร", teacherId: "t-does-not-exist" })
    );

    assert.equal(status, 404);
    assert.equal(body.error.code, "SCHEDULE_NOT_FOUND");
    assert.equal(seen.length, 0, "the model is never called without data");
  });
});

test("a teacher whose schedule is still in review cannot be chatted with", async () => {
  await withServer(twoTeacherStore(), async (server, seen) => {
    const { status, body } = await server.request(
      "/api/chat",
      json({ message: "สอนอะไร", teacherId: "t-draft" })
    );

    assert.equal(status, 404);
    assert.equal(body.error.code, "SCHEDULE_NOT_FOUND");
    assert.equal(seen.length, 0, "unreviewed data never reaches the chatbot");
  });
});

test("an empty or oversized message is rejected", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const empty = await server.request("/api/chat", json({ message: "   ", teacherId: "t-maitri" }));
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, "MESSAGE_REQUIRED");

    const huge = await server.request(
      "/api/chat",
      json({ message: "ก".repeat(1001), teacherId: "t-maitri" })
    );
    assert.equal(huge.status, 400);
    assert.equal(huge.body.error.code, "MESSAGE_TOO_LONG");
  });
});

test("a bad semester is rejected before any lookup", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await server.request(
      "/api/chat",
      json({ message: "สอนอะไร", teacherId: "t-maitri", semester: 9 })
    );

    assert.equal(status, 400);
    assert.equal(body.error.code, "SEMESTER_INVALID");
  });
});

/* -------------------------------------------------------------------------- */
/* Admin authorisation                                                        */
/* -------------------------------------------------------------------------- */

test("admin endpoints reject anonymous callers", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const routes = [
      ["/api/admin/schedules/upload", { method: "POST" }],
      ["/api/admin/schedules/s-maitri", {}],
      ["/api/admin/teachers/t-maitri/schedules", {}],
      ["/api/admin/schedules/s-maitri/publish", { method: "POST" }],
    ];

    for (const [pathname, options] of routes) {
      const { status } = await server.request(pathname, options);
      assert.equal(status, 401, `${pathname} must require authentication`);
    }
  });
});

test("a wrong token is rejected, including one of a different length", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    for (const token of [`${ADMIN_TOKEN}x`, OTHER_LENGTH_TOKEN, "totally-wrong-but-same-lengthxxxxxx"]) {
      const { status } = await server.request("/api/admin/schedules/s-maitri", {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(status, 403, `token "${token}" must be rejected`);
    }
  });
});

test("creating a teacher requires admin, and validates its input", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const anonymous = await server.request("/api/teachers", json({ code: "x", fullName: "y" }));
    assert.equal(anonymous.status, 401);

    const missingName = await server.request("/api/teachers", {
      ...json({ code: "newteacher" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(missingName.status, 400);
    assert.equal(missingName.body.error.code, "NAME_REQUIRED");
  });
});

/* -------------------------------------------------------------------------- */
/* Upload validation                                                          */
/* -------------------------------------------------------------------------- */

async function upload(server, { bytes, teacherId = "t-maitri", academicYear = 2569, semester = 1, token = ADMIN_TOKEN }) {
  const form = new FormData();
  form.append("schedulePdf", new Blob([bytes], { type: "application/pdf" }), "schedule.pdf");
  form.append("teacherId", teacherId);
  form.append("academicYear", String(academicYear));
  form.append("semester", String(semester));

  return server.request("/api/admin/schedules/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

test("a file that is not really a PDF is rejected despite its content type", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await upload(server, {
      bytes: Buffer.from("<html>definitely not a pdf</html>"),
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, "NOT_A_PDF");
  });
});

test("an unknown teacher cannot be uploaded against", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await upload(server, {
      bytes: Buffer.from("%PDF-1.4 fake"),
      teacherId: "t-nobody",
    });

    assert.equal(status, 404);
    assert.equal(body.error.code, "TEACHER_NOT_FOUND");
  });
});

test("an invalid semester is rejected before the file is processed", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await upload(server, {
      bytes: Buffer.from("%PDF-1.4 fake"),
      semester: 7,
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, "SEMESTER_INVALID");
  });
});

test("a successful upload lands as a draft and does not touch the live schedule", async () => {
  const store = twoTeacherStore();

  await withServer(store, async (server) => {
    const { status, body } = await upload(server, { bytes: Buffer.from("%PDF-1.4 fake") });

    assert.equal(status, 201);
    assert.notEqual(body.status, "published", "an upload is never published automatically");

    // The teacher's live schedule is untouched.
    const live = await store.getPublishedSchedule("t-maitri");
    assert.equal(live.subjects[0].code, "31901-2007", "the published schedule still serves");
  });
});

test("re-uploading the same file is refused instead of creating a second schedule", async () => {
  const store = twoTeacherStore();

  await withServer(store, async (server) => {
    const bytes = Buffer.from("%PDF-1.4 identical bytes");

    const first = await upload(server, { bytes });
    assert.equal(first.status, 201);

    const second = await upload(server, { bytes });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, "DUPLICATE_UPLOAD");
  });
});

test("the same file may still be uploaded for a different teacher", async () => {
  const store = twoTeacherStore();

  await withServer(store, async (server) => {
    const bytes = Buffer.from("%PDF-1.4 shared bytes");

    assert.equal((await upload(server, { bytes, teacherId: "t-maitri" })).status, 201);
    assert.equal((await upload(server, { bytes, teacherId: "t-somying" })).status, 201);
  });
});

/* -------------------------------------------------------------------------- */
/* Publishing                                                                 */
/* -------------------------------------------------------------------------- */

test("publishing a new schedule leaves other teachers untouched", async () => {
  const store = twoTeacherStore();

  await withServer(store, async (server) => {
    const uploaded = await upload(server, { bytes: Buffer.from("%PDF-1.4 new term") });
    const newId = uploaded.body.scheduleId;

    const published = await server.request(`/api/admin/schedules/${newId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(published.status, 200);

    // The replaced schedule is archived, not deleted.
    assert.equal(store._schedules.get("s-maitri").status, "archived");

    // The other teacher is entirely unaffected.
    const other = await store.getPublishedSchedule("t-somying");
    assert.ok(other, "the other teacher still has a published schedule");
    assert.equal(other.subjects[0].name, "ภาษาไทย");
  });
});

test("editing an entry of one schedule cannot reach another", async () => {
  const store = twoTeacherStore();

  await withServer(store, async (server) => {
    // A real entry id, but addressed through the wrong schedule.
    const { status } = await server.request(
      "/api/admin/schedules/s-maitri/entries/TH-101-entry",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ room: "HACKED" }),
      }
    );

    assert.equal(status, 404);

    const untouched = await store.getPublishedSchedule("t-somying");
    assert.equal(untouched.sessions[0].room, "COM602", "the other schedule is unchanged");
  });
});

/* -------------------------------------------------------------------------- */
/* Legacy endpoint                                                            */
/* -------------------------------------------------------------------------- */

test("the old unauthenticated extract endpoint is gone and says where to go", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await server.request("/api/schedule/extract", { method: "POST" });

    assert.equal(status, 410);
    assert.match(body.error.message, /\/api\/admin\/schedules\/upload/);
  });
});

test("health reports which store is active", async () => {
  await withServer(twoTeacherStore(), async (server) => {
    const { status, body } = await server.request("/api/health");

    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.multiTeacher, true);
  });
});
