from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .. import schemas
from ..models import User
from ..auth import get_password_hash, verify_password, create_access_token
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=schemas.SafeUserResponse)
def register(user_in: schemas.UserRegister, db: Session = Depends(get_db)):
    email_normalized = user_in.email.lower()
    existing_user = db.query(User).filter(User.email == email_normalized).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    
    user = User(
        email=email_normalized,
        password_hash=get_password_hash(user_in.password),
        name=user_in.name
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
        
    return user

@router.post("/login", response_model=schemas.TokenResponse)
def login(user_in: schemas.UserLogin, db: Session = Depends(get_db)):
    email_normalized = user_in.email.lower()
    user = db.query(User).filter(User.email == email_normalized).first()
    
    # Generic error message to prevent email enumeration
    auth_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if not user:
        raise auth_exception
        
    if not verify_password(user_in.password, user.password_hash):
        raise auth_exception
        
    access_token = create_access_token(subject=str(user.id))
    return schemas.TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=user
    )

@router.get("/me", response_model=schemas.SafeUserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user
