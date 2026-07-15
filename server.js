import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 8080;

const MCP_LIST_TOOLS_TIMEOUT_MS = Number(process.env.MCP_LIST_TOOLS_TIMEOUT_MS || 90000);
const MCP_CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS || 220000);

const requiredEnv = [
  "FABRIC_TENANT_ID",
  "FABRIC_CLIENT_ID",
  "FABRIC_CLIENT_SECRET",
  "FABRIC_MCP_ENDPOINT"
];

function getMissingEnv() {
  return requiredEnv.filter((key) => !process.env[key]);
}

function isConfigured() {
  return getMissingEnv().length === 0;
}

function logStep(step, startTime) {
  const elapsed = Date.now() - startTime;
  console.log(`[Fabric MCP] ${step} after ${elapsed}ms`);
}

let cachedToken = null;
let cachedTool = null;

async function getFabricToken() {
  if (!isConfigured()) {
    throw new Error(`Missing environment variables: ${getMissingEnv().join(", ")}`);
  }

  if (
    cachedToken &&
    cachedToken.token &&
    cachedToken.expiresOnTimestamp &&
    cachedToken.expiresOnTimestamp > Date.now() + 120000
  ) {
    return cachedToken.token;
  }

  const credential = new ClientSecretCredential(
    process.env.FABRIC_TENANT_ID,
    process.env.FABRIC_CLIENT_ID,
    process.env.FABRIC_CLIENT_SECRET
  );

  const scope =
    process.env.FABRIC_TOKEN_SCOPE || "https://api.fabric.microsoft.com/.default";

  cachedToken = await credential.getToken(scope);
  return cachedToken.token;
}

function pickToolArgument(tool, userQuestion) {
  const schema = tool?.inputSchema || {};
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const keys = Object.keys(properties);

  const possibleNames = [
    "question",
    "query",
    "input",
    "prompt",
    "message",
    "text",
    "userQuestion",
    "user_query"
  ];

  for (const name of possibleNames) {
    if (keys.includes(name)) {
      return { [name]: userQuestion };
    }
  }

  for (const name of required) {
    const field = properties[name];
    if (!field || field.type === "string") {
      return { [name]: userQuestion };
    }
  }

  for (const name of keys) {
    const field = properties[name];
    if (!field || field.type === "string") {
      return { [name]: userQuestion };
    }
  }

  return { question: userQuestion };
}

function extractAnswerText(result) {
  if (!result) return "No response returned from the Fabric Data Agent.";

  if (result.isError) {
    const errorText = extractAnswerText({ content: result.content });
    throw new Error(errorText || "Fabric Data Agent returned an error.");
  }

  if (Array.isArray(result.content)) {
    const textParts = result.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && part?.text) return part.text;
        if (part?.text) return part.text;
        if (part?.content) return JSON.stringify(part.content, null, 2);
        return "";
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
  }

  if (typeof result.structuredContent === "string") {
    return result.structuredContent;
  }

  if (result.structuredContent) {
    return JSON.stringify(result.structuredContent, null, 2);
  }

  return JSON.stringify(result, null, 2);
}

async function getFabricTool(client) {
  if (cachedTool) {
    return cachedTool;
  }

  const toolsResponse = await client.listTools(
    {},
    {
      timeout: MCP_LIST_TOOLS_TIMEOUT_MS
    }
  );

  const tools = toolsResponse?.tools || [];

  if (!tools.length) {
    throw new Error("No tools were returned by the Fabric Data Agent MCP server.");
  }

  cachedTool = tools[0];

  console.log("[Fabric MCP] Using tool:", cachedTool.name);
  return cachedTool;
}

async function callFabricTool(client, tool, args) {
  try {
    return await client.callTool(
      {
        name: tool.name,
        arguments: args
      },
      {
        timeout: MCP_CALL_TIMEOUT_MS
      }
    );
  } catch (error) {
    const message = String(error?.message || error);

    if (message.includes("-32001") || message.toLowerCase().includes("timed out")) {
      throw new Error(
        `Fabric MCP request timed out after ${MCP_CALL_TIMEOUT_MS}ms. The Data Agent/semantic model query is taking too long.`
      );
    }

    throw error;
  }
}

async function askFabricDataAgent(userQuestion) {
  const startedAt = Date.now();

  logStep("starting request", startedAt);

  const token = await getFabricToken();
  logStep("token acquired", startedAt);

  const client = new Client({
    name: "moe-public-web-app",
    version: "1.0.0"
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.FABRIC_MCP_ENDPOINT),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    }
  );

  try {
    await client.connect(transport);
    logStep("connected to MCP server", startedAt);

    const tool = await getFabricTool(client);
    logStep("tool ready", startedAt);

    const args = pickToolArgument(tool, userQuestion);
    console.log("[Fabric MCP] Tool args:", args);

    const result = await callFabricTool(client, tool, args);
    logStep("tool call completed", startedAt);

    return {
      answer: extractAnswerText(result),
      toolName: tool.name
    };
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close error
    }
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    missing: getMissingEnv(),
    provider: "Microsoft Fabric Data Agent",
    endpointConfigured: Boolean(process.env.FABRIC_MCP_ENDPOINT)
  });
});

app.get("/api/debug-config", (req, res) => {
  res.json({
    provider: "Microsoft Fabric Data Agent",
    configured: isConfigured(),
    missing: getMissingEnv(),
    hasTenantId: Boolean(process.env.FABRIC_TENANT_ID),
    hasClientId: Boolean(process.env.FABRIC_CLIENT_ID),
    hasClientSecret: Boolean(process.env.FABRIC_CLIENT_SECRET),
    endpoint: process.env.FABRIC_MCP_ENDPOINT,
    tokenScope: process.env.FABRIC_TOKEN_SCOPE || "https://api.fabric.microsoft.com/.default",
    listToolsTimeoutMs: MCP_LIST_TOOLS_TIMEOUT_MS,
    callTimeoutMs: MCP_CALL_TIMEOUT_MS
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body?.message || req.body?.input || req.body?.question;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Missing message."
      });
    }

    const result = await askFabricDataAgent(message);

    res.json({
      answer: result.answer,
      sources: [],
      provider: "Microsoft Fabric Data Agent",
      tool: result.toolName
    });
  } catch (error) {
    console.error("Fabric Data Agent error:", error);

    const message = String(error?.message || "");

    const status =
      message.toLowerCase().includes("timed out") ||
      message.includes("-32001")
        ? 504
        : 500;

    res.status(status).json({
      error: "The Fabric Data Agent request failed.",
      details: message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MOE Fabric Data Agent app running on port ${PORT}`);
  console.log(`MCP list tools timeout: ${MCP_LIST_TOOLS_TIMEOUT_MS}ms`);
  console.log(`MCP call timeout: ${MCP_CALL_TIMEOUT_MS}ms`);
});