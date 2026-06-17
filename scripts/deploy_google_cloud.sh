#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-outofstock-alert}"
REGION="${REGION:-asia-northeast3}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-asia-northeast3}"
FUNCTION_NAME="${FUNCTION_NAME:-outofstock-alert}"
SCHEDULER_JOB="${SCHEDULER_JOB:-outofstock-alert-17kst}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-outofstock-runtime}"
SCHEDULER_SA_NAME="${SCHEDULER_SA_NAME:-outofstock-scheduler}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-569967356}"
OUTOFSTOCK_FILE_ID="${OUTOFSTOCK_FILE_ID:-15dOI-2gYbOLEett8Jfu4OWilAytZdM26}"
SALES_LIST_FILE_ID="${SALES_LIST_FILE_ID:-1ZZOH5A3AzDcHEyzoOx43KwSVxeLk5XXE}"
SCHEDULE="${SCHEDULE:-3-43/5 17 * * *}"
TIME_ZONE="${TIME_ZONE:-Asia/Seoul}"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  read -r -s -p "Telegram bot token: " TELEGRAM_BOT_TOKEN
  echo
fi

if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
  echo "TELEGRAM_BOT_TOKEN is required." >&2
  exit 1
fi

RUNTIME_SA="$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
SCHEDULER_SA="$SCHEDULER_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Scheduler: $SCHEDULE ($TIME_ZONE)"

gcloud config set project "$PROJECT_ID"

echo "Enabling required APIs..."
gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com

echo "Ensuring Firestore database exists..."
if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="$FIRESTORE_LOCATION"
fi

echo "Ensuring service accounts exist..."
if ! gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
    --display-name "Out of stock alert runtime"
fi

if ! gcloud iam service-accounts describe "$SCHEDULER_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SCHEDULER_SA_NAME" \
    --display-name "Out of stock alert scheduler"
fi

echo "Granting Firestore access to runtime service account..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$RUNTIME_SA" \
  --role "roles/datastore.user" \
  --condition=None >/dev/null

echo "Deploying Cloud Run function..."
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime python312 \
  --region "$REGION" \
  --source . \
  --entry-point run_outofstock_alert \
  --trigger-http \
  --no-allow-unauthenticated \
  --service-account "$RUNTIME_SA" \
  --set-env-vars "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN,TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID,OUTOFSTOCK_FILE_ID=$OUTOFSTOCK_FILE_ID,SALES_LIST_FILE_ID=$SALES_LIST_FILE_ID"

FUNCTION_URL="$(gcloud functions describe "$FUNCTION_NAME" \
  --gen2 \
  --region "$REGION" \
  --format "value(serviceConfig.uri)")"

echo "Function URL: $FUNCTION_URL"

echo "Granting Scheduler permission to invoke function..."
gcloud run services add-iam-policy-binding "$FUNCTION_NAME" \
  --region "$REGION" \
  --member "serviceAccount:$SCHEDULER_SA" \
  --role "roles/run.invoker" \
  --condition=None >/dev/null

echo "Creating or updating Cloud Scheduler job..."
if gcloud scheduler jobs describe "$SCHEDULER_JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHEDULER_JOB" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TIME_ZONE" \
    --uri "$FUNCTION_URL" \
    --http-method POST \
    --oidc-service-account-email "$SCHEDULER_SA" \
    --oidc-token-audience "$FUNCTION_URL"
else
  gcloud scheduler jobs create http "$SCHEDULER_JOB" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TIME_ZONE" \
    --uri "$FUNCTION_URL" \
    --http-method POST \
    --oidc-service-account-email "$SCHEDULER_SA" \
    --oidc-token-audience "$FUNCTION_URL"
fi

echo "Running Scheduler job once now..."
gcloud scheduler jobs run "$SCHEDULER_JOB" --location "$REGION"

echo
echo "Done. Check Telegram and recent logs:"
echo "gcloud functions logs read $FUNCTION_NAME --gen2 --region $REGION --limit 50"
