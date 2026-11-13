# 청미르 RAS — 실제 서버 버전 (Cloudflare)

프로토타입을 **실제로 데이터가 저장되는 홈페이지**로 올리기 위한 프로젝트입니다.
구성: **Cloudflare Workers(앱·API) + D1(데이터베이스) + R2(사진 저장)**. 무료 플랜으로 학교 규모 운영이 가능합니다.

> 선생님은 아래 순서대로 명령 몇 줄만 실행하시면 됩니다.
> 비밀번호·토큰은 브라우저 로그인으로 처리되어 외부로 전달되지 않습니다.

---

## 0. 준비물 (한 번만)

1. **Cloudflare 계정** — https://dash.cloudflare.com/sign-up (무료)
2. **Node.js** 설치 — https://nodejs.org (LTS 버전)
3. 이 폴더를 컴퓨터에 내려받기

터미널(명령 프롬프트)에서 이 폴더로 이동한 뒤:

```bash
npm install            # 도구(wrangler) 설치
npx wrangler login     # 브라우저가 열리면 Cloudflare 로그인 → 허용
```

---

## 1. 데이터베이스(D1) 만들기

```bash
npx wrangler d1 create chungmir_ras
```

출력에 나오는 `database_id = "..."` 값을 복사해서 **wrangler.toml** 의
`database_id = "여기에_D1_DATABASE_ID_붙여넣기"` 부분에 붙여넣습니다.

이어서 표(테이블)와 초기 데이터를 만듭니다:

```bash
npm run db:init
```

> 이미 Cloudflare 대시보드 콘솔에서 표를 만들었다면 이 명령은 **건너뛰세요**(두 번 넣으면 가정통신문이 중복될 수 있어요).

---

## 2. (건너뜀) 사진 저장소(R2)

사진 기능은 처음엔 **꺼둔 상태**입니다. (R2는 무료지만 켜려면 카드 등록이 필요해서, 나중에 켜는 걸 권장)
나중에 사진을 켤 때: 대시보드에서 R2 활성화 → `npx wrangler r2 bucket create chungmir-ras-photos` → `wrangler.toml` 의 R2 3줄 주석(#) 해제 → 다시 배포.

---

## 3. 비밀키 설정

로그인 토큰 서명에 쓰는 비밀키를 등록합니다(아무 긴 문자열):

```bash
npx wrangler secret put APP_SECRET
# 입력창이 뜨면 길고 무작위한 문자열을 붙여넣고 Enter
```

---

## 4. 배포

```bash
npm run deploy
```

끝나면 `https://chungmir-ras.<계정>.workers.dev` 주소가 나옵니다. 그 주소가 우리 홈페이지입니다.

---

## 5. 관리자 비밀번호 설정 (최초 1회, 터미널 필요 없음)

배포된 사이트를 열고 → 위 **"🧑‍🏫 교사"** → **"처음이신가요? 관리자 비밀번호 설정하기"** 버튼으로 원하는 비밀번호를 정하면 됩니다. 이후에는 그 비밀번호로 **로그인**하세요. (처음 한 번만 설정됩니다.)

---

## 폴더 구성

```
chungmir-server/
├─ wrangler.toml      설정(DB·R2·자산 연결)
├─ schema.sql         데이터베이스 표 + 초기 데이터
├─ package.json       명령 모음
├─ src/worker.js      서버 코드(API)
└─ public/            화면(index.html, 마스코트/교표 이미지)
```

## 지금 상태

- **화면이 서버에 연결되어 있습니다.** 학생 선언/로그인 → 매일 인증 → 달력·세 가지 힘·학교 성장(미르 자라기) → 자랑터·응원 → 공용 태블릿 → 교사(관리자) 로그인·학생 목록·학년 수 설정이 모두 **D1 데이터베이스에 실제로 저장/조회**됩니다.
- **사진 기능만 꺼져 있습니다**(R2 생략). 글·인증·통계 등은 모두 작동합니다.
- 배포 후 **디자인·메뉴·기능은 계속 수정** 가능합니다(코드 고치고 다시 `npm run deploy`). 이미 쌓인 데이터는 그대로 유지됩니다.

## 주요 API (참고)

| 메서드·경로 | 설명 |
|---|---|
| POST `/api/declare` | 학생 선언(가입/로그인) → 토큰 |
| POST `/api/kiosk-id` | 공용 태블릿 번호 인증 → 토큰 |
| POST `/api/me` | 내 정보·달력·힘·보너스 |
| POST `/api/certify` | 오늘 인증 (area: r/a/s) |
| POST `/api/upload` | 사진 업로드(R2) → key |
| GET `/api/photo/:key` | 사진 보기 |
| POST `/api/bonus` | 책마루·RAS갤러리 보너스 |
| GET `/api/stats` | 학교 통계·성장 목표 |
| GET `/api/gallery?area=` | 자랑터 목록 |
| POST `/api/react` | 박수/하트 토글 |
| GET `/api/content` | 가정통신문·설정 |
| POST `/api/admin/login` | 관리자 로그인 |
| GET `/api/admin/students` | 선언 학생 목록 |
| POST `/api/admin/grades` | 학년별 학생 수 저장 |
| POST `/api/admin/hide` | 게시글 숨김/복원 |
