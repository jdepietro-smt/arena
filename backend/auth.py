from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from .config import settings
from .database import get_session
from .models import Token, TokenData, User, UserCreate, UserRead, UserRole

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


def _authenticate_user(session: Session, username: str, password: str) -> Optional[User]:
    user = session.exec(select(User).where(User.username == username)).first()
    if user is None:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: Optional[str] = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username, role=payload.get("role"))
    except JWTError:
        raise credentials_exception

    user = session.exec(select(User).where(User.username == token_data.username)).first()
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return current_user


async def require_admin(
    current_user: User = Depends(get_current_active_user),
) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["auth"])


@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
) -> Token:
    """OAuth2-compatible token endpoint. Exchange username + password for JWT."""
    user = _authenticate_user(session, form_data.username, form_data.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(access_token=access_token)


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_in: UserCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> UserRead:
    """Create a new user. Admin only."""
    existing = session.exec(
        select(User).where(User.username == user_in.username)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{user_in.username}' is already taken",
        )
    existing_email = session.exec(
        select(User).where(User.email == user_in.email)
    ).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email '{user_in.email}' is already registered",
        )
    new_user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        role=user_in.role,
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)
    return UserRead.model_validate(new_user)


@router.get("/me", response_model=UserRead)
async def read_current_user(
    current_user: User = Depends(get_current_active_user),
) -> UserRead:
    """Return the authenticated user's profile."""
    return UserRead.model_validate(current_user)
