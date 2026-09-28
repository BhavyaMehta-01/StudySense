from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    project_name: str = "StudySense"
    env: str = "development"
    database_url: str = "postgresql+psycopg://user:password@localhost:5432/studysense_dev"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
