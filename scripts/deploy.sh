#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=nutria-9c71e
REGION=europe-west1
SERVICE=ritnave-frontend
SA="$SERVICE@$PROJECT.iam.gserviceaccount.com"
GCLOUD=${GCLOUD:-gcloud}
SESSION_SECRET_NAME=${SESSION_SECRET_NAME:-ritnave-web-session-secret}
FIREBASE_KEY_SECRET_NAME=${FIREBASE_KEY_SECRET_NAME:-ritnave-web-firebase-api-key}
if [[ "${1:-}" != --apply ]]; then
  printf '%s
' 'PLAN ONLY: build/deploy public ritnave-frontend (CPU 1, 512Mi, min0/max2), dedicated runtime SA, access only to its two secrets and run.invoker on ritnave-api. No GPU/queue/database/default Firebase config changes. Requires a dedicated Firebase tenant, preconfigured secrets and the updated backend API deployed separately. Use --apply explicitly.'
  exit 0
fi
: "${FIREBASE_AUTH_TENANT_ID:?Configure the dedicated ritnave Firebase tenant}"
: "${FIREBASE_AUTH_PROJECT_ID:?Configure Firebase project}"
[[ "$FIREBASE_AUTH_PROJECT_ID" == "$PROJECT" ]] || { printf '%s
' 'Unexpected Firebase project; review the deployment target.' >&2; exit 2; }
[[ "$FIREBASE_AUTH_TENANT_ID" =~ ^[A-Za-z0-9_-]+$ && "$FIREBASE_AUTH_TENANT_ID" != default ]] || exit 2
command -v "$GCLOUD" >/dev/null
for secret in "$SESSION_SECRET_NAME" "$FIREBASE_KEY_SECRET_NAME"; do "$GCLOUD" secrets describe "$secret" --project="$PROJECT" >/dev/null; done
if details=$("$GCLOUD" iam service-accounts describe "$SA" --project="$PROJECT" 2>&1); then :
elif [[ "$details" == *NOT_FOUND* || "$details" == *"not found"* ]]; then "$GCLOUD" iam service-accounts create "$SERVICE" --project="$PROJECT" --display-name='ritnave frontend'
else printf '%s\n' "$details" >&2; exit 1; fi
for secret in "$SESSION_SECRET_NAME" "$FIREBASE_KEY_SECRET_NAME"; do "$GCLOUD" secrets add-iam-policy-binding "$secret" --project="$PROJECT" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null; done
"$GCLOUD" run services add-iam-policy-binding ritnave-api --project="$PROJECT" --region="$REGION" --member="serviceAccount:$SA" --role=roles/run.invoker >/dev/null
NUMBER=$("$GCLOUD" projects describe "$PROJECT" --format='value(projectNumber)')
ORIGIN=${APP_ORIGIN:-https://$SERVICE-$NUMBER.$REGION.run.app}
API_URL=$("$GCLOUD" run services describe ritnave-api --project="$PROJECT" --region="$REGION" --format='value(status.url)')
TAG=$(git rev-parse --short=12 HEAD)
IMAGE="$REGION-docker.pkg.dev/$PROJECT/ritnave/frontend:$TAG"
"$GCLOUD" builds submit . --project="$PROJECT" --region="$REGION" --config=infra/cloudbuild.yaml --service-account="projects/$PROJECT/serviceAccounts/ritnave-build@$PROJECT.iam.gserviceaccount.com" --gcs-source-staging-dir="gs://ritnave-nutria-9c71e-build-source/source" --substitutions="_IMAGE=$IMAGE"
"$GCLOUD" run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" --image="$IMAGE" --service-account="$SA" --allow-unauthenticated --cpu=1 --memory=512Mi --concurrency=20 --min=0 --max=2 --min-instances=0 --max-instances=2 --timeout=300 --port=8080 --startup-probe='httpGet.path=/api/health,httpGet.port=8080,periodSeconds=5,failureThreshold=24,timeoutSeconds=2' --set-env-vars="APP_ORIGIN=$ORIGIN,RITNAVE_API_URL=$API_URL,FIREBASE_AUTH_PROJECT_ID=$FIREBASE_AUTH_PROJECT_ID,FIREBASE_AUTH_TENANT_ID=$FIREBASE_AUTH_TENANT_ID" --set-secrets="SESSION_SECRET=$SESSION_SECRET_NAME:latest,FIREBASE_WEB_API_KEY=$FIREBASE_KEY_SECRET_NAME:latest" --quiet
printf 'Frontend public origin (use exactly): %s
Private processing API remains private: %s
Run the Firebase/browser end-to-end smoke after deploying.
' "$ORIGIN" "$API_URL"
