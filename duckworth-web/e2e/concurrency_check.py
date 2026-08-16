from uuid import uuid4

from playwright.sync_api import sync_playwright
from runtime_guard import open_sandbox


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    first = browser.new_page()
    second = browser.new_page()
    _, household_id = open_sandbox(first)
    open_sandbox(second)
    first.get_by_role("status").filter(has_text="API connected").wait_for()
    second.get_by_role("status").filter(has_text="API connected").wait_for()

    original = f"Concurrency milk {uuid4().hex[:8]}"
    first.get_by_label("Add an item").fill(original)
    first.locator("form.add-form button[type=submit]").click()
    first.get_by_text(original, exact=True).wait_for()
    second.get_by_text(original, exact=True).wait_for()

    first.locator("li").filter(has_text=original).get_by_role("button", name="Edit item").click()
    first.get_by_label("Item name").fill("Authoritative milk")
    first.get_by_role("button", name="Save details").click()
    first.get_by_text("Authoritative milk", exact=True).wait_for()

    current = second.evaluate("""async (householdId) => {
      const response = await fetch(`/api/v1/households/${encodeURIComponent(householdId)}/items?includePurchased=true`);
      const items = await response.json();
      return items.find((item) => item.name === 'Authoritative milk');
    }""", household_id)
    stale_result = second.evaluate("""async ({ householdId, id, version }) => {
      const response = await fetch(`/api/v1/households/${encodeURIComponent(householdId)}/items/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Stale overwrite', expectedVersion: version - 1 })
      });
      return { status: response.status, body: await response.json() };
    }""", {**current, "householdId": household_id})
    assert stale_result["status"] == 409
    assert stale_result["body"]["currentItem"]["name"] == "Authoritative milk"
    assert first.get_by_text("Authoritative milk", exact=True).is_visible()
    print("verified stale update conflict preserves authoritative item")
    browser.close()
