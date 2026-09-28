from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    project_name: str = "StudySense"
    env: str = "development"
    database_url: str = "postgresql+psycopg://user:password@localhost:5432/studysense_dev"
    
    jwt_secret: str = "unsafe_default_secret_for_development_only"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
