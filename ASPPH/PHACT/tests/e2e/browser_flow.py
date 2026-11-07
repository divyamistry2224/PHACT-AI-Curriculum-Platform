"""Clicks through PHACT in a headless browser against the local harness (tests/e2e/local_api.py), as both
a faculty member and an admin. Fails on the first broken step and saves a screenshot of each screen.

  python3 tests/e2e/local_api.py &
  (build the front end in live mode against it and serve it on port 4173; see README "Test the web app locally")
  python3 tests/e2e/browser_flow.py [--app http://localhost:4173] [--shots /tmp/phact-shots]
"""

import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP = sys.argv[sys.argv.index("--app") + 1] if "--app" in sys.argv else "http://localhost:4173"
SHOTS = Path(sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else "/tmp/phact-shots")
SEED = ROOT / "data" / "seed-syllabi" / "MPH_Syllabus_01_Northeast_Epidemiology.docx"
PASSWORD = "Demo-Password-1"
REVIEW_TIMEOUT = 90_000


def step(label):
    print(f"PASS  {label}", flush=True)


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("dialog", lambda dialog: dialog.accept())
        # Expected: the wrong-password step returns 400, and some sandboxes block the Google Fonts stylesheet.
        expected = ("fonts.googleapis.com", "fonts.gstatic.com", "/cognito/")
        page.on("console", lambda msg: errors.append(f"{msg.text} ({msg.location.get('url', '')})") if msg.type == "error" and not any(e in msg.location.get("url", "") for e in expected) else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        shot = lambda name: page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

        def sign_in(email):
            page.goto(APP)
            page.get_by_label("Email address").fill(email)
            page.get_by_label("Password").fill(PASSWORD)
            page.get_by_role("button", name="Sign in", exact=True).click()

        def sign_out():
            page.get_by_role("button", name="Sign out").click()
            expect(page.get_by_role("heading", name="Welcome to PHACT")).to_be_visible()

        def wait_ready(kind):
            expect(page.get_by_role("heading", name=f"Your {kind} is ready.")).to_be_visible(timeout=REVIEW_TIMEOUT)

        # ---------------- faculty: sign-in errors, upload, competency review
        page.goto(APP)
        page.get_by_label("Email address").fill("faculty@phact.demo")
        page.get_by_label("Password").fill("wrong-password")
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page.get_by_text("Incorrect email or password.")).to_be_visible()
        step("wrong password shows a clear error")

        sign_in("faculty@phact.demo")
        expect(page.get_by_role("heading", name="Maya.")).to_be_visible()
        step("faculty signs in (name from the ID token)")
        shot("01-dashboard-empty")

        page.get_by_role("button", name="Upload Syllabus").first.click()
        page.locator("input[type=file]").set_input_files(str(SEED))
        page.get_by_label("Course title").fill("EPID 601: Applied Epidemiologic Methods")
        page.get_by_label("Institution").fill("Harbor State University")
        page.get_by_role("button", name="Upload and Run Competency Review").click()
        expect(page.get_by_role("heading", name="Running the competency review")).to_be_visible(timeout=30_000)
        step("upload goes through presign, S3 PUT, create, and starts a competency review")
        page.wait_for_timeout(4000)
        shot("02-progress")
        wait_ready("competency review")
        step("progress page follows the review to COMPLETED")
        page.get_by_role("button", name="Review the suggestions").click()

        expect(page.get_by_text("2 suggestions to review")).to_be_visible()
        expect(page.locator("table tbody tr")).to_have_count(22)
        cards = page.locator(".suggestion-card")
        expect(cards).to_have_count(2)
        expect(cards.nth(0).locator(".diff-insert")).to_contain_text("Community presentation")
        expect(cards.nth(1).locator(".diff-insert")).to_contain_text("Oral defense")
        step("competency review: 22 CEPH rows and 2 suggestions, each with its own inline change")
        page.get_by_role("button", name="CEPH text").first.click()
        expect(page.get_by_text("Retrieved from the CEPH knowledge base")).to_be_visible()
        cards.nth(1).get_by_role("radio", name="Decline").click()
        cards.nth(0).get_by_role("button", name="Edit before accepting").click()
        editor = cards.nth(0).locator("textarea")
        editor.fill("## Community presentation\nStudents brief the county health board on their surveillance findings.")
        expect(cards.nth(0).get_by_role("radio", name="Accept")).to_have_attribute("aria-checked", "true")
        cards.nth(0).get_by_role("button", name="Done editing").click()
        expect(page.locator(".decision-footer")).to_contain_text("1 of 2 accepted · 1 edited")
        shot("03-competency-suggestions")
        page.get_by_role("button", name="Save as version 2").click()
        expect(page.locator(".decision-bar.settled")).to_contain_text("Saved as version 2")
        expect(page.locator(".suggestion-card.accepted")).to_contain_text("Accepted with your edits")
        expect(page.locator(".suggestion-card.declined")).to_contain_text("Declined")
        step("decline one, edit and accept the other, save as version 2")

        # ---------------- AI recommendations: reject all, rerun, accept all
        page.get_by_role("button", name="Continue to AI Recommendations").click()
        page.get_by_role("button", name="Get recommendations for version 2").click()
        wait_ready("AI modernization review")
        page.get_by_role("button", name="Review the suggestions").click()
        expect(page.get_by_role("heading", name="Approved peer syllabi")).to_be_visible()
        expect(page.locator(".source-item").first).to_contain_text("BIOS 622")
        step("AI recommendations cite approved peer syllabi")
        shot("04-recommendations")
        page.get_by_role("button", name="Reject all").click()
        page.get_by_role("button", name="Decline all and close").click()
        expect(page.get_by_text("Your syllabus didn't change.")).to_be_visible()
        step("reject all: no new version")
        page.get_by_role("button", name="Add instructions").click()
        expect(page.get_by_text("PHACT will also skip the 2 suggestions you declined before.")).to_be_visible()
        page.get_by_label("Instructions for this run").fill("Prefer AI-resistant assessments. Leave weeks 1 to 3 alone.")
        shot("04b-run-instructions")
        page.get_by_role("button", name="Run again on version 2").click()
        wait_ready("AI modernization review")
        page.get_by_role("button", name="Review the suggestions").click()
        expect(page.locator(".run-context")).to_contain_text("Prefer AI-resistant assessments")
        expect(page.locator(".run-context")).to_contain_text("not to repeat 2 suggestions")
        step("re-run with instructions; declined suggestions carried forward")
        shot("04c-run-context")
        page.get_by_role("button", name="Accept all").click()
        page.get_by_role("button", name="Save as version 3").click()
        expect(page.locator(".decision-bar.settled")).to_contain_text("Saved as version 3")
        step("rerun, accept all, save as version 3")

        # ---------------- submit
        page.get_by_role("button", name="Continue to Review & Submit").click()
        expect(page.get_by_role("heading", name="EPID 601: Applied Epidemiologic Methods, version 3")).to_be_visible()
        expect(page.locator(".syllabus-document")).to_contain_text("Students brief the county health board")
        step("version 3 carries the faculty member's edited wording")
        page.get_by_role("button", name="Compare with the original upload (version 1)").click()
        expect(page.locator(".diff-insert").first).to_be_visible()
        doc = page.locator(".syllabus-document")
        expect(doc).to_contain_text("[name removed]")
        expect(doc).not_to_contain_text("Maya Chen")
        expect(doc).not_to_contain_text("maya.chen@example.edu")
        expect(doc).to_contain_text("Harbor State University")
        expect(page.locator(".doc-table").first).to_be_visible()
        step("instructor name and email purged at upload; institution kept; tables render as tables")
        page.get_by_role("button", name="Submit version 3 for approval").click()
        expect(page.get_by_text("Version 3 is waiting for administrator approval")).to_be_visible()
        step("submit version 3 for approval")
        shot("05-submitted")
        page.get_by_role("button", name="Home Dashboard", exact=True).click()
        expect(page.locator(".stat").nth(3)).to_contain_text("1")
        shot("06-dashboard")
        step("dashboard shows the pending approval")
        sign_out()

        # ---------------- admin: deny needs notes
        sign_in("admin@phact.demo")
        expect(page.get_by_role("heading", name="Final syllabus approvals")).to_be_visible()
        expect(page.get_by_role("heading", name="EPID 601: Applied Epidemiologic Methods").first).to_be_visible()
        expect(page.get_by_text("faculty@phact.demo").first).to_be_visible()
        step("admin lands on the approval queue with the submission")
        expect(page.locator(".change-summary")).to_contain_text("community presentation", timeout=20_000)
        page.locator(".change-summary summary").click()
        expect(page.locator(".change-summary")).to_contain_text("edited by faculty")
        step("admin sees an AI-written summary and the accepted suggestions")
        shot("06b-admin-summary")
        page.get_by_role("button", name="Deny and request revisions").click()
        page.get_by_role("button", name="Confirm denial").click()
        expect(page.get_by_text("Add notes for the faculty member")).to_be_visible()
        page.get_by_label("Notes to the faculty member (required)").fill("Please add a grading rubric for the oral defense.")
        page.get_by_role("button", name="Confirm denial").click()
        expect(page.get_by_role("button", name="Denied 1")).to_be_visible()
        step("deny requires notes; denied submission moves to the Denied tab")
        page.get_by_role("button", name="Denied 1").click()
        expect(page.get_by_text("Please add a grading rubric")).to_be_visible()
        expect(page.locator(".email-status")).to_contain_text("not sent: No verified SES sender", timeout=20_000)
        step("decision email built by the stream-triggered notifier (no SES sender configured locally)")
        shot("07-admin-denied")
        sign_out()

        # ---------------- faculty: notification, feedback, resubmit
        sign_in("faculty@phact.demo")
        bell = page.get_by_role("button", name="Notifications, 1 unread")
        expect(bell).to_be_visible()
        bell.click()
        page.get_by_role("button", name="EPID 601: Applied Epidemiologic Methods needs revision").click()
        expect(page.get_by_text("Please add a grading rubric for the oral defense.")).to_be_visible()
        step("faculty gets a notification and sees the admin's notes")
        page.get_by_role("navigation", name="Primary navigation").get_by_role("button", name="Competency Review").click()
        expect(page.get_by_text("Please add a grading rubric for the oral defense.")).to_be_visible()
        page.get_by_role("navigation", name="Primary navigation").get_by_role("button", name="Home Dashboard").click()
        expect(page.locator(".decision-reason")).to_contain_text("Please add a grading rubric")
        step("the denial notes also show on other workflow pages and the dashboard")
        page.get_by_role("navigation", name="Primary navigation").get_by_role("button", name="Review & Submit").click()
        shot("08-faculty-feedback")
        page.get_by_role("button", name="Submit version 3 for approval").click()
        expect(page.get_by_text("Version 3 is waiting for administrator approval")).to_be_visible()
        step("resubmit after denial")
        sign_out()

        # ---------------- admin: approve with a note, knowledge page
        sign_in("admin@phact.demo")
        page.get_by_role("button", name="Approve syllabus").click()
        page.get_by_label("Note to the faculty member (optional)").fill("Strong AI-resistant assessment design.")
        page.get_by_role("button", name="Confirm approval").click()
        expect(page.get_by_role("button", name="Approved 1")).to_be_visible()
        step("approve with an optional note")
        page.get_by_role("button", name="Knowledge Management", exact=True).click()
        expect(page.get_by_role("heading", name="Approved syllabi (KB2)")).to_be_visible()
        expect(page.locator(".kb-card").nth(1)).to_contain_text("1")
        expect(page.locator("table tbody tr")).to_have_count(1)
        step("knowledge page: both KBs, KB2 file count, approved list")
        shot("09-knowledge")
        page.get_by_role("button", name="Sync now").first.click()
        expect(page.get_by_text("Sync started")).to_be_visible()
        step("manual sync")
        sign_out()

        # ---------------- faculty: approved state
        sign_in("faculty@phact.demo")
        page.get_by_role("button", name="Review & Submit", exact=True).click()
        expect(page.get_by_text("Version 3 is approved and in the shared library")).to_be_visible()
        expect(page.get_by_text("Strong AI-resistant assessment design.")).to_be_visible()
        step("faculty sees the approval and the admin's note")
        shot("10-faculty-approved")
        page.get_by_role("button", name="Export", exact=True).click()
        with page.expect_download() as download:
            page.get_by_role("button", name="Export DOCX").click()
        assert download.value.suggested_filename.endswith("-v3.docx"), download.value.suggested_filename
        step(f"export downloads {download.value.suggested_filename}")
        with page.expect_download() as download:
            page.get_by_role("button", name="Export PDF").click()
        pdf_path = SHOTS / "export.pdf"
        download.value.save_as(str(pdf_path))
        assert pdf_path.read_bytes()[:5] == b"%PDF-", "not a PDF"
        step(f"PDF export downloads {download.value.suggested_filename} ({pdf_path.stat().st_size // 1024} KB)")
        page.get_by_role("radio", name="4 stars").click()
        page.get_by_label("Comments (optional)").fill("Loved the oral defense idea. Email me at maya.chen@example.edu")
        page.get_by_role("button", name="Send feedback").click()
        expect(page.get_by_text("Thanks for your feedback.")).to_be_visible()
        step("faculty leaves a 4-star rating with a comment")
        shot("12-export-feedback")

        sign_out()
        sign_in("admin@phact.demo")
        page.get_by_role("button", name="Faculty Feedback", exact=True).click()
        expect(page.locator(".stat").first).to_contain_text("1")
        expect(page.locator("table tbody tr").first).to_contain_text("[email removed]")
        step("admin sees the feedback, with the email purged from the comment")
        shot("13-admin-feedback")
        sign_out()
        sign_in("faculty@phact.demo")
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("button", name="Open menu").click()
        page.get_by_role("button", name="Competency Review", exact=True).click()
        expect(page.get_by_role("heading", name="CEPH competency review")).to_be_visible()
        shot("11-mobile-competency")
        step("phone-width layout")
        browser.close()

    real_errors = [e for e in errors if "favicon" not in e.lower() and "status of 400" not in e]
    if real_errors:
        print("Browser console errors:", flush=True)
        for e in real_errors:
            print(f"  {e}")
        sys.exit(1)
    print(f"\nBrowser walkthrough passed. Screenshots in {SHOTS}")


if __name__ == "__main__":
    main()
