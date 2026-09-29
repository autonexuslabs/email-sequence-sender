# Deploying on Google Cloud Run Jobs + Cloud Scheduler

Each stage is a short Cloud Run **job** execution that a Cloud Scheduler trigger starts. Nothing runs between triggers, so a small campaign stays inside the free tier.

Before deploying, replace `src/store.js` with a Firestore- or Redis-backed store (same four functions). A container's filesystem does not survive between executions.

```bash
PROJECT=my-project
REGION=us-central1
IMAGE=$REGION-docker.pkg.dev/$PROJECT/jobs/email-sender

gcloud builds submit --tag $IMAGE -f deploy/Dockerfile .

# One job per stage. SMTP credentials come from Secret Manager.
gcloud run jobs create sender-deliver --image $IMAGE --region $REGION \
  --args=deliver,--max,5 \
  --set-env-vars SEND_MODE=smtp,SMTP_HOST=smtp.example.com,SMTP_PORT=587 \
  --set-secrets SMTP_USER=smtp-user:latest,SMTP_PASS=smtp-pass:latest

# Every 20 minutes, 8am-4pm Chicago, weekdays. The code re-checks each lead's
# own time zone, so this window only has to cover the earliest and latest.
gcloud scheduler jobs create http sender-deliver-trigger --location $REGION \
  --schedule "*/20 8-15 * * 1-5" --time-zone "America/Chicago" \
  --uri "https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/sender-deliver:run" \
  --http-method POST --oauth-service-account-email scheduler@$PROJECT.iam.gserviceaccount.com
```

Repeat for `inbox` (every 5 minutes, all day) and `report` (once a day, piped to Telegram or email).
