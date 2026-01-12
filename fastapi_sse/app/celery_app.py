"""Celery application for distributed task execution."""
from celery import Celery
from .config import get_settings

settings = get_settings()

celery_app = Celery(
    "iliagpt_workers",
    broker=settings.celery_broker,
    backend=settings.celery_backend,
    include=["fastapi_sse.workers.agent_tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=settings.agent_task_timeout + 30,
    task_soft_time_limit=settings.agent_task_timeout,
    
    worker_prefetch_multiplier=1,
    worker_concurrency=4,
    
    task_default_retry_delay=5,
    task_max_retries=settings.agent_max_retries,
    
    result_expires=3600,
    result_extended=True,
    
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=10,
)

celery_app.conf.task_routes = {
    "fastapi_sse.workers.agent_tasks.*": {"queue": "agent_queue"}
}
