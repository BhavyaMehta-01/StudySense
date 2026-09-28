from fastapi import FastAPI
from .config import settings

app = FastAPI(title=settings.project_name)

@app.get("/health")
def health_check():
    return {"status": "ok", "project": settings.project_name, "env": settings.env}
