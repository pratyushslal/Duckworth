from uuid import uuid4

from playwright.sync_api import sync_playwright

from runtime_guard import open_sandbox


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    origin, household_id = open_sandbox(page)
    page.locator(".status.ready").wait_for(state="attached")

    item_name = f"Browser review milk {uuid4().hex[:8]}"
    page.get_by_label("Add an item").fill(item_name)
    page.locator("form.add-form button[type=submit]").click()
    row = page.locator("li:not(.completed)").filter(has_text=item_name)
    row.wait_for(state="visible")

    items_response = page.request.get(
        f"{origin}/api/v1/households/{household_id}/items?includePurchased=true&includeRemoved=true"
    )
    assert items_response.ok, items_response.text()
    item = next(candidate for candidate in items_response.json() if candidate["name"] == item_name)
    item_id = item["id"]

    patch_response = page.request.patch(
        f"{origin}/api/v1/households/{household_id}/items/{item_id}",
        data={"quantity": None, "confirmedUnit": None, "expectedVersion": item["version"]},
    )
    assert patch_response.ok, patch_response.text()
    page.reload(wait_until="domcontentloaded")
    page.locator(".status.ready").wait_for(state="attached")

    page.get_by_role("button", name="Review learned preferences").click()
    unresolved = page.locator(".learning-metric-link")
    unresolved.wait_for(state="visible")
    unresolved.click()

    review = page.locator(".unresolved-review")
    review.get_by_text(item_name, exact=True).wait_for(state="visible")
    review.get_by_text("Quantity missing", exact=True).wait_for(state="visible")
    review.get_by_text("Unit missing", exact=True).wait_for(state="visible")
    review.get_by_role("button", name="Review item", exact=True).click()

    focused_row = page.locator(f"#shopping-item-{item_id}")
    focused_row.get_by_label(f"Quantity for {item_name}", exact=True).fill("2")
    focused_row.get_by_label(f"Unit for {item_name}", exact=True).fill("cartons")
    focused_row.get_by_role("button", name="Save details", exact=True).click()

    page.get_by_text("0 unresolved", exact=True).wait_for(state="visible")
    assert focused_row.locator(".attention-badge").count() == 0
    print("verified unresolved count, exact missing-field guidance, review navigation, and count refresh")
    browser.close()
