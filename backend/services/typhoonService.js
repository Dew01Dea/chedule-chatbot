const { pdfBufferToPngPages } = require("./pdfToImages");

const TYPHOON_API_URL =
  "https://api.opentyphoon.ai/v1/chat/completions";

const OCR_MODEL = "typhoon-ocr";
const CHAT_MODEL = "typhoon-v2.5-30b-a3b-instruct";

/**
 * Shared helper for calling Typhoon's OpenAI-compatible chat completions endpoint.
 */
async function callTyphoon(body) {
  // อ่าน API Key จาก .env และตัดช่องว่างที่อาจติดมาด้วย
  const apiKey = process.env.TYPHOON_API_KEY?.trim();

  // ตรวจสอบว่า API Key ถูกโหลดหรือไม่
  if (!apiKey) {
    throw new Error(
      "TYPHOON_API_KEY is missing. Please check backend/.env"
    );
  }

  console.log("Typhoon API Key loaded:", true);
  console.log("Typhoon API Key length:", apiKey.length);

  const response = await fetch(TYPHOON_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();

    throw new Error(
      `Typhoon API request failed (${response.status}): ${errText}`
    );
  }

  const data = await response.json();

  return data.choices?.[0]?.message?.content ?? "";
}

const OCR_PROMPT = `This image is one page of a Thai school class-schedule document.
Transcribe every piece of text exactly as written, preserving all Thai characters,
tone marks, and numbers precisely — do not translate or normalize anything.
Reconstruct the schedule grid as a markdown table, keeping rows for each day and
columns for each time period, plus any header fields (college name, semester,
teacher name, subject list, etc.) as plain text above the table.
Output only the transcription — no commentary.`;

/**
 * OCRs a single page image (base64 PNG) with Typhoon OCR and returns markdown text.
 */
async function ocrImagePage(base64Png) {
  return callTyphoon({
    model: OCR_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: OCR_PROMPT,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Png}`,
            },
          },
        ],
      },
    ],
    max_tokens: 8000,
    temperature: 0.1,
    top_p: 0.6,
    repetition_penalty: 1.05,
  });
}

/**
 * OCRs every page of a PDF and concatenates the resulting markdown, in page order.
 */
async function ocrPdfWithTyphoon(pdfBuffer) {
  const pages = await pdfBufferToPngPages(pdfBuffer);

  if (pages.length === 0) {
    throw new Error(
      "No pages could be rendered from the uploaded PDF."
    );
  }

  const pageMarkdowns = [];

  for (let i = 0; i < pages.length; i++) {
    const markdown = await ocrImagePage(pages[i]);

    pageMarkdowns.push(
      `--- Page ${i + 1} ---\n${markdown}`
    );
  }

  return pageMarkdowns.join("\n\n");
}

// The JSON shape we want back after structuring
const SCHEMA_INSTRUCTIONS = `Below is a raw markdown transcription of a Thai class-schedule document,
produced by an OCR model. Convert it into ONLY this JSON shape, nothing else
(no markdown fences, no commentary, no extra keys):

{
  "college": string,
  "semester": string,
  "department": string,
  "weekRange": string,
  "teacher": {
    "name": string,
    "education": string,
    "duty": string
  },
  "subjects": [
    {
      "code": string,
      "name": string,
      "hours": {
        "theory": number,
        "practice": number,
        "creditUnits": number,
        "totalHoursPerWeek": number
      }
    }
  ],
  "sessions": [
    {
      "day": string,
      "dayEn": string,
      "timeStart": "HH:MM",
      "timeEnd": "HH:MM",
      "subjectCode": string,
      "type": "ทฤษฎี" | "ปฏิบัติ",
      "room": string,
      "group": string,
      "studentCount": number,
      "note": string
    }
  ]
}

Rules:
- Keep all Thai text exactly as written in the document.
- "ท." prefix in a cell means type "ทฤษฎี".
- "ป." prefix in a cell means type "ปฏิบัติ".
- Merge adjacent time columns that show the same class into a single session.
- If a cell says "ออนไลน์" or "สถานประกอบการ", put that in "room" and add a short "note".
- Every session's subjectCode must match one of the codes listed in "subjects".
- Reconcile duplicated OCR text where necessary.
- Respond with raw JSON only, no markdown code fences.`;

/**
 * Takes the raw Thai markdown produced by Typhoon OCR
 * and structures it into the schedule JSON schema.
 */
async function structureScheduleFromMarkdown(ocrMarkdown) {
  const rawText = await callTyphoon({
    model: CHAT_MODEL,
    messages: [
      {
        role: "system",
        content: SCHEMA_INSTRUCTIONS,
      },
      {
        role: "user",
        content: `OCR TRANSCRIPTION:\n${ocrMarkdown}`,
      },
    ],
    max_tokens: 4000,
    temperature: 0.1,
  });

  const cleaned = rawText
    .replace(/```json|```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

function formatSessionReply(
  session,
  scheduleData,
  prefix = "ตอนนี้ครูไมตรีกำลังสอน"
) {
  const subject = scheduleData.subjects.find(
    ({ code }) => code === session.subjectCode
  );

  const subjectName =
    subject?.name || session.subjectCode;

  return `${prefix}วิชา${subjectName} (${session.type}) ห้อง ${session.room} กลุ่ม ${session.group} (เวลา ${session.timeStart}–${session.timeEnd})`;
}

function formatHolidayDate(isoDate) {
  const [year, month, day] = isoDate.split("-");

  return `${day}/${month}/${year}`;
}

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function getCurrentMonthHolidayReply(
  question,
  today,
  holidays
) {
  if (!/วันหยุด/.test(question)) {
    return null;
  }

  const monthOffset =
    /เดือนหน้า/.test(question)
      ? 1
      : /เดือนที่แล้ว|เดือนก่อน/.test(question)
      ? -1
      : /(เดือนนี้|เดือนปัจจุบัน)/.test(question)
      ? 0
      : null;

  if (
    monthOffset === null ||
    !today.isoDate
  ) {
    return null;
  }

  const [year, month] =
    today.isoDate.split("-").map(Number);

  const targetDate = new Date(
    Date.UTC(
      year,
      month - 1 + monthOffset,
      1
    )
  );

  const targetYear =
    targetDate.getUTCFullYear();

  const targetMonth =
    targetDate.getUTCMonth() + 1;

  const targetMonthKey =
    `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

  const targetMonthHolidays =
    holidays.filter(({ date }) =>
      date.startsWith(`${targetMonthKey}-`)
    );

  const monthName =
    THAI_MONTHS[targetMonth - 1];

  const yearBE = targetYear + 543;

  const monthLabel =
    monthOffset === -1
      ? "เดือนที่แล้ว"
      : monthOffset === 0
      ? "เดือนนี้"
      : "เดือนหน้า";

  if (targetMonthHolidays.length === 0) {
    return `${monthLabel} (${monthName} พ.ศ. ${yearBE}) ไม่มีวันหยุดราชการ`;
  }

  return [
    `วันหยุดราชการ${monthLabel} (${monthName} พ.ศ. ${yearBE}) มีดังนี้:`,
    ...targetMonthHolidays.map(
      ({ date, name }) =>
        `- ${formatHolidayDate(date)} (${name})`
    ),
    "หมายเหตุ: เป็นวันหยุดราชการระดับประเทศ ไม่รวมวันปิดภาคกลางเทอมของวิทยาลัย",
  ].join("\n");
}

function getTomorrowHolidayReply(
  question,
  today,
  holidays
) {
  if (
    !/พรุ่งนี้/.test(question) ||
    !/หยุด/.test(question) ||
    !today.isoDate
  ) {
    return null;
  }

  const tomorrow = new Date(
    `${today.isoDate}T00:00:00Z`
  );

  tomorrow.setUTCDate(
    tomorrow.getUTCDate() + 1
  );

  const tomorrowISO =
    tomorrow.toISOString().slice(0, 10);

  const holiday = holidays.find(
    ({ date }) => date === tomorrowISO
  );

  if (!holiday) {
    return "พรุ่งนี้ไม่ใช่วันหยุดราชการ";
  }

  return `พรุ่งนี้เป็นวันหยุดราชการ (${formatHolidayDate(holiday.date)} ${holiday.name})`;
}

function getCurrentScheduleReply(
  question,
  scheduleData,
  today
) {
  if (
    !/(ตอนนี้|ตอนนี่|เดี๋ยวนี้)/.test(question)
  ) {
    return null;
  }

  if (
    /(กี่โมง|เวลา)/.test(question) &&
    !/(สอน|เรียน|คาบ|ว่าง)/.test(question)
  ) {
    return `ตอนนี้เวลา ${today.timeHHMM} น.`;
  }

  const requestedTime = question.match(
    /(?:เวลา|ช่วง)\s*(\d{1,2}:\d{2})/
  );

  if (requestedTime) {
    const requestedMinutes =
      timeToMinutes(requestedTime[1]);

    const requestedSession =
      scheduleData.sessions.find((session) => {
        if (
          session.day !== today.weekdayTh
        ) {
          return false;
        }

        return (
          timeToMinutes(session.timeStart) <=
            requestedMinutes &&
          requestedMinutes <
            timeToMinutes(session.timeEnd)
        );
      });

    return requestedSession
      ? formatSessionReply(
          requestedSession,
          scheduleData,
          `เวลา ${requestedTime[1]} มีคาบสอน`
        )
      : `เวลา ${requestedTime[1]} ไม่มีคาบสอน`;
  }

  const currentMinutes =
    timeToMinutes(today.timeHHMM);

  const currentSession =
    scheduleData.sessions.find((session) => {
      if (
        session.day !== today.weekdayTh
      ) {
        return false;
      }

      const start =
        timeToMinutes(session.timeStart);

      const end =
        timeToMinutes(session.timeEnd);

      return (
        start <= currentMinutes &&
        currentMinutes < end
      );
    });

  if (currentSession) {
    if (
      /(ว่าง|ว่างไหม|ว่างมั้ย)/.test(
        question
      )
    ) {
      return formatSessionReply(
        currentSession,
        scheduleData,
        "ตอนนี้ไม่ว่าง กำลังสอน"
      );
    }

    return formatSessionReply(
      currentSession,
      scheduleData
    );
  }

  if (
    currentMinutes >= 8 * 60 &&
    currentMinutes < 18 * 60
  ) {
    return "ตอนนี้ครูไมตรีว่าง ไม่มีคาบเรียน";
  }

  return "ตอนนี้อยู่นอกเวลาทำการ (08:00–18:00) ครูไมตรีไม่มีคาบเรียน";
}

/**
 * Answer a question about the schedule.
 */
async function answerScheduleQuestion(
  question,
  scheduleData,
  today,
  holidays
) {
  const tomorrowHolidayReply =
    getTomorrowHolidayReply(
      question,
      today,
      holidays
    );

  if (tomorrowHolidayReply) {
    return tomorrowHolidayReply;
  }

  const currentMonthHolidayReply =
    getCurrentMonthHolidayReply(
      question,
      today,
      holidays
    );

  if (currentMonthHolidayReply) {
    return currentMonthHolidayReply;
  }

  const currentReply =
    getCurrentScheduleReply(
      question,
      scheduleData,
      today
    );

  if (currentReply) {
    return currentReply;
  }

  const holidaysText = holidays.length
    ? holidays
        .map(
          (h) =>
            `- วัน${h.day}ที่ ${h.date}: ${h.name}${
              h.government
                ? ""
                : " (ไม่ใช่วันหยุดราชการ)"
            }${
              h.note
                ? " — " + h.note
                : ""
            }`
        )
        .join("\n")
    : "ไม่มีข้อมูลวันหยุดในช่วงที่ระบุ";

  const semesterRangeNote =
    scheduleData.semesterStartDate &&
    scheduleData.semesterEndDate
      ? `ภาคเรียนนี้เริ่ม ${scheduleData.semesterStartDate} ถึง ${scheduleData.semesterEndDate}`
      : "ยังไม่มีการระบุวันเปิด-ปิดภาคเรียนที่แน่นอนในระบบ รายการวันหยุดด้านล่างจึงครอบคลุมตั้งแต่วันนี้ถึงสิ้นปีปฏิทินปัจจุบันแทน";

  const systemPrompt = `คุณเป็นผู้ช่วยตอบคำถามเกี่ยวกับตารางสอนของครูคนหนึ่ง

วันนี้คือ: ${today.formatted}
เวลาปัจจุบันสำหรับตรวจสอบคาบเรียนคือ ${today.timeHHMM} น. เท่านั้น ห้ามใช้เวลาอื่นจากตัวอย่างหรือจากความจำ

${semesterRangeNote}

รายการวันหยุดราชการที่เกี่ยวข้อง:
${holidaysText}

กติกาการตอบ:
- ใช้ข้อมูลตารางสอนและวันหยุดด้านบนเท่านั้น
- ห้ามสร้างข้อมูลวิชา เวลา ห้องเรียน หรือวันหยุดที่ไม่มีอยู่จริง
- หากถามว่าวันนี้วันอะไร หรือตอนนี้กี่โมง ให้ตอบตามข้อมูลด้านบน
- หากคำถามไม่มีคำตอบในข้อมูล ให้บอกตามตรงว่าไม่พบข้อมูลนี้
- ตอบเป็นภาษาเดียวกับที่ผู้ใช้ถาม
- ห้ามใส่คำทักทายหรือคำลงท้ายที่ไม่จำเป็น
- ตอบเข้าประเด็นทันที

รูปแบบการตอบ:

1. ถามว่าง/ไม่ว่างในวันใดวันหนึ่ง:
วัน[ชื่อวัน]ครูไมตรีว่างช่วงเวลาต่อไปนี้ (นับตามเวลาทำการ 08:00–18:00 เท่านั้น):
- [เวลาเริ่ม]–[เวลาสิ้นสุด]

ถ้าไม่มีช่วงว่าง:
วัน[ชื่อวัน]ครูไมตรีไม่มีช่วงว่างเลยในช่วง 08:00–18:00

ถ้าไม่มีคาบเรียนเลยทั้งวัน:
วัน[ชื่อวัน]ครูไมตรีว่างทั้งวัน (08:00–18:00)

2. ถามคาบเรียนในวันใดวันหนึ่ง:
วัน[ชื่อวัน]มีคาบเรียนดังนี้:
- [เวลาเริ่ม]–[เวลาสิ้นสุด] วิชา[ชื่อวิชา] ([ประเภท]) ห้อง [ห้อง] กลุ่ม [กลุ่ม]

3. ถาม "ตอนนี้":
ถ้ามีคาบเรียน:
ตอนนี้ครูไมตรีกำลังสอนวิชา[ชื่อวิชา] ([ประเภท]) ห้อง [ห้อง] กลุ่ม [กลุ่ม] (เวลา [เวลาเริ่ม]–[เวลาสิ้นสุด])

ถ้าไม่มีคาบเรียนในช่วง 08:00–18:00:
ตอนนี้ครูไมตรีว่าง ไม่มีคาบเรียน

ถ้านอกเวลาทำการ:
ตอนนี้อยู่นอกเวลาทำการ (08:00–18:00) ครูไมตรีไม่มีคาบเรียน

4. ถามวันหยุด:
วันหยุดราชการในช่วงเทอมนี้มีดังนี้:
- [วันที่ dd/mm/yyyy] ([ชื่อวันหยุด])

หมายเหตุ: เป็นวันหยุดราชการระดับประเทศ ไม่รวมวันปิดภาคกลางเทอมของวิทยาลัย

5. คำถามอื่น:
ตอบสั้น 1-2 ประโยค ตรงประเด็น

ข้อมูลตารางสอน:
${JSON.stringify(scheduleData)}`;

  return callTyphoon({
    model: CHAT_MODEL,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: question,
      },
    ],
    max_tokens: 600,
    temperature: 0.15,
  });
}

module.exports = {
  ocrPdfWithTyphoon,
  structureScheduleFromMarkdown,
  answerScheduleQuestion,
};
