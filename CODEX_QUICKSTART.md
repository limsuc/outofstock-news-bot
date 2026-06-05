# Codex로 내 품절 알림 봇 만들기

이 문서는 다른 사용자가 이 저장소를 fork한 뒤 Codex에서 그대로 세팅할 수 있도록 만든 안내서입니다.

## 1. 준비물

아래 4가지를 먼저 준비하세요.

- Telegram 봇 토큰
- 내 Telegram `chat_id`
- 매일 갱신되는 품절 PDF의 Google Drive 파일 ID
- 내 거래처/품목 리스트 `sales-list.xlsx`의 Google Drive 파일 ID

두 Google Drive 파일은 모두 "링크가 있는 모든 사용자 보기 가능"으로 공유해야 GitHub Actions가 다운로드할 수 있습니다.

## 2. sales-list.xlsx 형식

첫 번째 행에 아래 컬럼명이 있어야 합니다.

```text
거래처명
지역
품목
제약사
```

다른 컬럼이 더 있어도 괜찮지만, 위 4개 컬럼명은 그대로 있어야 합니다.

## 3. Google Drive 파일 ID 찾기

Google Drive 링크가 아래처럼 생겼다면:

```text
https://docs.google.com/spreadsheets/d/1ZZOH5A3AzDcHEyzoOx43KwSVxeLk5XXE/edit?usp=sharing
```

파일 ID는 이 부분입니다.

```text
1ZZOH5A3AzDcHEyzoOx43KwSVxeLk5XXE
```

Drive 파일 링크가 아래처럼 생겨도 같은 방식입니다.

```text
https://drive.google.com/file/d/15dOI-2gYbOLEett8Jfu4OWilAytZdM26/view?usp=sharing
```

파일 ID:

```text
15dOI-2gYbOLEett8Jfu4OWilAytZdM26
```

## 4. GitHub Secrets

fork한 저장소에서 아래 메뉴로 이동하세요.

```text
Settings > Secrets and variables > Actions > Repository secrets
```

아래 값을 추가합니다.

```text
TELEGRAM_BOT_TOKEN=내 텔레그램 봇 토큰
TELEGRAM_CHAT_ID=내 텔레그램 chat_id
OUTOFSTOCK_FILE_ID=품절 PDF Google Drive 파일 ID
SALES_LIST_FILE_ID=sales-list.xlsx Google Drive 파일 ID
```

## 5. Codex에 붙여넣을 프롬프트

아래 문장을 Codex에 그대로 붙여넣으면 됩니다.

```text
이 저장소는 품절 알림 봇입니다. CODEX_QUICKSTART.md와 README.md를 읽고, 내 GitHub Actions 설정이 제대로 되었는지 확인해줘.

내가 준비한 값:
- TELEGRAM_BOT_TOKEN: GitHub Secrets에 넣어뒀음
- TELEGRAM_CHAT_ID: GitHub Secrets에 넣어뒀음
- OUTOFSTOCK_FILE_ID: GitHub Secrets에 넣어뒀음
- SALES_LIST_FILE_ID: GitHub Secrets에 넣어뒀음

해줘야 할 일:
1. outofstock_alert.py 문법 검사를 해줘.
2. GitHub Actions workflow가 매일 17:00 KST에 실행되도록 되어 있는지 확인해줘.
3. Actions에서 수동 실행할 수 있게 되어 있는지 확인해줘.
4. 가능하면 workflow를 실행하거나, 내가 실행할 수 있는 정확한 위치를 알려줘.
5. 문제가 있으면 고쳐서 커밋/푸시해줘.
```

## 6. 수동 테스트

GitHub 저장소에서 아래 위치로 이동합니다.

```text
Actions > Out-of-stock alert > Run workflow
```

실행 후 텔레그램으로 아래 둘 중 하나가 오면 성공입니다.

- 매칭된 품절 품목 알림
- `현재 거래처 품목과 매칭된 품절 품목이 없습니다.`

## 7. 실행 시간 바꾸기

기본 실행 시간은 매일 17:00 KST입니다.

`.github/workflows/outofstock-alert.yml`의 cron 값을 바꾸면 됩니다.

```yaml
# 17:00 KST = 08:00 UTC
- cron: "0 8 * * *"
```

예를 들어 매일 09:00 KST는 00:00 UTC입니다.

```yaml
- cron: "0 0 * * *"
```

## 8. 자주 나는 문제

`PDF가 아닌 응답을 받았습니다.`

- 품절 PDF의 공유 권한이 막혀 있을 가능성이 큽니다.
- Google Drive에서 "링크가 있는 모든 사용자 보기 가능"으로 바꿔주세요.

`sales-list.xlsx를 다운로드했지만 엑셀 파일이 아닙니다.`

- `SALES_LIST_FILE_ID`가 잘못됐거나 공유 권한이 막혀 있을 수 있습니다.
- Google Sheets 링크도 지원하지만, 파일 ID만 넣어야 합니다.

텔레그램 메시지가 오지 않음

- 봇과 먼저 `/start` 대화를 해야 합니다.
- `TELEGRAM_CHAT_ID`가 본인의 chat id인지 확인하세요.
