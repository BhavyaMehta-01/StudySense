# StudySense

StudySense is an academic performance tracking and weekly study allocation platform designed for university students. It combines coursework tracking, attendance monitoring, and weighted grade calculations with a deterministic, multi-factor weekly study-time allocation engine.

---

## 1. Project Title & Overview

**StudySense** provides students with a single source of truth for their academic coursework across semesters. Beyond record-keeping, StudySense actively helps students plan their study time by analyzing upcoming assessment deadlines, current grades against target goals, and assessment weight pressure to generate personalized weekly study schedules.

---

## 2. Problem Statement & Project Goals

### Problem Statement
University students commonly juggle 4 to 6 concurrent courses, each with distinct grading schemes, scattered assignment deadlines, and varying attendance rules. As a result, students frequently:
- Lose track of remaining course weight and whether their target grades remain mathematically achievable.
- Fall into reactive cramming—studying almost exclusively for the nearest exam while neglecting high-weight projects or subjects where they face substantial grade deficits.
- Lack objective guidance on how to apportion their weekly study hours effectively across courses.

### Project Goals
1. **Academic Clarity:** Centralize semester subjects, attendance, and weighted assessments into a unified dashboard.
2. **Target Feasibility:** Compute required scores on remaining coursework to achieve target course grades.
3. **Deterministic Planning:** Apportion a student's self-reported weekly study budget across courses using an objective, multi-factor weighting formula.
4. **Transparent Scheduling:** Give students clear, human-readable explanations of why time was allocated to each subject without opaque black-box metrics.
5. **Session Accountability:** Enable fast logging of study sessions to monitor planned versus completed study hours in real time.

---

## 3. Current Features

### Authentication & Account Management
- **Secure Registration & Login:** User account creation and authentication using email and password.
- **Argon2 Password Hashing:** State-of-the-art password hashing using Argon2 via Passlib.
- **JWT Session Tokens:** Stateless JSON Web Token authentication with configurable expiration.

### Semester & Subject Organization
- **Semester Lifecycle:** Create, view, update, and delete semesters with academic year tagging.
- **Single Active Semester:** Enforced database constraint ensuring each user has at most one active semester at a time.
- **Subject Management:** Organize subjects within semesters with course codes, credit hours, and target percentage goals ($0\text{--}100\%$).

### Assessment & Marks Tracking
- **Categorized Assessments:** Track 9 assessment categories: `internal_test`, `assignment`, `quiz`, `practical`, `viva`, `project`, `midsem`, `endsem`, and `other`.
- **Status Lifecycle:** Mark assessments as `pending`, `scored`, `absent`, or `exempt`.
- **Validation Constraints:** Database-level check constraints enforce valid weightages ($0\text{--}100\%$), positive max marks, and score validity.
- **Assessment Deadlines:** Schedule assessment dates to track urgency and time-to-exam.

### Attendance Tracking
- **Class Logs:** Record classes attended and classes held per subject on specific dates.
- **Attendance Percentage:** Real-time percentage calculation with constraint checks ($0 \le \text{attended} \le \text{held}$).

### Target-Score Calculator
- **Feasibility Analysis (`POST /subjects/{id}/calculate-required`):** Automatically computes:
  - Points earned from scored assessments.
  - Remaining coursework weight available.
  - Required percentage across remaining assessments to hit the student's target grade.
  - Automatic status flags: `target_achieved` (target already locked) or `impossible` (mathematically unattainable).

### Academic Dashboard
- **Cumulative Overview:** High-level summary of total semesters, subjects, earned marks, completed weight, pending weight, completed work percentage, and overall attendance rate.

### Weekly Study Plan Generation
- **Active Semester Integration:** Generates weekly study plans for eligible subjects in the active semester.
- **Monday–Sunday Calendar Bound:** Plans are strictly constrained to calendar weeks (Monday start to Sunday end).
- **Time Budgeting:** Students allocate their weekly study time in minutes (positive and divisible by 5).

### Deterministic Allocation Engine
- **Multi-Factor Weighted Formula:** Study time is distributed based on three primary factors:
  - **Urgency ($50\%$ weight):** Driven by assessments due within 14 days ($1 - \text{days}/14$).
  - **Deficit ($30\%$ weight):** Driven by the gap between target score and current scored percentage.
  - **Weight Pressure ($20\%$ weight):** Driven by upcoming assessment weight as a proportion of remaining weight.
- **Fairness Rules:**
  - **60% Maximum Cap:** Prevents a single subject from monopolizing more than 60% of the weekly study budget when more than 2 eligible subjects exist.
  - **5-Minute Quantization:** Rounds allocations to 5-minute increments while strictly preserving the total available minutes invariant.
  - **Snapshot State:** Stores an immutable JSON snapshot of all factors and the winning driver for each allocation.

### Study-Plan Lifecycle & Progress Tracking
- **Visual Progress Bars:** Track completed study minutes versus planned minutes for both the overall weekly plan and individual subjects.
- **Study Session Logging:** Log study sessions against plan allocations or general study, recording duration, date, and status (`completed`, `partial`, `skipped`).
- **Over-Allocation Badges:** Visual indicators when logged study time exceeds planned allocation.
- **Plan Deactivation:** Idempotent deactivation (`PATCH /study-plans/{id}/deactivate`) preserving historical session links while unblocking generation of a new active plan.
- **Expired Plan Warnings:** Automatic banner when an active plan's week has concluded, prompting the student to deactivate and generate a new plan.

### Human-Readable Allocation Explanations
- **Expandable Accordion:** "Why this allocation?" toggle on each allocation row.
- **Plain-Language Translations:** Replaces internal codes (`ALLOCATED_URGENCY`, `ALLOCATED_DEFICIT`, `ALLOCATED_WEIGHT`, `ALLOCATED_BASELINE`) with clear explanations:
  - *Upcoming assessment:* Details days until the exam and assessment weight percentage.
  - *Target deficit:* Details current grade, target grade, and point deficit.
  - *High weight:* Details substantial coursework weight pressure.
  - *Standard review:* Explains baseline allocation for balanced subject progress.
- **Safe Fallbacks:** Gracefully handles missing or partial snapshot data without errors or raw system codes.

### CSV Data Import & Consent
- **Bulk CSV Import (`POST /import/csv`):** Import subjects, assessments, and attendance records via multipart CSV upload. Supports `academic` and `attendance` import types, dry-run validation preview (`dry_run=True`), and auto-creation of missing semesters and subjects.
- **Data Donation Consent (`GET / PUT /consent`):** Opt-in consent tracking with user pseudonymization (`anon_id`) generated upon agreement for academic research.

---

## 4. Technology Stack

### Backend
- **Framework:** FastAPI `0.116.2` (Python 3.12+)
- **ASGI Server:** Uvicorn `0.54.0`
- **Database ORM:** SQLAlchemy `2.0.54`
- **Database Driver:** Psycopg 3 (`psycopg-binary 3.3.6`)
- **Schema Validation & Settings:** Pydantic `2.11.10`, Pydantic Settings `2.15.0`
- **Database Migrations:** Alembic `1.16.5`
- **Security:** Passlib `1.7.4` (Argon2), PyJWT `2.15.1`, python-multipart `0.0.12`
- **Testing:** Pytest `9.1.1`, HTTPX `0.28.1`, Starlette TestClient

### Frontend
- **Framework:** React `19.1` (TypeScript `5.8`)
- **Bundler & Dev Server:** Vite `7.3.6`
- **Routing:** React Router `7.18.4`
- **Styling:** Tailwind CSS `v4` (`@tailwindcss/vite 4.3.3`)
- **Server State Management:** TanStack React Query `5.104.0`
- **Forms & Validation:** React Hook Form `7.89.0` with Zod `4.6.5`
- **Icons:** Lucide React `1.48.0`
- **Data Visualization:** Recharts `3.10.1`
- **Testing:** Vitest `5.0.2`, Testing Library (React, DOM, Jest-DOM), JSDOM `30.1.1`
- **Linter:** Oxlint `1.81.0`

### Database
- **Engine:** PostgreSQL 15+ (tested with PostgreSQL 15 and 16)

---

## 5. Architecture Overview

StudySense uses a decoupled client-server architecture. The React single-page application communicates with the FastAPI backend over a RESTful JSON API. All database interactions are managed via SQLAlchemy ORM with transactional integrity and foreign-key cascade protections.

```mermaid
flowchart TD
    subgraph Frontend ["Frontend (React 19 + Vite)"]
        UI[Pages & UI Components]
        RQ[TanStack React Query Cache]
        APIClient[Axios/Fetch API Client]
        UI --> RQ
        RQ --> APIClient
    end

    subgraph Backend ["Backend (FastAPI)"]
        CORS[CORS Middleware]
        AuthRouter["/auth (JWT & Argon2)"]
        AcademicRouter["/semesters, /subjects, /assessments"]
        PlanRouter["/study-plans, /study-sessions"]
        DashRouter["/dashboard, /import, /consent"]
        Engine["Allocation Engine (Deterministic V1b)"]
        Calc["Target-Score Calculator"]

        APIClient -->|JSON / Bearer Token| CORS
        CORS --> AuthRouter
        CORS --> AcademicRouter
        CORS --> PlanRouter
        CORS --> DashRouter
        PlanRouter --> Engine
        AcademicRouter --> Calc
    end

    subgraph Database ["Database (PostgreSQL)"]
        Tables[(users, semesters, subjects,<br/>assessments, attendances,<br/>study_plans, study_plan_allocations,<br/>study_sessions)]
        AuthRouter --> Tables
        AcademicRouter --> Tables
        PlanRouter --> Tables
        DashRouter --> Tables
    end
```

---

## 6. Project Directory Structure

```text
StudySense/
├── .env.example                  # Environment template for local development
├── README.md                     # Project documentation (this file)
├── backend/                      # FastAPI backend application
│   ├── alembic/                  # Database migration scripts
│   │   ├── versions/             # Individual migration revisions
│   │   └── env.py                # Alembic environment runner
│   ├── alembic.ini               # Alembic configuration
│   ├── app/                      # Application package
│   │   ├── allocation_engine.py  # V1b study time allocation algorithm
│   │   ├── calculator.py         # Required score calculator logic
│   │   ├── config.py             # Pydantic Settings & CORS configuration
│   │   ├── database.py           # SQLAlchemy engine & session factory
│   │   ├── dependencies.py       # Auth & DB dependency injection
│   │   ├── main.py               # FastAPI application entrypoint & middleware
│   │   ├── models.py             # SQLAlchemy ORM models & table definitions
│   │   ├── schemas.py            # Pydantic request/response schemas
│   │   └── routers/              # API router modules
│   │       ├── assessments.py    # Assessment CRUD endpoints
│   │       ├── attendance.py     # Attendance logs endpoints
│   │       ├── auth.py           # Registration, login, profile endpoints
│   │       ├── consent.py        # Research consent endpoints
│   │       ├── dashboard.py      # Summary metrics endpoint
│   │       ├── import_csv.py     # CSV bulk import endpoint
│   │       ├── semesters.py      # Semester CRUD & activation endpoints
│   │       ├── study_plans.py    # Study plan generation & deactivation
│   │       ├── study_sessions.py # Study session tracking endpoints
│   │       └── subjects.py       # Subject CRUD & calculator endpoints
│   ├── requirements.txt          # Production Python dependencies
│   ├── requirements-dev.txt      # Development & testing Python dependencies
│   └── tests/                    # Backend Pytest suite (93 tests)
└── frontend/                     # React + Vite frontend application
    ├── index.html                # HTML entrypoint
    ├── package.json              # NPM dependencies and scripts
    ├── tsconfig.json             # TypeScript compiler configuration
    ├── vite.config.ts            # Vite bundler configuration
    └── src/
        ├── api/                  # Typed API client wrapper
        ├── components/           # Reusable UI & domain components
        │   ├── dashboard/        # Dashboard, study plan, & session forms
        │   │   ├── GenerateStudyPlanForm.tsx
        │   │   ├── LogStudySessionForm.tsx
        │   │   ├── StudyPlanProgress.tsx
        │   │   ├── allocationExplanation.ts
        │   │   └── studyPlanDates.ts
        │   ├── layout/           # App navigation & sidebar layouts
        │   └── ui/               # Base primitives (button, input, etc.)
        ├── hooks/                # Custom React hooks (useAuth, etc.)
        ├── layouts/              # Protected layout wrappers
        ├── pages/                # Route view components
        │   ├── Dashboard.tsx     # Overview dashboard page
        │   ├── Import.tsx        # CSV bulk import page
        │   ├── Login.tsx         # User authentication page
        │   ├── Register.tsx      # User registration page
        │   ├── SemesterDetail.tsx# Subject list for semester
        │   ├── Semesters.tsx     # Semester management page
        │   ├── Settings.tsx      # Consent and profile settings
        │   └── SubjectDetail.tsx # Assessments, attendance, calculator
        └── types/                # TypeScript interface definitions
```

---

## 7. Prerequisites

Before installing StudySense locally, ensure the following are installed on your machine:
- **Python:** Version `3.12` or higher (`python3 --version`)
- **Node.js:** Version `^20.19.0` or `>=22.12.0` (required by Vite 7; verify with `node --version`)
- **NPM:** Version `9.0.0` or higher (`npm --version`)
- **PostgreSQL:** Version `15` or higher running locally or via Docker (`psql --version`)

---

## 8. Local Installation and Setup

### 1. Clone the repository
```bash
git clone https://github.com/BhavyaMehta-01/StudySense.git
cd StudySense
```

### 2. Backend setup
Create and activate a Python virtual environment, then install dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
cd ..
```

*(On Windows PowerShell, use `.venv\Scripts\Activate.ps1` to activate the virtual environment).*

### 3. Frontend setup
Install frontend Node modules:

```bash
cd frontend
npm install
cd ..
```

---

## 9. Environment Variable Configuration

Create a local `.env` file in the `backend/` directory by copying `.env.example`:

```bash
cp .env.example backend/.env
```

Edit `backend/.env` with your local settings:

| Variable | Description | Default / Example |
|---|---|---|
| `ENV` | Application environment (`development` / `production`) | `development` |
| `PORT` | Backend server port | `8000` |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins | `http://localhost:5173,http://127.0.0.1:5173` |
| `SECRET_KEY` | Secret key for cryptographic signing | *(generate a random string)* |
| `JWT_SECRET` | Secret key for signing JWT tokens | *(generate a random string)* |
| `JWT_ALGORITHM` | Algorithm used for JWT encoding | `HS256` |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifespan in minutes | `60` |
| `DATABASE_URL` | PostgreSQL connection string using `postgresql+psycopg` | `postgresql+psycopg://user:password@localhost:5432/studysense_dev` |
| `OPENAI_API_KEY` | Optional placeholder for planned AI features | *(optional)* |

> [!IMPORTANT]
> Never commit `.env` files or secret keys to source control. The `.gitignore` file is configured to exclude `backend/.env`.

---

## 10. Database Setup and Migrations

### 1. Create the PostgreSQL database
Ensure your PostgreSQL server is running, then create the development database:

```bash
# Using PostgreSQL CLI
psql -U postgres -c "CREATE DATABASE studysense_dev;"
```

If your local database credentials differ from the example, update `DATABASE_URL` in `backend/.env`.

### 2. Apply database migrations
From the `backend/` directory with your virtual environment activated:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
cd ..
```

To verify the current migration status:
```bash
cd backend
alembic current
cd ..
```

---

## 11. Running the Frontend and Backend

### 1. Start the backend server
In your first terminal, activate the virtual environment and start FastAPI via Uvicorn:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```
- API root: `http://localhost:8000`
- Interactive OpenAPI docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### 2. Start the frontend development server
In a second terminal, start the Vite development server:

```bash
cd frontend
npm run dev
```
- Web Application: `http://localhost:5173`

---

## 12. Running Tests, Lint, and Production Build

### Backend Tests (Pytest)
Run the full backend test suite with coverage from the `backend/` directory:

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. pytest
```
*Current test suite: **93 tests passed** across authentication, CRUD, allocation engine, calculator, CORS, study plans, and study sessions.*

### Frontend Tests (Vitest)
Run the complete frontend test suite from the `frontend/` directory:

```bash
cd frontend
npx vitest run
```
*Current test suite: **116 tests passed** across 14 test files.*

### Frontend Linting (Oxlint)
Run the linter to verify code cleanliness:

```bash
cd frontend
npm run lint
```

### Frontend Production Build
Validate TypeScript types and build the production bundle:

```bash
cd frontend
npm run build
```

---

## 13. Current Development Status

StudySense has completed **Phase 1** and **Phase 2** of its core roadmap:

| Milestone | Status | Description |
|---|---|---|
| **Phase 1A: Core Academic Schema** | Complete | User authentication, semesters, subjects, assessments, and attendance models. |
| **Phase 1B: Academic Dashboard & Calculator** | Complete | Dashboard metric aggregation and needed-score target feasibility calculator. |
| **Phase 1C: Allocation Engine & Session Tracking** | Complete | V1b deterministic allocation algorithm, study plan generation, and session logging. |
| **Phase 2A: Semester Activation & Plan Generation UI** | Complete | Semester activation UI, Monday–Sunday date validation, and generation form. |
| **Phase 2B: Plan Management & Explanations** | Complete | Idempotent plan deactivation, expired-week alerts, and human-readable allocation explanations. |

---

## 14. Roadmap

The following capabilities represent planned features for future releases:

- [ ] **Phase 3: Historical Analytics & Trends**
  - Multi-week study habit analysis (adherence rate, subject bias).
  - Attendance risk forecasting and grade impact projections.
- [ ] **Phase 4: Adaptive Rescheduling**
  - Mid-week rebalancing when study sessions are logged as skipped or partial.
  - Automatic adjustments for rescheduled or newly added assessments.
- [ ] **Phase 5: External Calendar Integration**
  - Export weekly study schedules to iCal / Google Calendar.
- [ ] **Phase 6: Advanced Effort Modeling**
  - Machine learning models for student-specific task velocity and subjective difficulty adjustments (currently purely deterministic).
- [ ] **Phase 7: Mobile & PWA**
  - Progressive Web App support for mobile-optimized quick session logging.

---

## 15. Security & Data Considerations

- **Tenant Isolation:** All database queries scope records strictly to `current_user.id` or verify parent foreign-key relationships. Cross-tenant access returns HTTP 404 or 403.
- **Password Security:** Passwords are never stored in plaintext. They are hashed using the Argon2id algorithm with unique salts.
- **Token Security:** JWT access tokens expire after a configurable duration (default: 60 minutes) and require cryptographic validation on every authenticated request.
- **Research Pseudonymization:** Upon opt-in data donation consent (`PUT /consent`), the system provisions a persistent unique pseudonymized UUID (`anon_id`) on the `users` table for research linkage, decoupling academic records from personal identifiers (names, emails).
- **Database Constraints:** Relational constraints (cascading deletes on user removal, check constraints on marks and attendance) prevent orphan data and corrupted state.
- **CORS Protection:** Cross-Origin Resource Sharing is locked down to explicitly approved development origins (`http://localhost:5173`, `http://127.0.0.1:5173`) with strict header filtering.
- **Zero Secrets Policy:** No credentials, private student data, or database dumps are ever committed to this repository.
