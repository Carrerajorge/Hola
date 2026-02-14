from __future__ import annotations


def test_metrics_endpoint(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    assert "text/plain" in r.headers.get("content-type", "")
    body = r.text
    assert "ocr_requests_total" in body
    assert "ocr_engine_duration_seconds" in body

