from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright
from runtime_guard import open_sandbox


def wait_for_saved_capture(page, expected_count: str) -> None:
    page.get_by_role("heading", name="Capture result").wait_for()
    page.get_by_text(expected_count, exact=True).wait_for()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    open_sandbox(page)

    assert page.locator("h1").inner_text() == "Shopping coordination starts here."
    assert page.get_by_role("status").inner_text() == "API connected"
    assert page.get_by_text("A lightweight shared space for the household’s next purchase.").is_visible()

    item_name = f"Browser milk {uuid4().hex[:8]}"
    page.get_by_label("Add an item").fill(item_name)
    page.locator("form.add-form button[type=submit]").click()
    page.get_by_text(item_name, exact=True).wait_for(state="visible")
    wait_for_saved_capture(page, "Saved 1")

    page.get_by_label("Add an item").fill(item_name)
    page.locator("form.add-form button[type=submit]").click()
    page.get_by_role("heading", name="Capture result").wait_for()

    row = page.locator("li").filter(has_text=item_name).last
    row.get_by_role("button", name="Purchased").click()
    row.get_by_role("button", name="Reopen").wait_for()

    screenshot = Path(r"C:\tmp\duckworth-foundation.png")
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"verified {page.url}; screenshot={screenshot}")
    browser.close()
