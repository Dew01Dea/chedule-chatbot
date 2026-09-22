const test = require("node:test");
const assert = require("node:assert/strict");

const {
  teacherDisplayName,
  getCurrentScheduleReply,
  parseScheduleJson,
} = require("../services/typhoonService");

const realSchedule = require("../data/schedule.json");

test("the existing teacher still reads exactly as before", () => {
  // The replies used to hardcode "ครูไมตรี"; deriving it must not change them.
  assert.equal(teacherDisplayName(realSchedule.teacher), "ครูไมตรี");
});

test("other teachers get their own label", () => {
  assert.equal(teacherDisplayName({ name: "นางสาวสมหญิง ใจดี" }), "ครูสมหญิง");
  assert.equal(teacherDisplayName({ name: "นางมาลี รักเรียน" }), "ครูมาลี");
  assert.equal(teacherDisplayName({ name: "ว่าที่ร้อยตรีสมชาย มั่นคง" }), "ครูสมชาย");
  assert.equal(teacherDisplayName({ name: "ดร.ปรีชา วิทยา" }), "ครูปรีชา");
  assert.equal(teacherDisplayName("นายไมตรี นาโพธิ์"), "ครูไมตรี", "accepts a bare string too");
});

test("a missing name falls back to a neutral label rather than inventing one", () => {
  for (const input of [null, undefined, {}, { name: "" }, { name: "   " }]) {
    assert.equal(teacherDisplayName(input), "ครูผู้สอน");
  }
});

const monday = {
  isoDate: "2026-09-21",
  weekdayTh: "จันทร์",
  timeHHMM: "09:30",
  formatted: "วันจันทร์ที่ 21 กันยายน พ.ศ. 2569 (2026-09-21) เวลา 09:30 น.",
};

test("the 'ตอนนี้' fast path names the schedule's own teacher", () => {
  const reply = getCurrentScheduleReply("ตอนนี้สอนอะไรอยู่", realSchedule, monday, "ครูไมตรี");

  assert.match(reply, /ตอนนี้ครูไมตรีกำลังสอน/);
  assert.match(reply, /เทคโนโลยีการจัดการฐานข้อมูล/, "answers from the real 09:00–11:00 Monday session");
});

test("the same code answers for a different teacher without any teacher-specific branch", () => {
  const otherTeacher = {
    teacher: { name: "นางสาวสมหญิง ใจดี" },
    subjects: [{ code: "SUB-1", name: "ภาษาไทย" }],
    sessions: [
      { day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "SUB-1", type: "ทฤษฎี", room: "R1", group: "ม.1/1" },
    ],
  };

  const reply = getCurrentScheduleReply("ตอนนี้สอนอะไรอยู่", otherTeacher, monday, "ครูสมหญิง");

  assert.match(reply, /ตอนนี้ครูสมหญิงกำลังสอน/);
  assert.match(reply, /ภาษาไทย/);
  assert.ok(!reply.includes("ไมตรี"), "no trace of the previously hardcoded teacher");
});

test("a free teacher is reported as free, under their own name", () => {
  const quiet = {
    teacher: { name: "นางมาลี รักเรียน" },
    subjects: [],
    sessions: [],
  };

  const reply = getCurrentScheduleReply("ตอนนี้ว่างไหม", quiet, monday, "ครูมาลี");
  assert.equal(reply, "ตอนนี้ครูมาลีว่าง ไม่มีคาบเรียน");
});

test("outside working hours the reply uses the teacher's own name", () => {
  const evening = { ...monday, timeHHMM: "20:00" };
  const reply = getCurrentScheduleReply("ตอนนี้สอนอะไรอยู่", realSchedule, evening, "ครูไมตรี");

  assert.match(reply, /นอกเวลาทำการ/);
  assert.match(reply, /ครูไมตรีไม่มีคาบเรียน/);
});

test("model output wrapped in fences or prose is still parsed", () => {
  assert.deepEqual(parseScheduleJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseScheduleJson('นี่คือผลลัพธ์ครับ {"a":1}'), { a: 1 });
  assert.deepEqual(parseScheduleJson('{"a":1}'), { a: 1 });
});

test("output that is not JSON raises a typed error instead of a SyntaxError", () => {
  assert.throws(
    () => parseScheduleJson("ขอโทษครับ ผมอ่านเอกสารนี้ไม่ออก"),
    (err) => err.code === "STRUCTURING_NOT_JSON"
  );
});
