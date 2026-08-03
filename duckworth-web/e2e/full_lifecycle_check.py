from uuid import uuid4

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:4200", wait_until="domcontentloaded")
    page.get_by_role("status").filter(has_text="API connected").wait_for()

    original = f"Lifecycle item {uuid4().hex[:8]}"
    page.get_by_label("Add an item").fill(original)
    page.get_by_role("button", name="Add", exact=True).click()
    page.get_by_text(original, exact=True).wait_for()

    row = page.locator("li").filter(has_text=original)
    row.get_by_role("button", name="Edit").click()
    page.get_by_label("Edit item").fill("Lifecycle renamed")
    page.get_by_role("button", name="Save").click()
    page.get_by_text("Lifecycle renamed", exact=True).wait_for()

    page.locator("li").filter(has_text="Lifecycle renamed").get_by_role("button", name="Purchased").click()
    page.locator("li").filter(has_text="Lifecycle renamed").get_by_role("button", name="Reopen").wait_for()
    page.reload(wait_until="domcontentloaded")
    page.get_by_text("Lifecycle renamed", exact=True).wait_for()

    print("verified add, edit, purchase, reopen, and reload persistence")
    browser.close()
