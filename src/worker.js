// 청미르 RAS · Cloudflare Worker (API + 정적 화면 서빙)
// 라우팅: /api/* 는 API, 그 외는 public 폴더의 화면을 서빙합니다.

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u8) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => unb64(s.replace(/-/g, "+").replace(/_/g, "/"));
const uuid = () => crypto.randomUUID();

function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function nowISO() { return new Date().toISOString(); }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function bad(msg, status = 400) { return json({ error: msg }, status); }

// ---- 비밀번호 해시 (PBKDF2) ----
async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
async function verifyPw(pw, stored) {
  if (!stored || !stored.startsWith("pbkdf2$")) return false;
  const [, iter, saltB64, hashB64] = stored.split("$");
  const salt = unb64(saltB64);
  const key = await crypto.subtle.importKey("raw", enc(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: +iter, hash: "SHA-256" }, key, 256);
  return b64(new Uint8Array(bits)) === hashB64;
}

// ---- 토큰 (HMAC 서명) ----
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(data));
  return b64url(new Uint8Array(sig));
}
async function signToken(obj, secret) {
  const p = b64url(enc(JSON.stringify(obj)));
  return p + "." + (await hmac(p, secret));
}
async function verifyToken(tok, secret) {
  if (!tok || !tok.includes(".")) return null;
  const [p, s] = tok.split(".");
  if ((await hmac(p, secret)) !== s) return null;
  try { return JSON.parse(dec(unb64url(p))); } catch { return null; }
}
function bearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
async function authStudent(req, env) {
  const t = await verifyToken(bearer(req), env.APP_SECRET);
  return t && t.role === "student" ? t.id : null;
}
async function authAdmin(req, env) {
  const t = await verifyToken(bearer(req), env.APP_SECRET);
  return t && t.role === "admin";
}

async function getSetting(env, key, def = null) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return r ? r.value : def;
}
function maskWho(s) { return `${s.grade}학년 ${s.room}반`; }

async function handleApi(req, env, url) {
  const path = url.pathname.replace(/^\/api/, "");
  const method = req.method;
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};

  if (path === "/health") return json({ ok: true });

  // ---- 학생 선언(가입/로그인) ----
  if (path === "/declare" && method === "POST") {
    const { grade, room, number, name, password } = body;
    if (!(grade >= 1 && grade <= 6)) return bad("학년은 1~6");
    if (!(room >= 1 && room <= 40)) return bad("반 범위를 확인해 주세요");
    if (!(number >= 1 && number <= 60)) return bad("번호 범위를 확인해 주세요");
    if (!name || !String(name).trim()) return bad("이름을 입력해 주세요");
    if (!password || String(password).length < 4) return bad("비밀번호는 4자리 이상");
    const existing = await env.DB.prepare(
      "SELECT * FROM students WHERE grade=? AND room=? AND number=?"
    ).bind(grade, room, number).first();
    let student;
    if (existing) {
      if (!(await verifyPw(String(password), existing.pw_hash)))
        return bad("이미 선언한 번호예요. 비밀번호가 다르면 선생님께 말씀해 주세요.", 409);
      student = existing;
    } else {
      const pw = await hashPw(String(password));
      const res = await env.DB.prepare(
        "INSERT INTO students(grade,room,number,name,pw_hash,pledged_at) VALUES(?,?,?,?,?,?)"
      ).bind(grade, room, number, String(name).trim(), pw, nowISO()).run();
      student = { id: res.meta.last_row_id, grade, room, number };
    }
    const token = await signToken({ role: "student", id: student.id }, env.APP_SECRET);
    return json({ token, who: maskWho(student) });
  }

  // ---- 공용 태블릿: 번호로 임시 인증(비밀번호 없이) ----
  if (path === "/kiosk-id" && method === "POST") {
    const { grade, room, number } = body;
    if (!(grade >= 1 && grade <= 6 && room >= 1 && number >= 1)) return bad("학년·반·번호를 확인해 주세요");
    let s = await env.DB.prepare("SELECT * FROM students WHERE grade=? AND room=? AND number=?")
      .bind(grade, room, number).first();
    if (!s) {
      const pw = await hashPw(uuid()); // 임시(공용 인증용) — 본인 선언 시 교체
      const res = await env.DB.prepare(
        "INSERT INTO students(grade,room,number,name,pw_hash,pledged_at) VALUES(?,?,?,?,?,?)"
      ).bind(grade, room, number, `${grade}-${room}-${number}`, pw, nowISO()).run();
      s = { id: res.meta.last_row_id, grade, room, number };
    }
    const token = await signToken({ role: "student", id: s.id, kiosk: true }, env.APP_SECRET);
    return json({ token, who: maskWho(s) });
  }

  // ---- 내 정보 + 달력 ----
  if (path === "/me" && method === "POST") {
    const id = await authStudent(req, env);
    if (!id) return bad("로그인이 필요해요", 401);
    const s = await env.DB.prepare("SELECT grade,room,number FROM students WHERE id=?").bind(id).first();
    const certs = await env.DB.prepare("SELECT area,date FROM certs WHERE student_id=? AND hidden=0").bind(id).all();
    const power = { r: 0, a: 0, s: 0 };
    const days = new Set();
    for (const c of certs.results) { power[c.area] = (power[c.area] || 0) + 1; days.add(c.date); }
    const b = await env.DB.prepare("SELECT COALESCE(SUM(points),0) AS p FROM bonus WHERE student_id=?").bind(id).first();
    return json({ who: maskWho(s), power, days: [...days], bonus: b.p || 0 });
  }

  // ---- 사진 업로드 (R2) ----
  if (path === "/upload" && method === "POST") {
    const id = await authStudent(req, env);
    if (!id) return bad("로그인이 필요해요", 401);
    if (!env.PHOTOS) return bad("사진 기능이 아직 켜져 있지 않아요(R2)", 400);
    const ct = req.headers.get("content-type") || "application/octet-stream";
    if (!ct.startsWith("image/")) return bad("이미지 파일만 업로드할 수 있어요");
    const key = `cert/${id}/${uuid()}`;
    await env.PHOTOS.put(key, req.body, { httpMetadata: { contentType: ct } });
    return json({ key });
  }

  // ---- 사진 보기 ----
  if (url.pathname.startsWith("/api/photo/") && method === "GET") {
    if (!env.PHOTOS) return new Response("not found", { status: 404 });
    const key = decodeURIComponent(url.pathname.replace("/api/photo/", ""));
    const obj = await env.PHOTOS.get(key);
    if (!obj) return new Response("not found", { status: 404 });
    return new Response(obj.body, {
      headers: { "content-type": obj.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, max-age=3600" },
    });
  }

  // ---- 인증하기 ----
  if (path === "/certify" && method === "POST") {
    const id = await authStudent(req, env);
    if (!id) return bad("로그인이 필요해요", 401);
    const { area, note, photoKey, source } = body;
    if (!["r", "a", "s"].includes(area)) return bad("활동을 골라 주세요");
    const date = kstDate();
    await env.DB.prepare(
      "INSERT INTO certs(student_id,area,date,note,photo_key,source,created_at) VALUES(?,?,?,?,?,?,?)"
    ).bind(id, area, date, (note || "").slice(0, 200), photoKey || null, source === "kiosk" ? "kiosk" : "self", nowISO()).run();
    return json({ ok: true, date });
  }

  // ---- 보너스(책마루 / RAS 학교갤러리) ----
  if (path === "/bonus" && method === "POST") {
    const id = await authStudent(req, env);
    if (!id) return bad("로그인이 필요해요", 401);
    const place = (body.place || "").slice(0, 40);
    await env.DB.prepare("INSERT INTO bonus(student_id,place,points,date) VALUES(?,?,2,?)")
      .bind(id, place, kstDate()).run();
    const b = await env.DB.prepare("SELECT COALESCE(SUM(points),0) AS p FROM bonus WHERE student_id=?").bind(id).first();
    return json({ ok: true, bonus: b.p });
  }

  // ---- 학교 통계 ----
  if (path === "/stats" && method === "GET") {
    const tot = await env.DB.prepare("SELECT COUNT(*) AS c FROM certs WHERE hidden=0").first();
    const joined = await env.DB.prepare("SELECT COUNT(*) AS c FROM students").first();
    const byArea = await env.DB.prepare("SELECT area, COUNT(*) AS c FROM certs WHERE hidden=0 GROUP BY area").all();
    const split = { r: 0, a: 0, s: 0 };
    for (const row of byArea.results) split[row.area] = row.c;
    const react = await env.DB.prepare("SELECT kind, COUNT(*) AS c FROM reactions GROUP BY kind").all();
    let claps = 0, hearts = 0;
    for (const row of react.results) { if (row.kind === "clap") claps = row.c; if (row.kind === "heart") hearts = row.c; }
    const goal = parseInt((await getSetting(env, "school_goal", "1200")), 10);
        const today = kstDate();
    const startDt = new Date(today + "T00:00:00Z");
    startDt.setUTCDate(startDt.getUTCDate() - 13);
    const startStr = startDt.toISOString().slice(0, 10);
    const dayRows = await env.DB.prepare(
      "SELECT date, COUNT(*) AS c FROM certs WHERE hidden=0 AND date>=? GROUP BY date"
    ).bind(startStr).all();
    const dayMap = {};
    for (const row of dayRows.results) dayMap[row.date] = row.c;
    const trend = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(startStr + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      const ds = d.toISOString().slice(0, 10);
      trend.push({ date: ds, count: dayMap[ds] || 0 });
    }
    return json({ totalCerts: tot.c, joined: joined.c, rasSplit: split, claps, hearts, schoolGoal: goal, trend });
  }

  // ---- 자랑터(갤러리) ----
  if (path === "/gallery" && method === "GET") {
    const area = url.searchParams.get("area");
    const where = area && ["r", "a", "s"].includes(area) ? "AND c.area=?" : "";
    const stmt = env.DB.prepare(
      `SELECT c.id, c.area, c.note, c.photo_key, s.grade, s.room,
              (SELECT COUNT(*) FROM reactions WHERE cert_id=c.id AND kind='clap') AS claps,
              (SELECT COUNT(*) FROM reactions WHERE cert_id=c.id AND kind='heart') AS hearts
       FROM certs c JOIN students s ON s.id=c.student_id
       WHERE c.hidden=0 ${where}
       ORDER BY c.id DESC LIMIT 40`
    );
    const rows = area && where ? await stmt.bind(area).all() : await stmt.all();
    const items = rows.results.map((r) => ({
      id: r.id, area: r.area, note: r.note,
      who: `${r.grade}학년 ${r.room}반`,
      photo: r.photo_key ? `/api/photo/${encodeURIComponent(r.photo_key)}` : null,
      claps: r.claps, hearts: r.hearts,
    }));
    return json({ items });
  }

  // ---- 응원(박수/하트) 토글 ----
  if (path === "/react" && method === "POST") {
    const id = await authStudent(req, env);
    if (!id) return bad("로그인이 필요해요", 401);
    const { certId, kind } = body;
    if (!["clap", "heart"].includes(kind)) return bad("종류 오류");
    const ex = await env.DB.prepare("SELECT id FROM reactions WHERE cert_id=? AND kind=? AND actor_id=?")
      .bind(certId, kind, id).first();
    if (ex) await env.DB.prepare("DELETE FROM reactions WHERE id=?").bind(ex.id).run();
    else await env.DB.prepare("INSERT INTO reactions(cert_id,kind,actor_id) VALUES(?,?,?)").bind(certId, kind, id).run();
    const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM reactions WHERE cert_id=? AND kind=?").bind(certId, kind).first();
    return json({ ok: true, on: !ex, count: cnt.c });
  }

  // ---- 콘텐츠(가정통신문·설정) ----
  if (path === "/content" && method === "GET") {
    const notices = await env.DB.prepare("SELECT id,date,title,body FROM notices ORDER BY date DESC").all();
    const grades = await getSetting(env, "grade_totals", "{}");
    const period = await getSetting(env, "period", "");
    return json({ notices: notices.results, gradeTotals: JSON.parse(grades), period });
  }

  // ===== 관리자 =====
  if (path === "/admin/setup" && method === "POST") {
    const cur = await getSetting(env, "admin_pw_hash", "SET_BY_SETUP");
    if (cur !== "SET_BY_SETUP") return bad("이미 설정되었습니다", 409);
    if (!body.password || String(body.password).length < 4) return bad("4자리 이상");
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_pw_hash',?)")
      .bind(await hashPw(String(body.password))).run();
    return json({ ok: true });
  }
  if (path === "/admin/login" && method === "POST") {
    const stored = await getSetting(env, "admin_pw_hash", "SET_BY_SETUP");
    if (stored === "SET_BY_SETUP") return bad("관리자 비밀번호가 아직 설정되지 않았어요(/api/admin/setup)", 400);
    if (!(await verifyPw(String(body.password || ""), stored))) return bad("비밀번호가 올바르지 않아요", 401);
    const token = await signToken({ role: "admin" }, env.APP_SECRET);
    return json({ token });
  }
  if (path === "/admin/students" && method === "GET") {
    if (!(await authAdmin(req, env))) return bad("관리자 전용", 401);
    const rows = await env.DB.prepare(
      `SELECT s.id,s.grade,s.room,s.number,s.name,
              (SELECT COUNT(*) FROM certs WHERE student_id=s.id AND hidden=0) AS certs
       FROM students s ORDER BY s.grade,s.room,s.number`
    ).all();
    return json({ students: rows.results });
  }
  if (path === "/admin/grades" && method === "POST") {
    if (!(await authAdmin(req, env))) return bad("관리자 전용", 401);
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('grade_totals',?)")
      .bind(JSON.stringify(body.gradeTotals || {})).run();
    return json({ ok: true });
  }
  if (path === "/admin/hide" && method === "POST") {
    if (!(await authAdmin(req, env))) return bad("관리자 전용", 401);
    await env.DB.prepare("UPDATE certs SET hidden=? WHERE id=?").bind(body.hidden ? 1 : 0, body.certId).run();
    return json({ ok: true });
  }
  if (path === "/admin/notice" && method === "POST") {
    if (!(await authAdmin(req, env))) return bad("관리자 전용", 401);
    const title = String(body.title || "").trim();
    const content = String(body.body || "").trim();
    if (!title) return bad("제목을 입력해 주세요");
    if (!content) return bad("내용을 입력해 주세요");
    const date = kstDate();
    const res = await env.DB.prepare(
      "INSERT INTO notices(date,title,body) VALUES(?,?,?)"
    ).bind(date, title.slice(0, 120), content.slice(0, 2000)).run();
    return json({ ok: true, id: res.meta.last_row_id, date });
  }
  if (path === "/admin/notice/delete" && method === "POST") {
    if (!(await authAdmin(req, env))) return bad("관리자 전용", 401);
    await env.DB.prepare("DELETE FROM notices WHERE id=?").bind(body.id).run();
    return json({ ok: true });
  }
  return bad("알 수 없는 요청", 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (!env.APP_SECRET) return bad("APP_SECRET 미설정 (wrangler secret put APP_SECRET)", 500);
        return await handleApi(req, env, url);
      }
    } catch (e) {
      return bad("서버 오류: " + (e && e.message ? e.message : String(e)), 500);
    }
    // 그 외: 정적 화면(public)
    return env.ASSETS.fetch(req);
  },
};
