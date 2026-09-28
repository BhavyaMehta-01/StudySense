from pydantic import BaseModel, EmailStr
from uuid import UUID

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class SafeUserResponse(BaseModel):
    id: UUID
    email: EmailStr
    name: str

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: SafeUserResponse
