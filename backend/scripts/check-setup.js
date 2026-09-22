#!/usr/bin/env node
/**
 * Reports whether this checkout is configured well enough to run, and says
 * what to do about anything that is not.
 *
 * Written because the failure modes here are quiet ones: a missing Supabase
 * key leaves the server running in read-only JSON mode, and an unreadable
 * ADMIN_TOKENS refuses every admin request while the startup log looks fine.
 * Both are far easier to see stated plainly than to infer from behaviour.
 *
 * Prints no secret values — only whether each is present and usable.
 *
 * Usage: node scripts/check-setup.js
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", ".env");

let problems = 0;
let warnings = 0;

const ok = (msg) => console.log(`  ✓ ${msg}`);
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

console.log("\n=== ตรวจสอบการตั้งค่าระบบ Chatbot ตารางสอน ===\n");

/* -------------------------------------------------------------------------- */
console.log("[1] ไฟล์ .env");

if (!fs.existsSync(ENV_PATH)) {
  bad("ไม่พบไฟล์ backend/.env", "คัดลอกจากตัวอย่าง:  copy .env.example .env   (Mac/Linux: cp .env.example .env)");
} else {
  ok(`พบไฟล์ .env (${fs.statSync(ENV_PATH).size} bytes)`);
}

/* -------------------------------------------------------------------------- */
console.log("\n[2] โค้ดเป็นเวอร์ชันล่าสุดหรือไม่");

const requireAdminSource = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "middleware", "requireAdmin.js"), "utf-8");
  } catch {
    return "";
  }
})();

if (requireAdminSource.includes("function unquote")) {
  ok("มีตัวแก้ ADMIN_TOKENS แล้ว (รับ token เปล่า ๆ และตัดเครื่องหมายคำพูดให้)");
} else {
  bad(
    "โค้ดเป็นเวอร์ชันเก่า — ยังไม่มีตัวแก้ ADMIN_TOKENS",
    "ดึงโค้ดใหม่:  git pull   หรือ clone ใหม่จาก GitHub แล้วคัดลอกไฟล์ .env เดิมมาใส่"
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[3] Typhoon API key");

if (process.env.TYPHOON_API_KEY?.trim()) {
  ok(`ตั้งค่าแล้ว (ยาว ${process.env.TYPHOON_API_KEY.trim().length} ตัวอักษร)`);
} else {
  warn("ยังไม่ได้ตั้ง TYPHOON_API_KEY", "อ่าน PDF และตอบแชทจะใช้ไม่ได้ — ขอคีย์ที่ playground.opentyphoon.ai");
}

/* -------------------------------------------------------------------------- */
console.log("\n[3b] poppler (pdftoppm)  ← ต้องมีถึงจะอ่าน PDF ได้");

try {
  const { execFileSync } = require("child_process");
  const out = execFileSync("pdftoppm", ["-v"], { stdio: ["ignore", "pipe", "pipe"] });
  const version = String(out).trim().split("\n")[0];
  ok(`ติดตั้งแล้ว${version ? ` (${version})` : ""}`);
} catch (error) {
  if (error.code === "ENOENT") {
    bad(
      "ไม่พบคำสั่ง pdftoppm — อัปโหลด PDF จะไม่สำเร็จ",
      process.platform === "win32"
        ? "โหลด poppler จาก github.com/oschwartz10612/poppler-windows/releases แตกไฟล์ แล้วเพิ่มโฟลเดอร์ bin ลงใน PATH จากนั้นเปิด terminal ใหม่"
        : "macOS: brew install poppler   /   Ubuntu: sudo apt-get install poppler-utils"
    );
  } else {
    // pdftoppm -v exits non-zero on some builds while still being installed.
    ok("พบคำสั่ง pdftoppm");
  }
}

/* -------------------------------------------------------------------------- */
console.log("\n[4] Supabase");

let supabaseReady = false;
try {
  const { isSupabaseConfigured } = require("../lib/supabaseClient");
  supabaseReady = isSupabaseConfigured();
} catch {
  /* reported below */
}

if (!process.env.SUPABASE_URL) {
  bad("ยังไม่ได้ตั้ง SUPABASE_URL", "คัดลอกจาก Supabase → Project Settings → API → Project URL");
} else {
  ok(`SUPABASE_URL = ${process.env.SUPABASE_URL}`);
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!serviceKey) {
  bad(
    "ยังไม่ได้ตั้งคีย์ฝั่งเซิร์ฟเวอร์",
    "ใส่ SUPABASE_SERVICE_ROLE_KEY หรือ SUPABASE_SECRET_KEY (คีย์ service_role / Secret key — ไม่ใช่ anon)"
  );
} else {
  const which = process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_SECRET_KEY";
  ok(`${which} ตั้งค่าแล้ว (ยาว ${serviceKey.length} ตัวอักษร)`);
}

console.log(
  supabaseReady
    ? "  ✓ โหมด: supabase (รองรับหลายอาจารย์)"
    : "  ✗ โหมด: json (อ่านอย่างเดียว — อัปโหลดและเพิ่มอาจารย์ไม่ได้)"
);
if (!supabaseReady) problems++;

/* -------------------------------------------------------------------------- */
console.log("\n[5] ADMIN_TOKENS  ← หน้า #admin ต้องใช้อันนี้");

const raw = process.env.ADMIN_TOKENS;

if (!raw) {
  bad(
    "ยังไม่ได้ตั้ง ADMIN_TOKENS — หน้าผู้ดูแลจะปฏิเสธทุกคำขอ",
    'เพิ่มใน .env เช่น  ADMIN_TOKENS=dew:' + require("crypto").randomBytes(24).toString("hex")
  );
} else {
  let tokens = new Map();
  try {
    tokens = require("../middleware/requireAdmin").parseAdminTokens();
  } catch (error) {
    bad(`อ่าน middleware ไม่ได้: ${error.message}`);
  }

  if (tokens.size === 0) {
    bad(
      "ตั้ง ADMIN_TOKENS ไว้แล้ว แต่อ่านค่าไม่ได้",
      'ต้องเป็นรูปแบบ  ADMIN_TOKENS=ชื่อ:โทเคน  — ห้ามเว้นวรรครอบ = และอย่าปล่อยให้ว่างหลัง :'
    );
  } else {
    ok(`อ่านได้ ${tokens.size} โทเคน สำหรับ: ${[...tokens.values()].join(", ")}`);
    for (const [token] of tokens) {
      if (token.length < 16) {
        warn(`โทเคนสั้นเกินไป (${token.length} ตัวอักษร) เดาง่าย`, "ควรยาวอย่างน้อย 32 ตัวอักษร");
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
console.log("\n[6] เชื่อมต่อ Supabase จริง");

async function checkConnection() {
  if (!supabaseReady) {
    console.log("  – ข้าม (ยังตั้งค่า Supabase ไม่ครบ)");
    return;
  }

  try {
    const { getSupabase } = require("../lib/supabaseClient");
    const supabase = getSupabase();

    const { error: tableError } = await supabase.from("teachers").select("id").limit(1);
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

    console.log(`  • อาจารย์ในระบบทั้งหมด: ${all.length}`);
    console.log(`  • อาจารย์ที่เผยแพร่ตารางแล้ว (เห็นในหน้าแชท): ${published.length}`);

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

checkConnection().then(() => {
  console.log("\n" + "=".repeat(50));

  if (problems === 0 && warnings === 0) {
    console.log("พร้อมใช้งาน ✓");
  } else {
    console.log(`พบปัญหาที่ต้องแก้ ${problems} ข้อ, คำเตือน ${warnings} ข้อ`);
  }

  console.log("\nเริ่มเซิร์ฟเวอร์:   npm run dev");
  console.log(`หน้าผู้ดูแล:      http://localhost:5173/#admin`);
  console.log("");

  process.exit(problems > 0 ? 1 : 0);
});
