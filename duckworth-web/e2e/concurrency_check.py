from uuid import uuid4

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    first = browser.new_page()
    second = browser.new_page()
    first.goto("http://127.0.0.1:4200", wait_until="domcontentloaded")
    second.goto("http://127.0.0.1:4200", wait_until="domcontentloaded")
    first.get_by_role("status").filter(has_text="API connected").wait_for()
    second.get_by_role("status").filter(has_text="API connected").wait_for()

    original = f"Concurrency milk {uuid4().hex[:8]}"
    first.get_by_label("Add an item").fill(original)
    first.get_by_role("button", name="Add", exact=True).click()
    first.get_by_text(original, exact=True).wait_for()
    second.get_by_text(original, exact=True).wait_for()

    first.locator("li").filter(has_text=original).get_by_role("button", name="Edit").click()
    first.get_by_label("Edit item").fill("Authoritative milk")
    first.get_by_role("button", name="Save").click()
    first.get_by_text("Authoritative milk", exact=True).wait_for()

    current = second.evaluate("""async () => {
      const response = await fetch('/api/v1/households/household-demo/items?includePurchased=true');
      const items = await response.json();
      return items.find((item) => item.name === 'Authoritative milk');
    }""")
    stale_result = second.evaluate("""async ({ id, version }) => {
      const response = await fetch(`/api/v1/households/household-demo/items/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Stale overwrite', expectedVersion: version - 1 })
      });
      return { status: response.status, body: await response.json() };
    }""", current)
    assert stale_result["status"] == 409
    assert stale_result["body"]["currentItem"]["name"] == "Authoritative milk"
    assert first.get_by_text("Authoritative milk", exact=True).is_visible()
    print("verified stale update conflict preserves authoritative item")
    browser.close()
