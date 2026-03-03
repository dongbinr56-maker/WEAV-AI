# Win & Mac QuickStart GuideLine (Docker 기준)

전제: 이 문서는 **이미 필요한 키/환경이 설정돼 있다**고 가정하고, 불필요한 설명(예: `.env` 복사 등)은 전부 생략합니다.  
목표: **Docker 완전 내림 -> Docker 올림 -> 마이그레이션 -> 정상 동작 확인 -> 프론트(UI) 접속** 까지만.

---

## 1) Windows (PowerShell)

### 1-1. Docker 완전 내림

프로젝트 루트에서:

```powershell
.\compose.ps1 down
```

### 1-2. Docker 올림(빌드 포함)

```powershell
.\compose.ps1 build
.\compose.ps1 up
```

### 1-3. 마이그레이션

```powershell
.\compose.ps1 migrate
```

### 1-4. 정상 동작 확인(백엔드)

브라우저로 아래 접속:

- http://localhost:8080/api/v1/health/

`{"status":"ok"}` 가 보이면 정상.

### 1-5. 프론트(UI) 접속

프론트는 Docker 컨테이너가 아니라 **로컬에서 dev 서버로 실행**합니다.

```powershell
cd frontend
npm install
npm run dev
```

브라우저 접속:

- http://localhost:3001

---

## 2) macOS (터미널)

### 2-1. Docker 완전 내림

프로젝트 루트에서:

```bash
make down
```

### 2-2. Docker 올림(빌드 포함)

```bash
make build
make up
```

### 2-3. 마이그레이션

```bash
make migrate
```

### 2-4. 정상 동작 확인(백엔드)

브라우저로 아래 접속:

- http://localhost:8080/api/v1/health/

`{"status":"ok"}` 가 보이면 정상.

### 2-5. 프론트(UI) 접속

프론트는 Docker 컨테이너가 아니라 **로컬에서 dev 서버로 실행**합니다.

```bash
cd frontend
npm install
npm run dev
```

브라우저 접속:

- http://localhost:3001

