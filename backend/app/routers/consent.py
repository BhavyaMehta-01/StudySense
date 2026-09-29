from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import uuid
from pydantic import BaseModel
from typing import Optional

from .. import models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/consent", tags=["consent"])

class ConsentStatus(BaseModel):
    data_donation_consent: bool
    consent_updated_at: Optional[datetime]
    consent_text_version: Optional[str]

class ConsentUpdate(BaseModel):
    data_donation_consent: bool
    consent_text_version: str

@router.get("", response_model=ConsentStatus)
def get_consent(current_user: models.User = Depends(get_current_user)):
    return ConsentStatus(
        data_donation_consent=current_user.data_donation_consent,
        consent_updated_at=current_user.consent_updated_at,
        consent_text_version=current_user.consent_text_version
    )

@router.put("", response_model=ConsentStatus)
def update_consent(
    consent_in: ConsentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    current_user.data_donation_consent = consent_in.data_donation_consent
    current_user.consent_updated_at = datetime.now(timezone.utc)
    current_user.consent_text_version = consent_in.consent_text_version
    
    if current_user.data_donation_consent and not current_user.anon_id:
        current_user.anon_id = uuid.uuid4()
        
    db.commit()
    db.refresh(current_user)
    
    return ConsentStatus(
        data_donation_consent=current_user.data_donation_consent,
        consent_updated_at=current_user.consent_updated_at,
        consent_text_version=current_user.consent_text_version
    )
