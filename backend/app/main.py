from fastapi import FastAPI
from .config import settings
from .routers import auth, semesters, subjects, assessments, attendance, consent, dashboard, import_csv

app = FastAPI(title=settings.project_name)

app.include_router(auth.router)
app.include_router(semesters.router)
app.include_router(subjects.router)
app.include_router(assessments.router)
app.include_router(attendance.router)
app.include_router(consent.router)
app.include_router(dashboard.router)
app.include_router(import_csv.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "project": settings.project_name, "env": settings.env}

