import json
import os
from urllib.parse import urlparse

from playwright.sync_api import Page


def sandbox_origin() -> str:
    origin = os.environ.get("DUCKWORTH_E2E_SANDBOX_ORIGIN", "").strip()
    if not origin:
        raise RuntimeError(
            "DUCKWORTH_E2E_SANDBOX_ORIGIN must identify the disposable sandbox server"
        )
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("DUCKWORTH_E2E_SANDBOX_ORIGIN must be an absolute HTTP(S) origin")
    if parsed.port == 4200 or parsed.path or parsed.params or parsed.query or parsed.fragment:
        raise RuntimeError("E2E mutations are forbidden against the family-live origin")
    return origin.rstrip("/")


def sandbox_household_id() -> str:
    household_id = os.environ.get("DUCKWORTH_E2E_SANDBOX_HOUSEHOLD", "").strip()
    if not household_id or household_id == "household-demo":
        raise RuntimeError(
            "DUCKWORTH_E2E_SANDBOX_HOUSEHOLD must be a disposable non-family household"
        )
    return household_id


def validate_sandbox_health(payload: object) -> None:
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        raise RuntimeError("sandbox health handshake did not report status=ok")
    if payload.get("lane") not in {"sandbox", "api-test"}:
        raise RuntimeError("E2E mutations are forbidden unless the API proves lane=sandbox or api-test")
    if not isinstance(payload.get("instanceId"), str) or not payload["instanceId"].strip():
        raise RuntimeError("sandbox health handshake must include an instance ID")
    if payload.get("lane") == "api-test":
        expected = os.environ.get("DUCKWORTH_API_TEST_INSTANCE_ID", "").strip()
        if not expected or payload["instanceId"] != expected:
            raise RuntimeError("api-test health handshake did not match the expected instance identity")


def open_sandbox(page: Page) -> tuple[str, str]:
    origin = sandbox_origin()
    household_id = sandbox_household_id()
    page.add_init_script(
        "window.localStorage.setItem('duckworth.household-id', %s);" % json.dumps(household_id)
    )
    page.goto(origin, wait_until="domcontentloaded")
    response = page.request.get(f"{origin}/health")
    if not response.ok:
        raise RuntimeError(f"sandbox health handshake failed with HTTP {response.status}")
    validate_sandbox_health(response.json())
    return origin, household_id
