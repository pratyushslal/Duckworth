from uuid import uuid4

from playwright.sync_api import sync_playwright
from runtime_guard import open_sandbox


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    writer = browser.new_page()
    observer = browser.new_page()
    open_sandbox(writer)
    open_sandbox(observer)

    writer.get_by_role("status").filter(has_text="API connected").wait_for(state="visible")
    observer.get_by_role("status").filter(has_text="API connected").wait_for(state="visible")

    # Prove both event streams are connected before testing bidirectional updates.
    probe_name = f"SSE probe {uuid4().hex[:8]}"
    observer.get_by_label("Add an item").fill(probe_name)
    observer.locator("form.add-form button[type=submit]").click()
    writer.locator("li:not(.completed)").filter(has_text=probe_name).wait_for(state="visible")

    item_name = f"SSE oats {uuid4().hex[:8]}"
    writer.get_by_label("Add an item").fill(item_name)
    writer.locator("form.add-form button[type=submit]").click()
    writer_row = writer.locator("li:not(.completed)").filter(has_text=item_name)
    observer_row = observer.locator("li:not(.completed)").filter(has_text=item_name)
    observer_row.get_by_text("1 piece", exact=False).wait_for(state="visible")

    writer_row.get_by_role("button", name="Edit item", exact=True).click()
    writer_row.get_by_label(f"Quantity for {item_name}").fill("2")
    writer_row.get_by_role("button", name="Save details", exact=True).click()
    observer_row.get_by_text("2", exact=False).wait_for(state="visible")

    observer_row.get_by_role("button", name="Purchased", exact=True).click()
    writer.locator("li").filter(has_text=item_name).get_by_role("button", name="Reopen", exact=True).wait_for(state="visible")

    print(f"verified cross-page structured SSE synchronization for {item_name}")
    browser.close()
