from uuid import uuid4

from playwright.sync_api import sync_playwright
from runtime_guard import open_sandbox


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(color_scheme="dark")
    open_sandbox(page)
    page.get_by_role("status").filter(has_text="API connected").wait_for()

    suffix = uuid4().hex[:8]
    remembered_name = f"Lifecycle milk {suffix}"
    page.get_by_label("Add an item").fill(f"{remembered_name} 2 cartons")
    page.locator(".capture-preview").filter(has_text="2 carton").wait_for()
    page.locator("form.add-form button[type=submit]").click()

    first_row = page.locator("li").filter(has_text=remembered_name)
    first_row.get_by_role("button", name="Purchased", exact=True).click()
    first_row.get_by_role("button", name="Reopen", exact=True).wait_for()

    page.get_by_label("Add an item").fill(remembered_name)
    preview = page.locator(".capture-preview").filter(has_text="From last time")
    preview.get_by_role("button", name="Accept carton", exact=True).wait_for()
    page.locator("form.add-form button[type=submit]").click()

    inferred_row = page.locator("li:not(.completed)").filter(has_text=remembered_name)
    inferred_row.locator(".unit-suggestion").filter(has_text="Check before ordering").wait_for()
    inferred_row.get_by_role("button", name="Accept carton", exact=True).click()
    inferred_row.locator(".unit-suggestion").wait_for(state="hidden")

    bare_name = f"Lifecycle rice {suffix}"
    page.get_by_label("Add an item").fill(bare_name)
    page.locator("form.add-form button[type=submit]").click()
    bare_row = page.locator("li:not(.completed)").filter(has_text=bare_name)
    bare_row.get_by_text("1 piece", exact=False).wait_for()

    input_colors = page.get_by_label("Add an item").evaluate(
        "element => { const style = getComputedStyle(element); return [style.color, style.backgroundColor]; }"
    )
    assert input_colors[0] != input_colors[1]

    page.reload(wait_until="domcontentloaded")
    reloaded_row = page.locator("li:not(.completed)").filter(has_text=bare_name)
    reloaded_row.get_by_text("1 piece", exact=False).wait_for()
    print("verified structured capture, unit history, inline completion, dark-theme legibility, and reload persistence")
    browser.close()
