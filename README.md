# 품절 알림 봇

Google Drive에 매일 갱신되는 품절 PDF를 내려받아 `sales-list.xlsx`의 거래처별 품목과 비교한 뒤, 매칭되는 품절 품목을 텔레그램으로 알립니다.

## 준비

로컬 실행용 `.env`:

```env
TELEGRAM_BOT_TOKEN=봇토큰
TELEGRAM_CHAT_ID=569967356
```

`sales-list.xlsx`에는 아래 컬럼이 필요합니다.

- `거래처명`
- `지역`
- `품목`
- `제약사`

## 로컬 실행

```powershell
pip install -r requirements.txt
python outofstock_alert.py --dry-run
python outofstock_alert.py --send-test
python outofstock_alert.py --send
```

매칭되는 품절 품목이 없는 날에는 `--send` 실행 시 "현재 거래처 품목과 매칭된 품절 품목이 없습니다." 메시지를 하루 한 번만 발송합니다.

## GitHub Actions 실행

`.github/workflows/outofstock-alert.yml`은 매일 17:13 KST에 실행됩니다.

GitHub 저장소의 `Settings > Secrets and variables > Actions`에 아래 값을 추가하세요.

- Repository secrets: `TELEGRAM_BOT_TOKEN` 텔레그램 봇 토큰
- Repository secrets 또는 Repository variables: `TELEGRAM_CHAT_ID` 텔레그램 chat id. 현재 운영 기본값은 `569967356`입니다.
- Repository secrets 또는 Repository variables: `OUTOFSTOCK_FILE_ID` 매일 갱신되는 품절 PDF의 Google Drive 파일 ID
- Repository secrets 또는 Repository variables: `SALES_LIST_FILE_ID` Google Drive에 올린 `sales-list.xlsx`의 파일 ID. 현재 운영 기본값은 `1ZZOH5A3AzDcHEyzoOx43KwSVxeLk5XXE`입니다.

`sales-list.xlsx` 파일은 Google Drive에서 "링크가 있는 모든 사용자 보기 가능"으로 설정해야 GitHub Actions가 다운로드할 수 있습니다.

다른 사람이 Codex에서 같은 봇을 세팅하게 하려면 [CODEX_QUICKSTART.md](CODEX_QUICKSTART.md)를 공유하세요.

수동 테스트는 GitHub 저장소의 `Actions > Out-of-stock alert > Run workflow`에서 실행할 수 있습니다.

## 중복 발송

같은 품목/거래처/PDF 항목 조합은 `data/alerts.sqlite3`에 기록되어 중복 발송되지 않습니다. GitHub Actions에서는 이 DB를 Actions cache로 복원/저장합니다.
