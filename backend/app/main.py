from fastapi import FastAPI
from .config import settings
from .routers import auth

app = FastAPI(title=settings.project_name)

app.include_router(auth.router)

@app.get("/health")
def health_check():
    return {"status": "ok", "project": settings.project_name, "env": settings.env}

