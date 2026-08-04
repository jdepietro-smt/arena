"""
Router: /api/alerts

CRUD for AlertRule (models.py already had this table — stream_path, metric,
threshold, operator, action — with nothing anywhere in the codebase that
created, listed, or evaluated one; services/alerting.py now evaluates
active rules on a background loop, but until this router existed there was
no way to actually create a rule at all).

Also exposes current alert state (which streams are down, which rules are
currently firing) so a dashboard can show it without parsing server logs.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_active_user, require_admin
from ..database import get_session
from ..models import AlertAction, AlertRule, CompareOperator, MetricType, User
from ..services.alerting import get_alert_manager
from ..services.audit import log_audit

router = APIRouter(tags=["alerts"])


class AlertRuleCreate(BaseModel):
    stream_path: str
    metric: MetricType
    operator: CompareOperator
    threshold: float
    action: AlertAction = AlertAction.webhook


@router.get("", response_model=list[AlertRule], summary="List alert rules")
async def list_rules(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_active_user),
) -> list[AlertRule]:
    return session.exec(select(AlertRule)).all()


@router.post("", response_model=AlertRule, summary="Create an alert rule")
async def create_rule(
    body: AlertRuleCreate,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AlertRule:
    rule = AlertRule(**body.model_dump())
    session.add(rule)
    session.commit()
    session.refresh(rule)
    log_audit(
        session, admin.username, "alert_rule.create", target=rule.stream_path,
        detail=f"{rule.metric.value} {rule.operator.value} {rule.threshold}",
    )
    session.refresh(rule)  # log_audit's commit expires rule's attributes
    return rule


@router.patch("/{rule_id}/toggle", response_model=AlertRule, summary="Enable/disable a rule")
async def toggle_rule(
    rule_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> AlertRule:
    rule = session.get(AlertRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Alert rule {rule_id} not found")
    rule.is_active = not rule.is_active
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule


@router.delete("/{rule_id}", summary="Delete an alert rule")
async def delete_rule(
    rule_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> dict:
    rule = session.get(AlertRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Alert rule {rule_id} not found")
    target = rule.stream_path
    session.delete(rule)
    session.commit()
    log_audit(session, admin.username, "alert_rule.delete", target=target)
    return {"deleted": rule_id}


@router.get("/status", summary="Currently down streams / firing rules")
async def alert_status(_user: User = Depends(get_current_active_user)) -> dict:
    return get_alert_manager().status()
