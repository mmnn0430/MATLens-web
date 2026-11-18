#!/usr/bin/env bash
# =============================================================================
# MatLens 2.0 — Google Cloud Run Deployment Script
# =============================================================================
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${GOOGLE_CLOUD_REGION:-asia-northeast3}"
SERVICE_NAME="matlens-v2"
IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

if [ -z "${PROJECT_ID}" ]; then
  echo "Error: GOOGLE_CLOUD_PROJECT environment variable is not set."
  echo "Usage: GOOGLE_CLOUD_PROJECT=your-project-id ./scripts/deploy_gcp.sh"
  exit 1
fi

echo "================================================================="
echo " Deploying MatLens 2.0 to Google Cloud Run"
echo " Project: ${PROJECT_ID} | Region: ${REGION} | Service: ${SERVICE_NAME}"
echo "================================================================="

# 1. Build and push container using Google Cloud Build
echo "Building container image using Cloud Build..."
gcloud builds submit --project "${PROJECT_ID}" --tag "${IMAGE_TAG}" .

# 2. Deploy to Cloud Run with scale-to-zero and cost-efficient constraints
echo "Deploying to Cloud Run with scale-to-zero cost guardrails..."
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE_TAG}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 80 \
  --memory 2Gi \
  --cpu 2 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},VERTEX_AI_MODEL=gemini-3.5-flash,MAX_DAILY_TOKEN_BUDGET=500000"

echo "================================================================="
echo " MatLens 2.0 successfully deployed to Google Cloud Run!"
echo " Service URL: $(gcloud run services describe ${SERVICE_NAME} --project ${PROJECT_ID} --region ${REGION} --format 'value(status.url)')"
echo "================================================================="
