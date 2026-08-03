from uuid import uuid4

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    writer = browser.new_page()
    observer = browser.new_page()
    writer.goto("http://127.0.0.1:4200", wait_until="domcontentloaded")
    observer.goto("http://127.0.0.1:4200", wait_until="domcontentloaded")

    writer.get_by_role("status").filter(has_text="API connected").wait_for(state="visible")
    observer.get_by_role("status").filter(has_text="API connected").wait_for(state="visible")

    item_name = f"SSE oats {uuid4().hex[:8]}"
    writer.get_by_label("Add an item").fill(item_name)
    writer.get_by_role("button", name="Add", exact=True).click()
    writer.get_by_text(item_name, exact=True).wait_for(state="visible")
    observer.get_by_text(item_name, exact=True).wait_for(state="visible")

    observer.locator("li").filter(has_text=item_name).get_by_role("button", name="Purchased").click()
    writer.locator("li").filter(has_text=item_name).get_by_role("button", name="Reopen").wait_for(state="visible")

    print(f"verified cross-page SSE synchronization for {item_name}")
    browser.close()
