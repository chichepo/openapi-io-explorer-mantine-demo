"use client";

import {
  Accordion,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Tree } from "@mantine/core";
import type { TreeNodeData } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
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
      example?: unknown;
      examples?: unknown[];
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

type OpenApiParameter = {
  name?: string;
  in?: "query" | "path" | "header" | "cookie" | string;
  required?: boolean;
  schema?: JsonSchema;
  description?: string;
  example?: unknown;
};

type OpenApiRequestBody = {
  content?: Record<string, { schema?: JsonSchema }>;
};

type OpenApiResponse = {
  content?: Record<string, { schema?: JsonSchema }>;
};

type OpenApiOperation = {
  tags?: string[];
  operationId?: string;
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  parameters?: OpenApiParameter[];
};

type OpenApiPathItem = {
  parameters?: OpenApiParameter[];
  [method: string]: unknown;
};

type OpenApiDocument = {
  info?: { title?: string };
  tags?: Array<{ name?: string }>;
  paths?: Record<string, OpenApiPathItem>;
};

const METHOD_ORDER: ApiMethod["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const DEFAULT_SOURCE = "data/petStore.json";

function toHttpMethod(value: string): ApiMethod["method"] | null {
  const upper = value.toUpperCase();
  return METHOD_ORDER.includes(upper as ApiMethod["method"])
    ? (upper as ApiMethod["method"])
    : null;
}

function pickContentSchema(
  content?: Record<string, { schema?: JsonSchema }>
): JsonSchema | undefined {
  if (!content || typeof content !== "object") return undefined;
  if (content["application/json"]?.schema) {
    return content["application/json"].schema;
  }
  const first = Object.values(content).find((entry) => entry?.schema);
  return first?.schema;
}

function pickRequestSchema(requestBody?: OpenApiRequestBody): JsonSchema | undefined {
  return pickContentSchema(requestBody?.content);
}

function pickResponseSchema(responses?: Record<string, OpenApiResponse>): JsonSchema | undefined {
  if (!responses || typeof responses !== "object") return undefined;
  const keys = Object.keys(responses);
  const preferred =
    ["200", "201", "202", "204"].find((status) => responses[status]) ??
    keys.find((status) => /^2\\d\\d$/.test(status)) ??
    (responses.default ? "default" : keys[0]);
  if (!preferred) return undefined;
  return pickContentSchema(responses[preferred]?.content);
}

function mergeParameters(
  baseParams: OpenApiParameter[] = [],
  opParams: OpenApiParameter[] = []
): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>();
  for (const param of baseParams) {
    if (!param?.name || !param.in) continue;
    merged.set(`${param.in}:${param.name}`, param);
  }
  for (const param of opParams) {
    if (!param?.name || !param.in) continue;
    merged.set(`${param.in}:${param.name}`, param);
  }
  return Array.from(merged.values());
}

function buildParamsSchema(params: OpenApiParameter[]): JsonSchema | undefined {
  if (!params.length) return undefined;
  const groups: Record<
    string,
    { properties: Record<string, JsonSchema>; required: string[] }
  > = {};

  for (const param of params) {
    if (!param?.name) continue;
    const location = typeof param.in === "string" ? param.in : "query";
    const group = groups[location] ?? { properties: {}, required: [] };
    groups[location] = group;

    const baseSchema = param.schema ?? { type: "string" };
    let paramSchema: JsonSchema;
    if (typeof baseSchema === "boolean") {
      paramSchema = baseSchema;
    } else {
      paramSchema = { ...baseSchema };
      if (param.description && !paramSchema.description) {
        paramSchema.description = param.description;
      }
      if (param.example !== undefined && paramSchema.example === undefined) {
        paramSchema.example = param.example;
      }
    }

    group.properties[param.name] = paramSchema;
    if (param.required) {
      group.required.push(param.name);
    }
  }

  const groupEntries = Object.entries(groups).filter(
    ([, group]) => Object.keys(group.properties).length
  );
  if (!groupEntries.length) return undefined;

  if (groupEntries.length === 1) {
    const [, group] = groupEntries[0];
    return {
      type: "object",
      properties: group.properties,
      required: group.required.length ? group.required : undefined,
    };
  }

  const properties: Record<string, JsonSchema> = {};
  for (const [location, group] of groupEntries) {
    properties[location] = {
      type: "object",
      properties: group.properties,
      required: group.required.length ? group.required : undefined,
    };
  }

  return { type: "object", properties };
}

function mergeRequestSchema(
  bodySchema?: JsonSchema,
  paramsSchema?: JsonSchema
): JsonSchema | undefined {
  if (bodySchema && paramsSchema) {
    return {
      type: "object",
      properties: {
        params: paramsSchema,
        body: bodySchema,
      },
    };
  }
  return bodySchema ?? paramsSchema;
}

function openApiToMicroservices(doc: OpenApiDocument): Microservice[] {
  if (!doc?.paths || typeof doc.paths !== "object") return [];

  const tagOrder = new Map<string, number>();
  if (Array.isArray(doc.tags)) {
    doc.tags.forEach((tag, index) => {
      if (tag?.name) tagOrder.set(tag.name, index);
    });
  }

  const serviceMap = new Map<string, { name: string; endpoints: Map<string, Endpoint> }>();

  for (const [pathKey, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const [methodKey, operation] of Object.entries(pathItem)) {
      const httpMethod = toHttpMethod(methodKey);
      if (!httpMethod) continue;
      if (!operation || typeof operation !== "object") continue;

      const op = operation as OpenApiOperation;
      const tags = Array.isArray(op.tags) && op.tags.length ? op.tags : ["default"];
      const opParams = Array.isArray(op.parameters) ? op.parameters : [];
      const allParams = mergeParameters(sharedParams, opParams);
      const paramsSchema = buildParamsSchema(allParams);
      const requestSchema = mergeRequestSchema(pickRequestSchema(op.requestBody), paramsSchema);
      const responseSchema = pickResponseSchema(op.responses);
      const operationId =
        typeof op.operationId === "string" && op.operationId.trim()
          ? op.operationId
          : `${httpMethod} ${pathKey}`;

      for (const tag of tags) {
        const serviceName = String(tag);
        let service = serviceMap.get(serviceName);
        if (!service) {
          service = { name: serviceName, endpoints: new Map() };
          serviceMap.set(serviceName, service);
        }

        let endpoint = service.endpoints.get(pathKey);
        if (!endpoint) {
          endpoint = { path: pathKey, methods: [] };
          service.endpoints.set(pathKey, endpoint);
        }

        endpoint.methods.push({
          method: httpMethod,
          operationId,
          request: requestSchema,
          response: responseSchema,
        });
      }
    }
  }

  const services = Array.from(serviceMap.values()).map((service) => ({
    name: service.name,
    endpoints: Array.from(service.endpoints.values())
      .map((endpoint) => ({
        path: endpoint.path,
        methods: endpoint.methods.sort(
          (a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method)
        ),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  }));

  services.sort((a, b) => {
    const aOrder = tagOrder.get(a.name);
    const bOrder = tagOrder.get(b.name);
    if (aOrder !== undefined || bOrder !== undefined) {
      return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return a.name.localeCompare(b.name);
  });

  return services;
}

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
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [services, setServices] = useState<Microservice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [specTitle, setSpecTitle] = useState<string | null>(null);

  const totals = useMemo(
    () =>
      services.reduce(
        (acc, svc) => {
          acc.endpoints += svc.endpoints.length;
          acc.methods += svc.endpoints.reduce((sum, ep) => sum + ep.methods.length, 0);
          return acc;
        },
        { services: services.length, endpoints: 0, methods: 0 }
      ),
    [services]
  );

  useEffect(() => {
    void loadSource(DEFAULT_SOURCE);
  }, []);

  async function loadSource(nextSource?: string) {
    const target = (nextSource ?? source).trim();
    if (!target) {
      setError("Enter a file path or URL.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/openapi?source=${encodeURIComponent(target)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof (payload as { error?: string })?.error === "string"
            ? (payload as { error?: string }).error
            : `Failed to load ${target}`;
        throw new Error(message);
      }

      const openApi = (await response.json()) as OpenApiDocument;
      const parsed = openApiToMicroservices(openApi);
      if (!parsed.length) {
        throw new Error("No endpoints found in the OpenAPI document.");
      }

      setServices(parsed);
      setLoadedSource(target);
      setSpecTitle(typeof openApi?.info?.title === "string" ? openApi.info.title : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the source.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="md">
      <Title order={2}>OpenAPI I/O Explorer (Accordion + Schema Tree)</Title>
      <Text c="dimmed">Load an OpenAPI JSON file from a URL or local path in data/.</Text>
      {specTitle ? (
        <Text fw={600}>Spec: {specTitle}</Text>
      ) : null}
      {loadedSource ? (
        <Text size="sm" c="dimmed">
          Source: <code>{loadedSource}</code>
        </Text>
      ) : null}

      <Group align="flex-end" wrap="wrap">
        <TextInput
          label="OpenAPI JSON path or URL"
          placeholder="data/petStore.json or https://example.com/openapi.json"
          value={source}
          onChange={(event) => setSource(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void loadSource();
            }
          }}
          styles={{ root: { flex: 1, minWidth: 260 } }}
        />
        <Button loading={loading} onClick={() => void loadSource()}>
          Load
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Local paths are resolved inside the project <code>data/</code> folder.
      </Text>
      {error ? (
        <Alert color="red" title="Load error" variant="light">
          {error}
        </Alert>
      ) : null}

      <Group gap="xs">
        <Badge variant="light">{totals.services} services</Badge>
        <Badge variant="light">{totals.endpoints} endpoints</Badge>
        <Badge variant="light">{totals.methods} methods</Badge>
      </Group>

      <Divider />

      {services.length ? (
        <Accordion multiple defaultValue={[services[0]?.name].filter(Boolean) as string[]}>
          {services.map((svc) => (
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
      ) : (
        <Text c="dimmed">No endpoints loaded yet. Provide a source and click Load.</Text>
      )}
    </Stack>
  );
}
