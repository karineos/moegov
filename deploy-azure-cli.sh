#!/usr/bin/env bash
set -euo pipefail

# Set these via environment variables before running, e.g.:
#   export APP_NAME="your-app-name"
#   export RESOURCE_GROUP="your-resource-group"
#   export FOUNDRY_PROJECT_ENDPOINT="https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT"
#   export FOUNDRY_AGENT_NAME="your-agent-name"

APP_NAME="${APP_NAME:?Set APP_NAME env var}"
RESOURCE_GROUP="${RESOURCE_GROUP:?Set RESOURCE_GROUP env var}"
LOCATION="${LOCATION:-Sweden Central}"
SKU="${SKU:-B1}"

FOUNDRY_PROJECT_ENDPOINT="${FOUNDRY_PROJECT_ENDPOINT:?Set FOUNDRY_PROJECT_ENDPOINT env var}"
FOUNDRY_AGENT_NAME="${FOUNDRY_AGENT_NAME:?Set FOUNDRY_AGENT_NAME env var}"

az login

az webapp up \
  --sku "$SKU" \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

az webapp identity assign \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP"

echo "Now assign this App Service managed identity the Foundry User role on your Foundry project or Agent Application, then press Enter."
read -r

az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
  FOUNDRY_PROJECT_ENDPOINT="$FOUNDRY_PROJECT_ENDPOINT" \
  FOUNDRY_AGENT_NAME="$FOUNDRY_AGENT_NAME" \
  APP_TITLE="MOE Research Data Assistant" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"

az webapp restart --name "$APP_NAME" --resource-group "$RESOURCE_GROUP"

echo "Deployment complete: https://${APP_NAME}.azurewebsites.net"
