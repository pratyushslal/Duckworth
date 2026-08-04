from uuid import uuid4

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(color_scheme="dark")
    page.goto("http://127.0.0.1:4200", wait_until="domcontentloaded")
    page.get_by_role("status").filter(has_text="API connected").wait_for()

    suffix = uuid4().hex[:8]
    remembered_name = f"Lifecycle milk {suffix}"
    page.get_by_label("Add an item").fill(f"2 cartons {remembered_name}")
    page.locator(".capture-preview").filter(has_text="2 carton").wait_for()
    page.get_by_role("button", name="Add", exact=True).click()

    first_row = page.locator("li").filter(has_text=remembered_name)
    first_row.get_by_role("button", name="Purchased", exact=True).click()
    first_row.get_by_role("button", name="Reopen", exact=True).wait_for()

    page.get_by_label("Add an item").fill(f"2 {remembered_name}")
    preview = page.locator(".capture-preview").filter(has_text="From last time")
    preview.get_by_role("button", name="Accept carton", exact=True).wait_for()
    page.get_by_role("button", name="Add", exact=True).click()

    inferred_row = page.locator("li:not(.completed)").filter(has_text=remembered_name)
    inferred_row.locator(".unit-suggestion").filter(has_text="Check before ordering").wait_for()
    inferred_row.get_by_role("button", name="Accept carton", exact=True).click()
    inferred_row.locator(".unit-suggestion").wait_for(state="hidden")

    bare_name = f"Lifecycle rice {suffix}"
    page.get_by_label("Add an item").fill(bare_name)
    page.get_by_role("button", name="Add", exact=True).click()
    bare_row = page.locator("li:not(.completed)").filter(has_text=bare_name)
    bare_row.get_by_text("Needs details", exact=True).wait_for()
    bare_row.get_by_role("button", name="Add details", exact=True).click()
    bare_row.get_by_label(f"Quantity for {bare_name}").fill("3")
    bare_row.get_by_role("button", name="Save details", exact=True).click()
    bare_row.get_by_text("Needs details", exact=True).wait_for(state="hidden")
    bare_row.get_by_text("3", exact=True).wait_for()

    input_colors = page.get_by_label("Add an item").evaluate(
        "element => { const style = getComputedStyle(element); return [style.color, style.backgroundColor]; }"
    )
    assert input_colors[0] != input_colors[1]

    page.reload(wait_until="domcontentloaded")
    page.locator("li:not(.completed)").filter(has_text=bare_name).filter(has_text="3").wait_for()
    print("verified structured capture, unit history, inline completion, dark-theme legibility, and reload persistence")
    browser.close()
