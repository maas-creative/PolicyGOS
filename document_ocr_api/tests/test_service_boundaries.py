from pathlib import Path
import sys

from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from api_models import RepairResponse, RepairRow
from services import analysis_service, source_service


class FakeResponse:
    def __init__(self, *, text="", content=b"", headers=None, status_code=200):
        self.text = text
        self.content = content or text.encode("utf-8")
        self.headers = headers or {}
        self.status_code = status_code
        self.encoding = "utf-8"
        self.apparent_encoding = "utf-8"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"status {self.status_code}")


client = TestClient(main.app)


def test_discover_source_follows_child_pages_and_dedupes(monkeypatch):
    monkeypatch.setattr(source_service, "validate_public_url", lambda url: None)
    responses = {
        "https://example.com/listing/index.html": FakeResponse(
            text="""
                <html>
                  <a href="detail-a.html">A</a>
                  <a href="detail-b.html">B</a>
                </html>
            """
        ),
        "https://example.com/listing/detail-a.html": FakeResponse(
            text="""
                <html>
                  <a href="/pdfs/report.pdf">Report</a>
                </html>
            """
        ),
        "https://example.com/listing/detail-b.html": FakeResponse(
            text="""
                <html>
                  <a href="/pdfs/report.pdf">Report Duplicate</a>
                  <a href="/pdfs/annex.pdf">Annex</a>
                </html>
            """
        ),
    }

    monkeypatch.setattr(
        source_service.requests, "get", lambda url, timeout, **kwargs: responses[url]
    )

    discovered = source_service.discover_source(
        "https://example.com/listing/index.html",
        "listing-page",
    )

    assert discovered.source_url == "https://example.com/listing/index.html"
    assert discovered.strategy == "listing-page"
    assert [candidate.url for candidate in discovered.candidates] == [
        "https://example.com/pdfs/report.pdf",
        "https://example.com/pdfs/annex.pdf",
    ]
    assert [candidate.file_name for candidate in discovered.candidates] == [
        "report.pdf",
        "annex.pdf",
    ]


def test_discover_source_raises_502_when_listing_fetch_fails(monkeypatch):
    monkeypatch.setattr(source_service, "validate_public_url", lambda url: None)

    def fail_get(url, timeout, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(source_service.requests, "get", fail_get)

    try:
        source_service.discover_source(
            "https://example.com/listing/index.html", "listing-page"
        )
    except HTTPException as error:
        assert error.status_code == 502
        assert error.detail == "Failed to fetch source page: boom"
    else:
        raise AssertionError("Expected HTTPException")


def test_fetch_source_pdf_returns_filename_content_and_media_type(monkeypatch):
    monkeypatch.setattr(source_service, "validate_public_url", lambda url: None)
    monkeypatch.setattr(
        source_service.requests,
        "get",
        lambda url, timeout, **kwargs: FakeResponse(
            content=b"%PDF-1.7 sample",
            headers={"Content-Type": "application/pdf"},
        ),
    )

    fetched = source_service.fetch_source_pdf("https://example.com/files/sample.pdf")

    assert fetched.file_name == "sample.pdf"
    assert fetched.media_type == "application/pdf"
    assert fetched.content.startswith(b"%PDF-1.7")


def test_source_fetch_rejects_private_network(monkeypatch):
    monkeypatch.setenv("SOURCE_FETCH_ALLOWED_HOSTS", "localhost")
    monkeypatch.setattr(
        source_service.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (source_service.socket.AF_INET, source_service.socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))
        ],
    )

    try:
        source_service.validate_public_url("http://localhost/internal.pdf")
    except HTTPException as error:
        assert error.status_code == 400
        assert "Private" in error.detail
    else:
        raise AssertionError("Expected private network URL to be rejected")


def test_repair_endpoint_preserves_response_shape(monkeypatch):
    monkeypatch.setattr(
        main,
        "run_opencode_repair",
        lambda request: RepairResponse(
            success=True,
            provider="repair-runner",
            model="gemini-test",
            normalized_rows=[
                RepairRow(
                    source_reference="page-1-row-1",
                    project_name="Project A",
                    project_summary="Summary",
                    confidence=0.9,
                    review_flags=[],
                )
            ],
            notes=["kept contract"],
            raw_response="{}",
            error=None,
        ),
    )

    response = client.post(
        "/repair/opencode",
        json={
            "document_id": "doc-1",
            "document_name": "doc.pdf",
            "normalized_rows": [
                {
                    "source_reference": "page-1-row-1",
                    "project_name": "Project A",
                    "project_summary": "Summary",
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "provider": "repair-runner",
        "model": "gemini-test",
        "normalized_rows": [
            {
                "source_reference": "page-1-row-1",
                "section_path": [],
                "municipality": None,
                "project_number": None,
                "project_name": "Project A",
                "project_summary": "Summary",
                "department": None,
                "budget": None,
                "fiscal_year": None,
                "status": None,
                "activity_indicator_name": None,
                "activity_indicator_unit": None,
                "activity_planned_value": None,
                "activity_actual_value": None,
                "outcome_indicator_name": None,
                "outcome_indicator_unit": None,
                "outcome_target_value": None,
                "outcome_actual_value": None,
                "achievement": None,
                "confidence": 0.9,
                "review_flags": [],
            }
        ],
        "notes": ["kept contract"],
        "raw_response": "{}",
        "error": None,
    }


def test_async_analyze_and_jobs_routes_keep_existing_contract(monkeypatch):
    main.job_service.jobs.clear()

    async def fake_save_upload_file_tmp(upload_file):
        return "/tmp/fake.pdf", upload_file.filename

    def fake_analyze_document(
        file_path, original_filename, output_format, progress_callback=None
    ):
        assert file_path == "/tmp/fake.pdf"
        assert original_filename == "sample.pdf"
        assert output_format == "markdown"
        if progress_callback:
            progress_callback(65, "途中経過", 2)
        return {"formatted": "# extracted", "pages": 2}

    monkeypatch.setattr(
        analysis_service, "save_upload_file_tmp", fake_save_upload_file_tmp
    )
    monkeypatch.setattr(analysis_service, "analyze_document", fake_analyze_document)

    response = client.post(
        "/analyze/async?output_format=markdown",
        files={"file": ("sample.pdf", b"%PDF-1.7", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["job_id"]
    assert payload["message"] == (
        f"ジョブ {payload['job_id']} を送信しました。GET /jobs/{payload['job_id']} でステータスを確認してください。"
    )

    status_response = client.get(f"/jobs/{payload['job_id']}")

    assert status_response.status_code == 200
    assert status_response.json() == {
        "job_id": payload["job_id"],
        "status": "completed",
        "progress": 100,
        "message": "処理完了",
        "created_at": status_response.json()["created_at"],
        "started_at": status_response.json()["started_at"],
        "completed_at": status_response.json()["completed_at"],
        "result": "# extracted",
        "error": None,
        "pages": 2,
    }
