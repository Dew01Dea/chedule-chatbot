#!/usr/bin/env node
/**
 * Reports whether this checkout is configured well enough to run, and says
 * what to do about anything that is not.
 *
 * Written because the failure modes here are quiet ones: a missing Supabase
 * key leaves the server in read-only JSON mode, an unreadable ADMIN_TOKENS
 * refuses every admin request while the startup log looks fine, and a poppler
 * that PATH cannot reach fails only at upload time. Each is far easier to see
 * stated plainly than to infer from behaviour.
 *
 * Prints no secret values — only whether each is present and usable.
 *
 * Usage: node scripts/check-setup.js
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENV_PATH = path.join(__dirname, "..", ".env");

let problems = 0;
let warnings = 0;

const section = (title) => console.log(`\n${title}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const info = (msg) => console.log(`  • ${msg}`);
const bad = (msg, fix) => {
  problems++;
  console.log(`  ✗ ${msg}`);
  if (fix) console.log(`      → ${fix}`);
};
const warn = (msg, fix) => {
  warnings++;
  console.log(`  ! ${msg}`);
  if (fix) console.log(`      → ${fix}`);
};

/* -------------------------------------------------------------------------- */

function checkEnvFile() {
  section("[1] ไฟล์ .env");

  if (!fs.existsSync(ENV_PATH)) {
    bad(
      "ไม่พบไฟล์ backend/.env",
      "คัดลอกจากตัวอย่าง:  copy .env.example .env   (Mac/Linux: cp .env.example .env)"
    );
    return;
  }
  ok(`พบไฟล์ .env (${fs.statSync(ENV_PATH).size} bytes)`);
}

function checkCodeVersion() {
  section("[2] โค้ดเป็นเวอร์ชันล่าสุดหรือไม่");

  let source = "";
  try {
    source = fs.readFileSync(path.join(__dirname, "..", "middleware", "requireAdmin.js"), "utf-8");
  } catch {
    bad("อ่านไฟล์ middleware/requireAdmin.js ไม่ได้");
    return;
  }

  if (source.includes("function unquote")) {
    ok("มีตัวแก้ ADMIN_TOKENS แล้ว (รับ token เปล่า ๆ และตัดเครื่องหมายคำพูดให้)");
  } else {
    bad(
      "โค้ดเป็นเวอร์ชันเก่า — ยังไม่มีตัวแก้ ADMIN_TOKENS",
      "ดึงโค้ดใหม่:  git pull   แล้วรีสตาร์ทเซิร์ฟเวอร์"
    );
  }

  if (fs.existsSync(path.join(__dirname, "..", "lib", "poppler.js"))) {
    ok("รองรับ POPPLER_PATH แล้ว (ไม่ต้องพึ่ง PATH)");
  } else {
    bad("ยังไม่รองรับ POPPLER_PATH", "ดึงโค้ดใหม่:  git pull");
  }
}

function checkTyphoon() {
  section("[3] Typhoon API key");

  const key = process.env.TYPHOON_API_KEY?.trim();
  if (key) {
    ok(`ตั้งค่าแล้ว (ยาว ${key.length} ตัวอักษร)`);
  } else {
    warn(
      "ยังไม่ได้ตั้ง TYPHOON_API_KEY",
      "อ่าน PDF และตอบแชทจะใช้ไม่ได้ — ขอคีย์ที่ playground.opentyphoon.ai"
    );
  }
}

async function checkPopplerSection() {
  section("[4] poppler (pdftoppm)  ← ต้องมีถึงจะอ่าน PDF ได้");

  let checkPoppler;
  try {
    ({ checkPoppler } = require("../lib/poppler"));
  } catch {
    bad("ไม่พบ lib/poppler.js", "ดึงโค้ดใหม่:  git pull");
    return;
  }

  // Resolved exactly the way the server resolves it, so this check and the
  // running server cannot report different answers for different reasons.
  const result = await checkPoppler();

  if (result.available) {
    ok(`ใช้งานได้${result.version ? ` (${result.version})` : ""}`);
    info(`หาเจอผ่าน: ${result.lookedIn}`);
    return;
  }

  bad(
    `${result.reason} — หาใน ${result.lookedIn}`,
    process.platform === "win32"
      ? "วิธีที่ชัวร์ที่สุด ไม่ต้องยุ่งกับ PATH: เพิ่มบรรทัดนี้ใน backend/.env แล้วรีสตาร์ท\n" +
          "         POPPLER_PATH=C:\\poppler\\Library\\bin\n" +
          "        (ชี้ไปโฟลเดอร์ที่มีไฟล์ pdftoppm.exe อยู่จริง)"
      : "macOS: brew install poppler  /  Ubuntu: sudo apt-get install poppler-utils\n" +
          "        หรือกำหนด POPPLER_PATH ใน .env ให้ชี้ไปโฟลเดอร์ bin ของ poppler"
  );
}

function checkSupabaseConfig() {
  section("[5] Supabase");

  if (process.env.SUPABASE_URL) {
    ok(`SUPABASE_URL = ${process.env.SUPABASE_URL}`);
  } else {
    bad("ยังไม่ได้ตั้ง SUPABASE_URL", "คัดลอกจาก Supabase → Project Settings → API → Project URL");
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (serviceKey) {
    const which = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? "SUPABASE_SERVICE_ROLE_KEY"
      : "SUPABASE_SECRET_KEY";
    ok(`${which} ตั้งค่าแล้ว (ยาว ${serviceKey.length} ตัวอักษร)`);
  } else {
    bad(
      "ยังไม่ได้ตั้งคีย์ฝั่งเซิร์ฟเวอร์",
      "ใส่ SUPABASE_SERVICE_ROLE_KEY หรือ SUPABASE_SECRET_KEY (คีย์ service_role / Secret key — ไม่ใช่ anon)"
    );
  }

  let configured = false;
  try {
    configured = require("../lib/supabaseClient").isSupabaseConfigured();
  } catch {
    /* handled by the checks above */
  }

  if (configured) {
    ok("โหมด: supabase (รองรับหลายอาจารย์)");
  } else {
    bad("โหมด: json (อ่านอย่างเดียว — อัปโหลดและเพิ่มอาจารย์ไม่ได้)");
  }

  return configured;
}

function checkAdminTokens() {
  section("[6] ADMIN_TOKENS  ← หน้า #admin ต้องใช้อันนี้");

  const raw = process.env.ADMIN_TOKENS;

  if (!raw) {
    bad(
      "ยังไม่ได้ตั้ง ADMIN_TOKENS — หน้าผู้ดูแลจะปฏิเสธทุกคำขอ",
      `เพิ่มใน .env เช่น  ADMIN_TOKENS=dew:${crypto.randomBytes(24).toString("hex")}`
    );
    return;
  }

  let tokens = new Map();
  try {
    tokens = require("../middleware/requireAdmin").parseAdminTokens();
  } catch (error) {
    bad(`อ่าน middleware ไม่ได้: ${error.message}`);
    return;
  }

  if (tokens.size === 0) {
    bad(
      "ตั้ง ADMIN_TOKENS ไว้แล้ว แต่อ่านค่าไม่ได้",
      "ต้องเป็นรูปแบบ  ADMIN_TOKENS=ชื่อ:โทเคน  — ห้ามเว้นวรรครอบ = และอย่าปล่อยให้ว่างหลัง :"
    );
    return;
  }

  ok(`อ่านได้ ${tokens.size} โทเคน สำหรับ: ${[...tokens.values()].join(", ")}`);

  for (const [token] of tokens) {
    if (token.length < 16) {
      warn(`โทเคนสั้นเกินไป (${token.length} ตัวอักษร) เดาง่าย`, "ควรยาวอย่างน้อย 32 ตัวอักษร");
    }
  }
}

async function checkConnection(supabaseReady) {
  section("[7] เชื่อมต่อ Supabase จริง");

  if (!supabaseReady) {
    info("ข้าม (ยังตั้งค่า Supabase ไม่ครบ)");
    return;
  }

  try {
    const { getSupabase } = require("../lib/supabaseClient");
    const { error: tableError } = await getSupabase().from("teachers").select("id").limit(1);

    if (tableError) {
      bad(
        `เชื่อมต่อได้ แต่อ่านตาราง teachers ไม่ได้: ${tableError.message}`,
        "ยังไม่ได้รัน migration? เปิด supabase/migrations/*.sql แล้วคัดลอกเนื้อหาไปวางใน SQL Editor"
      );
      return;
    }
    ok("เชื่อมต่อได้ และพบตาราง teachers");

    const store = require("../store");
    const all = store.listAllTeachers ? await store.listAllTeachers() : [];
    const published = await store.listTeachers();

    info(`อาจารย์ในระบบทั้งหมด: ${all.length}`);
    info(`อาจารย์ที่เผยแพร่ตารางแล้ว (เห็นในหน้าแชท): ${published.length}`);

    if (all.length === 0) {
      warn(
        "ยังไม่มีอาจารย์เลย",
        "ย้ายข้อมูลเดิมเข้ามา:  node scripts/migrate-schedule-json.js   หรือเพิ่มเองในหน้า #admin"
      );
    } else if (published.length === 0) {
      warn("มีอาจารย์แล้วแต่ยังไม่มีใครเผยแพร่ตาราง", "เข้าหน้า #admin แล้วกดตรวจสอบและเผยแพร่");
    }
  } catch (error) {
    bad(`เชื่อมต่อ Supabase ไม่สำเร็จ: ${error.message}`, "ตรวจสอบ SUPABASE_URL และคีย์อีกครั้ง");
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log("\n=== ตรวจสอบการตั้งค่าระบบ Chatbot ตารางสอน ===");

  checkEnvFile();
  checkCodeVersion();
  checkTyphoon();
  await checkPopplerSection();
  const supabaseReady = checkSupabaseConfig();
  checkAdminTokens();
  await checkConnection(supabaseReady);

  console.log("\n" + "=".repeat(52));
  console.log(
    problems === 0 && warnings === 0
      ? "พร้อมใช้งาน ✓"
      : `พบปัญหาที่ต้องแก้ ${problems} ข้อ, คำเตือน ${warnings} ข้อ`
  );

  console.log("\nเริ่มเซิร์ฟเวอร์:   npm run dev");
  console.log("หน้าผู้ดูแล:      http://localhost:5173/#admin");
  console.log("");

  process.exit(problems > 0 ? 1 : 0);
}

main();
