import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from runtime_guard import open_sandbox
PACK_ROOT = Path(__file__).parents[2] / "duckworth-api" / "language-packs"
MANIFEST_TEXT = (PACK_ROOT / "countries" / "IN" / "manifest.json").read_text(encoding="utf-8")
MANIFEST = json.loads(MANIFEST_TEXT)


def serve_pack_request(route) -> None:
    if route.request.url.endswith("/countries/IN/manifest"):
        route.fulfill(status=200, content_type="application/json", body=MANIFEST_TEXT)
        return
    descriptor = next(
        entry for entry in MANIFEST["locales"]
        if f"/{entry['locale']}/{entry['version']}" in route.request.url
    )
    route.fulfill(
        status=200,
        content_type="application/json",
        body=(PACK_ROOT / descriptor["artifactPath"]).read_text(encoding="utf-8"),
    )

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.route("**/api/v1/language-packs/**", serve_pack_request)
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url))
    open_sandbox(page)
    page.get_by_role("status").filter(has_text="API connected").wait_for()

    page.get_by_text("Language assistance", exact=True).click()
    load_languages = page.locator("app-language-settings button.load-button")
    if load_languages.count():
        load_languages.click()
    page.get_by_text("Hinglish (Latin, India)", exact=True).wait_for()
    page.get_by_role("button", name="Enable", exact=True).click()
    page.locator("li").filter(has_text="Hinglish (Latin, India)").get_by_text("Active", exact=True).wait_for()

    capture = page.get_by_role("combobox", name="Item jodein")
    baseline_requests = len(requests)
    capture.fill("att")
    page.get_by_role("option").filter(has_text="atta").wait_for()
    page.wait_for_timeout(100)
    assert len(requests) == baseline_requests, "typing created an HTTP request"
    capture.press("ArrowDown")
    capture.press("ArrowRight")
    assert capture.input_value() == "atta"

    cached_capture = page.get_by_role("combobox", name="Item jodein")
    baseline_requests = len(requests)
    cached_capture.fill("att")
    page.get_by_role("option").filter(has_text="atta").wait_for()
    page.wait_for_timeout(100)
    assert len(requests) == baseline_requests, "cached typing created an HTTP request"
    cached_capture.fill("बिस्कुट 2 pcs")
    preview = page.locator(".capture-preview")
    preview.wait_for(state="attached")
    assert "2" in (preview.text_content() or ""), "offline Unicode capture should preserve its quantity"

    print("verified no-keystroke requests, atomic Hinglish activation, cached offline assistance, and Unicode fallback")
    browser.close()
