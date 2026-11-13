-- 청미르 RAS · D1 데이터베이스 스키마
-- 적용: npm run db:init  (또는 wrangler d1 execute chungmir_ras --file=./schema.sql --remote)

-- 학생(선언)
CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  grade      INTEGER NOT NULL,
  room       INTEGER NOT NULL,
  number     INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  pw_hash    TEXT    NOT NULL,
  pledged_at TEXT    NOT NULL,
  UNIQUE(grade, room, number)
);

-- 매일 실천 인증
CREATE TABLE IF NOT EXISTS certs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  area       TEXT    NOT NULL,            -- 'r' | 'a' | 's'
  date       TEXT    NOT NULL,            -- 'YYYY-MM-DD'
  note       TEXT    DEFAULT '',
  photo_key  TEXT,                        -- R2 object key (nullable)
  source     TEXT    DEFAULT 'self',      -- 'self' | 'kiosk'
  hidden     INTEGER DEFAULT 0,
  created_at TEXT    NOT NULL,
  FOREIGN KEY(student_id) REFERENCES students(id)
);
CREATE INDEX IF NOT EXISTS idx_certs_student ON certs(student_id);
CREATE INDEX IF NOT EXISTS idx_certs_date ON certs(date);

-- 박수/하트 응원
CREATE TABLE IF NOT EXISTS reactions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_id  INTEGER NOT NULL,
  kind     TEXT    NOT NULL,              -- 'clap' | 'heart'
  actor_id INTEGER NOT NULL,
  UNIQUE(cert_id, kind, actor_id)
);

-- 공간 보너스(책마루 / RAS 학교갤러리)
CREATE TABLE IF NOT EXISTS bonus (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  place      TEXT    NOT NULL,
  points     INTEGER NOT NULL DEFAULT 2,
  date       TEXT    NOT NULL
);

-- 가정통신문
CREATE TABLE IF NOT EXISTS notices (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  date  TEXT NOT NULL,
  title TEXT NOT NULL,
  body  TEXT NOT NULL
);

-- 키-값 설정(학년별 학생 수, 브랜딩, 관리자 비밀번호 등)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ===== 초기 시드 =====
-- 학년별 전체 학생 수(참여율 계산용)
INSERT OR REPLACE INTO settings(key, value) VALUES
 ('grade_totals', '{"1":95,"2":92,"3":104,"4":99,"5":98,"6":90}'),
 ('school_goal', '1200'),
 ('period', '2026. 11. 2 ~ 11. 29'),
 -- 관리자 기본 비밀번호: 1234  (배포 후 반드시 변경하세요)
 ('admin_pw_hash', 'SET_BY_SETUP');

INSERT INTO notices(date, title, body) VALUES
 ('2026-11-03', '「폰 프리 스쿨」 운영 안내', '학생들이 교육활동과 관련 없는 스마트폰 사용을 줄이고, 그 시간을 독서·예술·스포츠 활동으로 전환하는 「폰 프리 스쿨」을 운영합니다. 가정에서도 함께 실천해 주세요.'),
 ('2026-11-10', '가정 폰프리 실천 주간 안내', '자녀의 RAS 인증에 응원 한마디를 남겨 주시면 아이들에게 큰 힘이 됩니다.');
