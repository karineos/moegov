# MOE Foundry Agent Web App – Azure App Service

This version is for the case where you already created the MOE agent in Microsoft Foundry and you want your web app to call that existing agent by agent name.

You do **not** need to put Azure AI Search keys in this app if the agent already has Azure AI Search connected as a tool/knowledge source. The web app only needs:

- Microsoft Foundry project endpoint
- Agent name
- App Service Managed Identity with permission to call Foundry

## Required App Service settings

```bash
FOUNDRY_PROJECT_ENDPOINT="https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT"
FOUNDRY_AGENT_NAME="YOUR-AGENT-NAME"
APP_TITLE="MOE Research Data Assistant"
SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

Optional if you want to pin a specific version:

```bash
FOUNDRY_AGENT_VERSION="1"
```

## Local test

```bash
az login
npm install
cp .env.example .env
# Fill FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME
npm start
```

Open:

```text
http://localhost:8080
```

## Deploy with Azure CLI

```bash
az login
az webapp up --sku B1 --name YOUR-UNIQUE-MOE-APP-NAME --location westeurope
```

Enable system-assigned identity:

```bash
az webapp identity assign \
  --name YOUR-UNIQUE-MOE-APP-NAME \
  --resource-group YOUR-RESOURCE-GROUP
```

Then go to Azure Portal and assign the App Service managed identity the right Microsoft Foundry role on your Foundry project or agent application. For runtime calls, Foundry User is usually the recommended least-privilege role.

Set the app settings:

```bash
az webapp config appsettings set \
  --name YOUR-UNIQUE-MOE-APP-NAME \
  --resource-group YOUR-RESOURCE-GROUP \
  --settings \
  FOUNDRY_PROJECT_ENDPOINT="https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT" \
  FOUNDRY_AGENT_NAME="YOUR-AGENT-NAME" \
  APP_TITLE="MOE Research Data Assistant" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

Restart:

```bash
az webapp restart --name YOUR-UNIQUE-MOE-APP-NAME --resource-group YOUR-RESOURCE-GROUP
```

Your public link will be:

```text
https://YOUR-UNIQUE-MOE-APP-NAME.azurewebsites.net
```

## How it works

The backend calls:

```text
POST {FOUNDRY_PROJECT_ENDPOINT}/openai/v1/conversations
POST {FOUNDRY_PROJECT_ENDPOINT}/openai/v1/responses
```

with:

```json
{
  "input": "user question",
  "conversation": "conversation_id",
  "agent_reference": {
    "name": "YOUR-AGENT-NAME",
    "type": "agent_reference"
  }
}
```

If `FOUNDRY_AGENT_VERSION` is set, the app also sends:

```json
"version": "1"
```

## Important

In the new Microsoft Foundry Agent Service, agents are referenced by agent name and optionally version. The older idea of relying on a GUID-style `Agent ID` does not apply to the new API flow.
