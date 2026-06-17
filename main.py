from __future__ import annotations

import json
import os
import tempfile
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from google.cloud import firestore

import outofstock_alert as alert


KST = ZoneInfo("Asia/Seoul")
TMP_DIR = Path(tempfile.gettempdir()) / "outofstock-alert"
PDF_PATH = TMP_DIR / "outofstock-latest.pdf"
SALES_PATH = TMP_DIR / "sales-list.xlsx"
FIRESTORE_COLLECTION = os.getenv("FIRESTORE_COLLECTION", "sent_alerts")


def _json_response(payload: dict[str, Any], status: int = 200) -> tuple[str, int, dict[str, str]]:
    return (
        json.dumps(payload, ensure_ascii=False, default=str),
        status,
        {"Content-Type": "application/json; charset=utf-8"},
    )


def _load_cloud_env() -> dict[str, str]:
    return {**os.environ, **alert.load_env()}


def _download_sales_path(env: dict[str, str]) -> Path:
    sales_url = env.get("SALES_LIST_URL", "").strip()
    sales_file_id = env.get("SALES_LIST_FILE_ID", "").strip()

    if sales_url:
        path = alert.download_url(sales_url, SALES_PATH)
        if path.read_bytes()[:4].startswith(b"PK"):
            return path
        raise RuntimeError("Downloaded SALES_LIST_URL is not an xlsx file.")

    if sales_file_id:
        errors: list[str] = []
        for url in (
            alert.google_drive_download_url(sales_file_id),
            alert.google_sheets_export_url(sales_file_id),
        ):
            path = alert.download_url(url, SALES_PATH)
            if path.read_bytes()[:4].startswith(b"PK"):
                return path
            preview = path.read_bytes()[:120].decode("utf-8", errors="replace")
            errors.append(f"{url} -> {preview!r}")
        raise RuntimeError(
            "SALES_LIST_FILE_ID did not return an xlsx file. "
            "Check the Google Drive sharing setting. "
            f"Attempts: {' / '.join(errors)}"
        )

    if alert.SALES_PATH.exists():
        return alert.SALES_PATH

    raise RuntimeError("Set SALES_LIST_FILE_ID or SALES_LIST_URL.")


def _load_matches(env: dict[str, str]) -> tuple[list[alert.Match], dict[str, Any]]:
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    pdf_url = alert.resolve_outofstock_url(env)
    pdf_path = alert.download_drive_pdf(pdf_url, PDF_PATH)
    sales_path = _download_sales_path(env)

    all_pdf_lines = alert.extract_pdf_lines(pdf_path)
    stockout_items = alert.stockout_candidate_lines(pdf_path)
    sales_items = alert.load_sales_items(sales_path)
    matches = alert.find_matches(sales_items, stockout_items)

    diagnostics = {
        "pdf_path": str(pdf_path),
        "sales_path": str(sales_path),
        "pdf_lines": len(all_pdf_lines),
        "stockout_candidate_lines": len(stockout_items),
        "sales_items": len(sales_items),
        "matches": len(matches),
    }
    return matches, diagnostics


def _doc_ref(db: firestore.Client, hash_value: str) -> firestore.DocumentReference:
    return db.collection(FIRESTORE_COLLECTION).document(hash_value)


def _has_sent_hash(db: firestore.Client, hash_value: str) -> bool:
    return _doc_ref(db, hash_value).get().exists


def _unsent_matches(db: firestore.Client, matches: list[alert.Match]) -> list[alert.Match]:
    return [match for match in matches if not _has_sent_hash(db, alert.alert_hash(match))]


def _mark_matches_sent(db: firestore.Client, matches: list[alert.Match]) -> None:
    now = datetime.now(KST).isoformat(timespec="seconds")
    batch = db.batch()
    for match in matches:
        batch.set(
            _doc_ref(db, alert.alert_hash(match)),
            {
                "sent_at": now,
                "product": match.product,
                "clients": list(match.clients),
                "matched_line": match.matched_line,
                "expected_date": match.expected_date,
                "match_type": match.match_type,
            },
            merge=True,
        )
    batch.commit()


def _mark_no_match_sent(db: firestore.Client, day: str) -> None:
    _doc_ref(db, alert.no_match_alert_hash(day)).set(
        {
            "sent_at": datetime.now(KST).isoformat(timespec="seconds"),
            "product": "__NO_MATCH__",
            "clients": [],
            "matched_line": day,
            "expected_date": "",
            "match_type": "no-match",
        },
        merge=True,
    )


def run_cloud_alert(force_send: bool = False) -> dict[str, Any]:
    env = _load_cloud_env()
    token = env.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = env.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise RuntimeError("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.")

    matches, diagnostics = _load_matches(env)
    print(json.dumps(diagnostics, ensure_ascii=False))
    print(alert.format_summary(matches, limit=10))

    db = firestore.Client()
    today = datetime.now(KST).strftime("%Y-%m-%d")

    if not matches:
        no_match_hash = alert.no_match_alert_hash(today)
        if not force_send and _has_sent_hash(db, no_match_hash):
            result = {
                **diagnostics,
                "sent": False,
                "reason": "no_match_alert_already_sent_today",
            }
            print(json.dumps(result, ensure_ascii=False))
            return result

        alert.send_telegram_message(token, chat_id, alert.format_summary(matches))
        _mark_no_match_sent(db, today)
        result = {
            **diagnostics,
            "sent": True,
            "sent_matches": 0,
            "force_send": force_send,
        }
        print(json.dumps(result, ensure_ascii=False))
        return result

    target_matches = matches if force_send else _unsent_matches(db, matches)
    if not target_matches:
        result = {**diagnostics, "sent": False, "reason": "new_matches=0"}
        print(json.dumps(result, ensure_ascii=False))
        return result

    for message in alert.split_message(alert.format_summary(target_matches)):
        alert.send_telegram_message(token, chat_id, message)
    _mark_matches_sent(db, target_matches)

    result = {
        **diagnostics,
        "sent": True,
        "sent_matches": len(target_matches),
        "force_send": force_send,
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


def run_outofstock_alert(request: Any) -> tuple[str, int, dict[str, str]]:
    if request.method == "GET":
        return _json_response({"ok": True, "service": "outofstock-alert"})

    force_send = False
    if request.args.get("force_send", "").lower() == "true":
        force_send = True
    else:
        body = request.get_json(silent=True) or {}
        force_send = bool(body.get("force_send"))

    try:
        return _json_response(run_cloud_alert(force_send=force_send))
    except Exception as exc:
        traceback.print_exc()
        return _json_response({"ok": False, "error": str(exc)}, status=500)
