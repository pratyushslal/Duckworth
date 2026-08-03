from pathlib import Path
import time
from uuid import uuid4

from playwright.sync_api import sync_playwright


def wait_for_alert(page, expected: str) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if page.get_by_role("alert").inner_text() == expected:
            return
        page.wait_for_timeout(50)
    raise AssertionError(f"Expected alert {expected!r}, got {page.get_by_role('alert').inner_text()!r}")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:4200", wait_until="networkidle")

    assert page.locator("h1").inner_text() == "Shopping coordination starts here."
    assert page.get_by_role("status").inner_text() == "API connected"
    assert page.get_by_text("A lightweight shared space for the household’s next purchase.").is_visible()

    item_name = f"Browser milk {uuid4().hex[:8]}"
    page.get_by_label("Add an item").fill(item_name)
    page.get_by_role("button", name="Add", exact=True).click()
    page.get_by_text(item_name, exact=True).wait_for(state="visible")
    wait_for_alert(page, f"{item_name} added to the list.")

    page.get_by_label("Add an item").fill(item_name)
    page.get_by_role("button", name="Add", exact=True).click()
    wait_for_alert(page, "That item is already on the list.")

    page.locator("li").filter(has_text=item_name).get_by_role("button", name="Purchased").click()
    page.get_by_text(item_name, exact=True).wait_for(state="hidden")
    wait_for_alert(page, f"{item_name} marked purchased.")

    screenshot = Path(r"C:\tmp\duckworth-foundation.png")
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"verified {page.url}; screenshot={screenshot}")
    browser.close()
