"use client";

import { Accordion, Badge, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { Tree } from "@mantine/core";
import type { TreeNodeData } from "@mantine/core";
import { schemaToTree } from "./schemaToTree";

type JsonSchema =
  | {
      type?: string;
      title?: string;
      description?: string;
      properties?: Record<string, JsonSchema>;
      required?: string[];
      items?: JsonSchema;
      enum?: Array<string | number | boolean | null>;
      nullable?: boolean;
      format?: string;
      $ref?: string;
      oneOf?: JsonSchema[];
      anyOf?: JsonSchema[];
      allOf?: JsonSchema[];
      additionalProperties?: boolean | JsonSchema;
    }
  | boolean;

type ApiMethod = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  operationId: string;
  request?: JsonSchema;
  response?: JsonSchema;
};

type Endpoint = {
  path: string;
  methods: ApiMethod[];
};

type Microservice = {
  name: string;
  endpoints: Endpoint[];
};

// --- sample data (swap this with your parsed OpenAPI grouping)
const demo: Microservice[] = [
  {
    name: "PaymentsService",
    endpoints: [
      {
        path: "/v1/payments",
        methods: [
          {
            method: "POST",
            operationId: "createPayment",
            request: {
              type: "object",
              required: ["amount", "currency", "debtor"],
              properties: {
                amount: { type: "number", format: "double" },
                currency: { type: "string", enum: ["EUR", "USD", "ILS"] },
                debtor: {
                  type: "object",
                  required: ["accountId"],
                  properties: {
                    accountId: { type: "string" },
                    partnerIds: { type: "array", items: { type: "string" } },
                  },
                },
                metadata: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
            },
            response: {
              type: "object",
              required: ["paymentId", "status"],
              properties: {
                paymentId: { type: "string" },
                status: { type: "string", enum: ["PENDING", "SIGNED", "REJECTED"] },
                requiredSigners: { type: "array", items: { type: "string" } },
              },
            },
          },
        ],
      },
    ],
  },
  {
    name: "SignaturesService",
    endpoints: [
      {
        path: "/v1/signatures/{paymentId}/collect",
        methods: [
          {
            method: "POST",
            operationId: "collectSignatures",
            request: {
              type: "object",
              required: ["paymentId", "signers"],
              properties: {
                paymentId: { type: "string" },
                signers: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["partnerId", "method"],
                    properties: {
                      partnerId: { type: "string" },
                      method: { type: "string", enum: ["OTP", "QUALIFIED", "BIOMETRIC"] },
                    },
                  },
                },
              },
            },
            response: {
              type: "object",
              required: ["status"],
              properties: {
                status: { type: "string", enum: ["IN_PROGRESS", "DONE"] },
                missing: { type: "array", items: { type: "string" } },
              },
            },
          },
        ],
      },
    ],
  },
];

function MethodHeader({ m }: { m: ApiMethod }) {
  return (
    <Group gap="sm">
      <Badge variant="light">{m.method}</Badge>
      <Text fw={600}>{m.operationId}</Text>
    </Group>
  );
}

function SchemaPanel({ title, schema }: { title: string; schema?: JsonSchema }) {
  const treeData: TreeNodeData[] = schema ? schemaToTree(schema, title) : [];

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={700}>{title}</Text>
        {!schema && (
          <Badge color="gray" variant="light">
            no schema
          </Badge>
        )}
      </Group>

      {schema ? <Tree data={treeData} /> : null}
    </Stack>
  );
}

export default function OpenApiIoExplorer() {
  return (
    <Stack gap="md">
      <Title order={2}>OpenAPI I/O Explorer (Accordion + Schema Tree)</Title>
      <Text c="dimmed">
        Replace the <code>demo</code> object with your parsed OpenAPI structure.
      </Text>

      <Divider />

      <Accordion multiple defaultValue={[demo[0]?.name].filter(Boolean) as string[]}>
        {demo.map((svc) => (
          <Accordion.Item key={svc.name} value={svc.name}>
            <Accordion.Control>
              <Group justify="space-between">
                <Text fw={700}>{svc.name}</Text>
                <Badge variant="light">{svc.endpoints.length} endpoints</Badge>
              </Group>
            </Accordion.Control>

            <Accordion.Panel>
              <Accordion multiple>
                {svc.endpoints.map((ep) => (
                  <Accordion.Item key={ep.path} value={ep.path}>
                    <Accordion.Control>
                      <Group justify="space-between">
                        <Text ff="monospace">{ep.path}</Text>
                        <Badge variant="light">{ep.methods.length} methods</Badge>
                      </Group>
                    </Accordion.Control>

                    <Accordion.Panel>
                      <Accordion multiple>
                        {ep.methods.map((m) => (
                          <Accordion.Item
                            key={`${ep.path}:${m.method}:${m.operationId}`}
                            value={`${ep.path}:${m.method}:${m.operationId}`}
                          >
                            <Accordion.Control>
                              <MethodHeader m={m} />
                            </Accordion.Control>

                            <Accordion.Panel>
                              <Stack gap="md">
                                <SchemaPanel title="Request" schema={m.request} />
                                <SchemaPanel title="Response" schema={m.response} />
                              </Stack>
                            </Accordion.Panel>
                          </Accordion.Item>
                        ))}
                      </Accordion>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}
