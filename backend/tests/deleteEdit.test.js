const test = require("node:test");
const assert = require("node:assert/strict");

const { loadAppWith, startServer } = require("./helpers/testApp");
const { createFakeStore } = require("./helpers/fakeStore");

const ADMIN_TOKEN = "delete-test-token-aaaaaaaaaaaaaaaa";

function scheduleDocument(teacherName, subjectCode, entryId) {
  return {
    semester: "1/2569",
    teacher: { name: teacherName },
    subjects: [{ code: subjectCode, name: "วิชาทดสอบ" }],
    sessions: [
      {
        id: entryId,
        day: "จันทร์",
        timeStart: "09:00",
        timeEnd: "11:00",
        subjectCode,
        room: "COM602",
        group: "สท.4/2",
      },
    ],
  };
}

function seededStore() {
  const store = createFakeStore();

  store.addTeacher({ id: "t-a", code: "a", fullName: "ครูเอ" });
  store.addTeacher({ id: "t-b", code: "b", fullName: "ครูบี" });

  store.addSchedule({
    id: "s-a-published",
    teacherId: "t-a",
    academicYear: 2569,
    semester: 1,
    status: "published",
    version: 1,
    document: scheduleDocument("ครูเอ", "A-1", "entry-a"),
  });

  store.addSchedule({
    id: "s-a-draft",
    teacherId: "t-a",
    academicYear: 2569,
    semester: 2,
    status: "needs_review",
    version: 1,
    document: scheduleDocument("ครูเอ", "A-2", "entry-a-draft"),
  });

  store.addSchedule({
    id: "s-b-published",
    teacherId: "t-b",
    academicYear: 2569,
    semester: 1,
    status: "published",
    version: 1,
    document: scheduleDocument("ครูบี", "B-1", "entry-b"),
  });

  return store;
}

async function withServer(store, run) {
  process.env.ADMIN_TOKENS = `ผู้ดูแล:${ADMIN_TOKEN}`;
  const { app, cleanup } = loadAppWith({
    store,
    typhoon: { async answerScheduleQuestion() { return "ok"; } },
  });
  const server = await startServer(app);
  try {
    await run(server);
  } finally {
    await server.close();
    cleanup();
  }
}

const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const authJson = { ...auth, "Content-Type": "application/json" };

/* -------------------------------------------------------------------------- */
/* Deleting a teacher                                                         */
/* -------------------------------------------------------------------------- */

test("deleting a teacher is refused until confirmed, and says what would be lost", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const first = await server.request("/api/teachers/t-a", { method: "DELETE", headers: auth });

    assert.equal(first.status, 409);
    assert.equal(first.body.error.code, "DELETE_NEEDS_CONFIRM");
    assert.equal(first.body.error.willDelete.scheduleCount, 2);
    assert.equal(first.body.error.willDelete.publishedCount, 1);

    // Nothing was removed by asking.
    assert.ok(await store.getTeacher("t-a"), "the teacher still exists");
  });
});

test("a confirmed teacher delete takes their schedules with it and leaves others alone", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const { status } = await server.request("/api/teachers/t-a?confirm=true", {
      method: "DELETE",
      headers: auth,
    });

    assert.equal(status, 200);
    assert.equal(await store.getTeacher("t-a"), null);
    assert.equal(store._schedules.get("s-a-published"), undefined);
    assert.equal(store._schedules.get("s-a-draft"), undefined);

    // The other teacher is untouched.
    assert.ok(await store.getTeacher("t-b"));
    assert.ok(await store.getPublishedSchedule("t-b"));
  });
});

test("deleting a teacher requires admin", async () => {
  await withServer(seededStore(), async (server) => {
    const { status } = await server.request("/api/teachers/t-a?confirm=true", { method: "DELETE" });
    assert.equal(status, 401);
  });
});

test("deleting a teacher that does not exist is a 404, not a confirmation prompt", async () => {
  await withServer(seededStore(), async (server) => {
    const { status, body } = await server.request("/api/teachers/t-nope", {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(status, 404);
    assert.equal(body.error.code, "TEACHER_NOT_FOUND");
  });
});

/* -------------------------------------------------------------------------- */
/* Deleting a schedule                                                        */
/* -------------------------------------------------------------------------- */

test("deleting a published schedule needs explicit confirmation", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const first = await server.request("/api/admin/schedules/s-a-published", {
      method: "DELETE",
      headers: auth,
    });

    assert.equal(first.status, 409);
    assert.equal(first.body.error.code, "PUBLISHED_DELETE_NEEDS_CONFIRM");
    assert.ok(store._schedules.get("s-a-published"), "still there");

    const second = await server.request(
      "/api/admin/schedules/s-a-published?confirmPublished=true",
      { method: "DELETE", headers: auth }
    );
    assert.equal(second.status, 200);
    assert.equal(store._schedules.get("s-a-published"), undefined);
  });
});

test("deleting a draft needs no extra confirmation", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const { status } = await server.request("/api/admin/schedules/s-a-draft", {
      method: "DELETE",
      headers: auth,
    });

    assert.equal(status, 200);
    assert.equal(store._schedules.get("s-a-draft"), undefined);
    assert.ok(store._schedules.get("s-a-published"), "the published one is untouched");
  });
});

test("unpublishing keeps the data and only changes its status", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const { status } = await server.request("/api/admin/schedules/s-a-published/unpublish", {
      method: "POST",
      headers: auth,
    });

    assert.equal(status, 200);
    assert.equal(store._schedules.get("s-a-published").status, "archived");
    assert.equal(await store.getPublishedSchedule("t-a"), null, "no longer answered from");

    // Unpublishing something already archived is refused rather than silently ok.
    const again = await server.request("/api/admin/schedules/s-a-published/unpublish", {
      method: "POST",
      headers: auth,
    });
    assert.equal(again.status, 409);
  });
});

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

test("a row can be added by hand for the ones OCR missed", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const { status, body } = await server.request("/api/admin/schedules/s-a-draft/entries", {
      method: "POST",
      headers: authJson,
      body: JSON.stringify({
        day: "ศุกร์",
        timeStart: "13:00",
        timeEnd: "15:00",
        subjectCode: "A-2",
        room: "COM301",
      }),
    });

    assert.equal(status, 201);
    assert.equal(body.entry.day, "ศุกร์");

    const schedule = await store.getScheduleForReview("s-a-draft");
    assert.equal(schedule.sessions.length, 2);
  });
});

test("a row can be deleted", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const { status } = await server.request(
      "/api/admin/schedules/s-a-draft/entries/entry-a-draft",
      { method: "DELETE", headers: auth }
    );

    assert.equal(status, 200);
    const schedule = await store.getScheduleForReview("s-a-draft");
    assert.equal(schedule.sessions.length, 0);
  });
});

test("a row cannot be deleted through another schedule", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    // entry-b belongs to teacher B's schedule.
    const { status } = await server.request("/api/admin/schedules/s-a-draft/entries/entry-b", {
      method: "DELETE",
      headers: auth,
    });

    assert.equal(status, 404);

    const untouched = await store.getScheduleForReview("s-b-published");
    assert.equal(untouched.sessions.length, 1, "teacher B's row survives");
  });
});

test("row changes require admin", async () => {
  await withServer(seededStore(), async (server) => {
    const add = await server.request("/api/admin/schedules/s-a-draft/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "ศุกร์" }),
    });
    assert.equal(add.status, 401);

    const remove = await server.request(
      "/api/admin/schedules/s-a-draft/entries/entry-a-draft",
      { method: "DELETE" }
    );
    assert.equal(remove.status, 401);
  });
});

/* -------------------------------------------------------------------------- */
/* Schedule metadata                                                          */
/* -------------------------------------------------------------------------- */

test("schedule metadata can be corrected", async () => {
  const store = seededStore();

  await withServer(store, async (server) => {
    const { status } = await server.request("/api/admin/schedules/s-a-draft", {
      method: "PATCH",
      headers: authJson,
      body: JSON.stringify({ semesterStartDate: "2026-05-18", semesterEndDate: "2026-09-30" }),
    });

    assert.equal(status, 200);
    assert.equal(store._schedules.get("s-a-draft").semesterStartDate, "2026-05-18");
  });
});
