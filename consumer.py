from playwright.sync_api import sync_playwright


def login():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False)
        c = b.new_context()
        p = c.new_page()

        p.goto("https://messenger.com/")

        input("Press Enter after you have logged in")

        c.storage_state(path="storage_state.json")


def consume():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False)
        c = b.new_context(
            storage_state="storage_state.json", permissions=["microphone", "camera"]
        )
        p = c.new_page()

        p.goto("https://messenger.com/")
        p.get_by_role("button", name="Accept").click()

        input("Press Enter to exit")


if __name__ == "__main__":
    # login()
    consume()
