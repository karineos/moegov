#!/usr/bin/env bash
set -euo pipefail

APP_NAME="YOUR-UNIQUE-MOE-APP-NAME"
RESOURCE_GROUP="moe-research-agent-rg"
LOCATION="westeurope"
SKU="B1"

FOUNDRY_PROJECT_ENDPOINT="https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT"
FOUNDRY_AGENT_NAME="YOUR-AGENT-NAME"

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
