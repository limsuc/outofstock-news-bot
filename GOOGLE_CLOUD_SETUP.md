# Google Cloud 배포 가이드

이 문서는 품절 알림 봇을 GitHub Actions 스케줄 대신 Google Cloud Run functions + Cloud Scheduler로 운영하는 방법입니다.

## 구조

```text
Cloud Scheduler
  17:03-17:43 KST, 5분 간격 호출
        ↓
Cloud Run function: run_outofstock_alert
        ↓
Google Drive 품절 PDF + sales-list.xlsx 다운로드
        ↓
Firestore sent_alerts 컬렉션으로 같은 날 중복 발송 방지
        ↓
Telegram 메시지 발송
```

## 1. 준비값

아래 값이 필요합니다.

```text
PROJECT_ID=내 Google Cloud 프로젝트 ID
REGION=asia-northeast3
TELEGRAM_BOT_TOKEN=텔레그램 봇 토큰
TELEGRAM_CHAT_ID=569967356
OUTOFSTOCK_FILE_ID=15dOI-2gYbOLEett8Jfu4OWilAytZdM26
SALES_LIST_FILE_ID=1ZZOH5A3AzDcHEyzoOx43KwSVxeLk5XXE
```

Google Drive 파일 2개는 "링크가 있는 모든 사용자 보기 가능"이어야 합니다.

## 2. 자동 배포 스크립트 사용

Cloud Shell에서 아래 명령을 실행하면 API 활성화, Firestore 생성, 서비스 계정 생성, 함수 배포, Cloud Scheduler 생성, 즉시 테스트 실행까지 한 번에 진행합니다.

```bash
export PROJECT_ID="outofstock-alert"

git clone https://github.com/limsuc/outofstock-news-bot.git
cd outofstock-news-bot

bash scripts/deploy_google_cloud.sh
```

실행 중 `Telegram bot token:` 입력창이 나오면 텔레그램 봇 토큰을 붙여넣고 Enter를 누르세요. 입력한 토큰은 화면에 표시되지 않습니다.

이미 저장소를 clone했다면 아래만 실행하면 됩니다.

```bash
cd outofstock-news-bot
git pull
export PROJECT_ID="outofstock-alert"
bash scripts/deploy_google_cloud.sh
```

## 3. 수동 설정 명령

스크립트 대신 직접 진행하려면 아래 명령을 순서대로 실행합니다.

PowerShell 또는 Cloud Shell에서 실행합니다.

```powershell
gcloud auth login
gcloud config set project PROJECT_ID

gcloud services enable cloudfunctions.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable firestore.googleapis.com
```

Firestore는 Google Cloud Console에서 `Firestore Database`를 열고 Native mode로 데이터베이스를 만듭니다. 위치는 가능하면 `asia-northeast3`를 선택하세요.

## 4. 서비스 계정 만들기

```powershell
$PROJECT_ID = "내 Google Cloud 프로젝트 ID"
$REGION = "asia-northeast3"
$RUNTIME_SA = "outofstock-runtime@$PROJECT_ID.iam.gserviceaccount.com"
$SCHEDULER_SA = "outofstock-scheduler@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create outofstock-runtime --display-name "Out of stock alert runtime"
gcloud iam service-accounts create outofstock-scheduler --display-name "Out of stock alert scheduler"

gcloud projects add-iam-policy-binding $PROJECT_ID --member "serviceAccount:$RUNTIME_SA" --role "roles/datastore.user"
```

## 5. 함수 배포

아래 명령은 현재 폴더를 Cloud Run function으로 배포합니다.

```powershell
$PROJECT_ID = "내 Google Cloud 프로젝트 ID"
$REGION = "asia-northeast3"
$RUNTIME_SA = "outofstock-runtime@$PROJECT_ID.iam.gserviceaccount.com"

gcloud functions deploy outofstock-alert `
  --gen2 `
  --runtime python312 `
  --region $REGION `
  --source . `
  --entry-point run_outofstock_alert `
  --trigger-http `
  --no-allow-unauthenticated `
  --service-account $RUNTIME_SA `
  --set-env-vars TELEGRAM_BOT_TOKEN="텔레그램 봇 토큰",TELEGRAM_CHAT_ID="569967356",OUTOFSTOCK_FILE_ID="15dOI-2gYbOLEett8Jfu4OWilAytZdM26",SALES_LIST_FILE_ID="1ZZOH5A3AzDcHEyzoOx43KwSVxeLk5XXE"
```

함수 URL을 가져옵니다.

```powershell
$FUNCTION_URL = gcloud functions describe outofstock-alert --gen2 --region $REGION --format "value(serviceConfig.uri)"
$FUNCTION_URL
```

## 6. Cloud Scheduler 만들기

Scheduler가 함수를 호출할 수 있도록 권한을 줍니다.

```powershell
$PROJECT_ID = "내 Google Cloud 프로젝트 ID"
$REGION = "asia-northeast3"
$SCHEDULER_SA = "outofstock-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
$FUNCTION_URL = gcloud functions describe outofstock-alert --gen2 --region $REGION --format "value(serviceConfig.uri)"

gcloud run services add-iam-policy-binding outofstock-alert `
  --region $REGION `
  --member "serviceAccount:$SCHEDULER_SA" `
  --role "roles/run.invoker"
```

17:03부터 17:43까지 5분 간격으로 실행되는 job을 만듭니다.

```powershell
gcloud scheduler jobs create http outofstock-alert-17kst `
  --location $REGION `
  --schedule "3-43/5 17 * * *" `
  --time-zone "Asia/Seoul" `
  --uri $FUNCTION_URL `
  --http-method POST `
  --oidc-service-account-email $SCHEDULER_SA `
  --oidc-token-audience $FUNCTION_URL
```

## 7. 수동 테스트

Scheduler를 즉시 한 번 실행합니다.

```powershell
gcloud scheduler jobs run outofstock-alert-17kst --location $REGION
```

같은 결과가 이미 발송되어 다시 테스트 메시지를 받고 싶다면 함수 URL에 `force_send=true`를 붙인 별도 테스트용 Scheduler job을 만들거나, Google Cloud Console에서 Cloud Run function 로그를 확인한 뒤 Firestore의 해당 발송 이력을 삭제하고 다시 실행하세요.

## 8. 로그 확인

```powershell
gcloud functions logs read outofstock-alert --gen2 --region $REGION --limit 50
```

정상 실행이면 로그에 `matches`, `sent`, `sent_matches`, `daily_alert_already_sent` 같은 결과가 남습니다. 품절 매칭 결과가 전날과 같아도 매일 첫 실행에서는 알림을 보내고, 같은 날의 반복 호출만 중복 방지합니다.

## 9. GitHub Actions

GitHub Actions workflow는 이제 수동 테스트용입니다. 자동 실행은 Cloud Scheduler가 담당합니다.
