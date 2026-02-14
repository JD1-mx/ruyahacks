const N8N_API_URL = process.env.N8N_API_URL || "";
const N8N_API_KEY = process.env.N8N_API_KEY || "";

async function n8nRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" = "POST",
  body?: unknown
) {
  const res = await fetch(`${N8N_API_URL}${path}`, {
    method,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`n8n ${method} ${path} failed (${res.status}): ${err}`);
  }

  return res.json();
}

// --- Types ---

export interface N8nWorkflow {
  id?: string;
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
  active?: boolean;
  settings?: Record<string, unknown>;
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}

// --- Read existing workflows (so the AI can learn from them) ---

export async function listWorkflows(): Promise<{ id: string; name: string; active: boolean; nodes: string[] }[]> {
  const result = (await n8nRequest("/workflows", "GET")) as { data: N8nWorkflow[] };
  return (result.data || []).map((w) => ({
    id: w.id!,
    name: w.name,
    active: w.active || false,
    nodes: w.nodes.map((n) => `${n.name} (${n.type})`),
  }));
}

export async function getWorkflow(workflowId: string): Promise<N8nWorkflow> {
  return n8nRequest(`/workflows/${workflowId}`, "GET") as Promise<N8nWorkflow>;
}

// --- Create and activate ---

export async function createWorkflow(workflow: N8nWorkflow): Promise<{ id: string; name: string }> {
  const result = (await n8nRequest("/workflows", "POST", workflow)) as { id: string; name: string };
  console.log(`[n8n] Created workflow "${result.name}" → ${result.id}`);
  return result;
}

export async function activateWorkflow(workflowId: string): Promise<void> {
  await n8nRequest(`/workflows/${workflowId}/activate`, "POST");
  console.log(`[n8n] Activated workflow ${workflowId}`);
}

// --- Generic workflow builder ---

export async function createCustomWorkflow(spec: {
  name: string;
  webhookPath: string;
  steps: {
    name: string;
    method: string;
    url: string;
    headers?: Record<string, string>;
    bodyTemplate: string;
  }[];
}): Promise<{ workflowId: string; webhookUrl: string }> {
  const nodes: N8nNode[] = [
    {
      id: "webhook-trigger",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 1.1,
      position: [240, 300],
      parameters: {
        httpMethod: "POST",
        path: spec.webhookPath,
        responseMode: "lastNode",
        options: {},
      },
    },
  ];

  const connections: N8nWorkflow["connections"] = {};
  let prevNodeName = "Webhook";

  spec.steps.forEach((step, i) => {
    const nodeName = step.name || `Step ${i + 1}`;
    const headerParams = step.headers
      ? Object.entries(step.headers).map(([name, value]) => ({ name, value }))
      : [];

    nodes.push({
      id: `step-${i}`,
      name: nodeName,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.1,
      position: [480 + i * 240, 300],
      parameters: {
        method: step.method,
        url: step.url,
        ...(headerParams.length
          ? { sendHeaders: true, headerParameters: { parameters: headerParams } }
          : {}),
        sendBody: true,
        specifyBody: "json",
        jsonBody: step.bodyTemplate,
        options: { timeout: 10000 },
      },
    });

    connections[prevNodeName] = {
      main: [[{ node: nodeName, type: "main", index: 0 }]],
    };
    prevNodeName = nodeName;
  });

  nodes.push({
    id: "respond",
    name: "Respond",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1,
    position: [480 + spec.steps.length * 240, 300],
    parameters: {
      respondWith: "json",
      responseBody: `={ "sent": true, "workflow": "${spec.name}" }`,
      options: {},
    },
  });
  connections[prevNodeName] = {
    main: [[{ node: "Respond", type: "main", index: 0 }]],
  };

  const workflow: N8nWorkflow = {
    name: spec.name,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };

  const result = await createWorkflow(workflow);
  await activateWorkflow(result.id);

  const webhookUrl = `${N8N_API_URL.replace("/api/v1", "")}/webhook/${spec.webhookPath}`;
  console.log(`[n8n] Workflow "${spec.name}" deployed: ${webhookUrl}`);
  return { workflowId: result.id, webhookUrl };
}

export function isN8nConfigured(): boolean {
  return Boolean(N8N_API_URL && N8N_API_KEY);
}
