from pathlib import Path

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:4200", wait_until="networkidle")

    assert page.locator("h1").inner_text() == "Shopping coordination starts here."
    assert page.get_by_role("status").inner_text() == "API connected"
    assert page.get_by_text("A lightweight shared space for the household’s next purchase.").is_visible()

    screenshot = Path(r"C:\tmp\duckworth-foundation.png")
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"verified {page.url}; screenshot={screenshot}")
    browser.close()
