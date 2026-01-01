"use client";

import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useMemo, useState } from "react";

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
      default?: unknown;
      nullable?: boolean;
      format?: string;
      $ref?: string;
      oneOf?: JsonSchema[];
      anyOf?: JsonSchema[];
      allOf?: JsonSchema[];
      additionalProperties?: boolean | JsonSchema;
      xml?: { name?: string };
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
  components?: { schemas?: Record<string, JsonSchema> };
};

const METHOD_META = {
  GET: { color: "cyan", gradient: { from: "cyan", to: "teal", deg: 120 } },
  POST: { color: "green", gradient: { from: "lime", to: "green", deg: 120 } },
  PUT: { color: "blue", gradient: { from: "blue", to: "cyan", deg: 120 } },
  PATCH: { color: "orange", gradient: { from: "yellow", to: "orange", deg: 120 } },
  DELETE: { color: "red", gradient: { from: "red", to: "orange", deg: 120 } },
} as const;

const METHOD_ORDER: ApiMethod["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const SERVICE_COLORS = ["teal", "cyan", "blue", "lime", "yellow", "orange", "red"] as const;
const DEFAULT_SOURCE = "data/petStore.json";

type SchemaResolver = (ref: string) => JsonSchema | undefined;

function pickServiceColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % SERVICE_COLORS.length;
  return SERVICE_COLORS[index];
}

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
    keys.find((status) => /^2\d\d$/.test(status)) ??
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

function decodeRefPointer(pointer: string) {
  return pointer.replace(/~1/g, "/").replace(/~0/g, "~");
}

function buildSchemaResolver(doc: OpenApiDocument | null): SchemaResolver {
  const schemas = doc?.components?.schemas ?? {};
  const aliasMap = new Map<string, JsonSchema>();

  for (const [key, schema] of Object.entries(schemas)) {
    aliasMap.set(key, schema);
    if (schema && typeof schema === "object") {
      const xmlName = typeof schema.xml?.name === "string" ? schema.xml.name : null;
      if (xmlName && !aliasMap.has(xmlName)) {
        aliasMap.set(xmlName, schema);
      }
    }
    const hyphenIndex = key.indexOf("-");
    if (hyphenIndex > 0) {
      const base = key.slice(0, hyphenIndex);
      if (!aliasMap.has(base)) {
        aliasMap.set(base, schema);
      }
    }
  }

  return (ref: string) => {
    if (!ref) return undefined;
    const match = ref.match(/^#\/components\/schemas\/(.+)$/);
    if (!match) return undefined;
    const rawName = match[1];
    let decoded = rawName;
    try {
      decoded = decodeURIComponent(rawName);
    } catch {
      decoded = rawName;
    }
    const name = decodeRefPointer(decoded);
    return aliasMap.get(name);
  };
}

function pickExampleValue(schema: Exclude<JsonSchema, boolean>) {
  if (schema.example !== undefined) return schema.example;
  if (schema.examples && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringFallbackForFormat(format?: string): string {
  switch (format) {
    case "date":
      return "2024-01-01";
    case "date-time":
      return "2024-01-01T00:00:00Z";
    case "uuid":
      return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    case "email":
      return "user@example.com";
    case "uri":
    case "url":
      return "https://example.com";
    case "hostname":
      return "example.com";
    case "ipv4":
      return "192.168.0.1";
    case "ipv6":
      return "2001:db8::1";
    default:
      return "string";
  }
}

function schemaToExample(
  schema: JsonSchema,
  resolveRef: SchemaResolver,
  seenRefs: Set<string>,
  depth = 0
): unknown {
  if (depth > 6) return "<depth-limit>";
  if (schema === true) return "<any>";
  if (schema === false) return "<never>";
  if (!schema || typeof schema !== "object") return null;

  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return "<circular>";
    const resolved = resolveRef(schema.$ref);
    if (resolved) {
      seenRefs.add(schema.$ref);
      const value = schemaToExample(resolved, resolveRef, seenRefs, depth + 1);
      seenRefs.delete(schema.$ref);
      return value;
    }
    return schema.$ref;
  }

  const directExample = pickExampleValue(schema);
  if (directExample !== undefined) return directExample;

  let allOfBase: Record<string, unknown> | null = null;
  if (schema.allOf?.length) {
    let hasObject = false;
    const merged = schema.allOf.reduce<Record<string, unknown>>((acc, item) => {
      const value = schemaToExample(item, resolveRef, seenRefs, depth + 1);
      if (isPlainObject(value)) {
        hasObject = true;
        Object.assign(acc, value);
      }
      return acc;
    }, {});
    allOfBase = hasObject ? merged : null;
  }

  if (schema.type === "object" || schema.properties || schema.additionalProperties || allOfBase) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const keys = Object.keys(properties).sort((a, b) => {
      const aRequired = required.has(a);
      const bRequired = required.has(b);
      if (aRequired !== bRequired) return aRequired ? -1 : 1;
      return a.localeCompare(b);
    });
    const result: Record<string, unknown> = allOfBase ? { ...allOfBase } : {};
    for (const key of keys) {
      const propSchema = properties[key];
      result[key] = schemaToExample(propSchema, resolveRef, seenRefs, depth + 1);
    }

    if (!keys.length && schema.additionalProperties) {
      const additionalValue =
        schema.additionalProperties === true
          ? "<any>"
          : schemaToExample(schema.additionalProperties, resolveRef, seenRefs, depth + 1);
      result.additionalProp1 = additionalValue;
    }
    return result;
  }

  if (schema.type === "array" || schema.items) {
    if (schema.items === false) return [];
    const itemsSchema = schema.items === true ? "<any>" : schema.items ?? { type: "string" };
    const itemValue =
      typeof itemsSchema === "string"
        ? itemsSchema
        : schemaToExample(itemsSchema, resolveRef, seenRefs, depth + 1);
    return [itemValue];
  }

  if (!allOfBase && schema.allOf?.length) {
    return schemaToExample(schema.allOf[0], resolveRef, seenRefs, depth + 1);
  }

  if (schema.oneOf?.length) {
    return schemaToExample(schema.oneOf[0], resolveRef, seenRefs, depth + 1);
  }
  if (schema.anyOf?.length) {
    return schemaToExample(schema.anyOf[0], resolveRef, seenRefs, depth + 1);
  }

  if (schema.type === "string") {
    return stringFallbackForFormat(schema.format);
  }
  if (schema.type === "integer" || schema.type === "number") {
    return 0;
  }
  if (schema.type === "boolean") {
    return false;
  }

  return "value";
}

const SAFE_STRING = /^[a-zA-Z0-9._/=-]+$/;
const YAML_KEYWORDS = new Set([
  "true",
  "false",
  "null",
  "~",
  "yes",
  "no",
  "on",
  "off",
]);

function formatYamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (SAFE_STRING.test(value) && !YAML_KEYWORDS.has(lower)) {
      return value;
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "0";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

function formatYamlKey(value: string): string {
  if (SAFE_STRING.test(value) && !YAML_KEYWORDS.has(value.toLowerCase())) {
    return value;
  }
  return JSON.stringify(value);
}

function yamlLines(value: unknown, indent = 0): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}[]`];
    return value.flatMap((item) => {
      if (isPlainObject(item) || Array.isArray(item)) {
        return [`${pad}-`, ...yamlLines(item, indent + 2)];
      }
      return [`${pad}- ${formatYamlScalar(item)}`];
    });
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return [`${pad}{}`];
    return entries.flatMap(([key, item]) => {
      const safeKey = formatYamlKey(key);
      if (isPlainObject(item) || Array.isArray(item)) {
        return [`${pad}${safeKey}:`, ...yamlLines(item, indent + 2)];
      }
      return [`${pad}${safeKey}: ${formatYamlScalar(item)}`];
    });
  }

  return [`${pad}${formatYamlScalar(value)}`];
}

function schemaToYaml(schema: JsonSchema, resolveRef: SchemaResolver): string {
  const example = schemaToExample(schema, resolveRef, new Set(), 0);
  return yamlLines(example).join("\n");
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
  const theme = useMantineTheme();
  const meta = METHOD_META[m.method];

  return (
    <Group gap="sm">
      <Badge variant="gradient" gradient={meta.gradient} size="sm">
        {m.method}
      </Badge>
      <Text fw={600} c={theme.colors[meta.color][7]}>
        {m.operationId}
      </Text>
    </Group>
  );
}

function SchemaPanel({
  title,
  schema,
  resolveRef,
}: {
  title: string;
  schema?: JsonSchema;
  resolveRef: SchemaResolver;
}) {
  const yaml = useMemo(() => (schema ? schemaToYaml(schema, resolveRef) : ""), [schema, resolveRef]);
  const tone = title.toLowerCase() === "request" ? "cyan" : "teal";

  return (
    <Paper
      className="schema-card"
      data-kind={title.toLowerCase()}
      withBorder
      radius="md"
      p="sm"
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Badge variant="light" color={tone} size="sm">
            {title}
          </Badge>
          {!schema && (
            <Badge color="gray" variant="light">
              no schema
            </Badge>
          )}
        </Group>

        {schema ? (
          <pre className="schema-yaml" aria-label={`${title} payload example`}>
            <code>{yaml}</code>
          </pre>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function OpenApiIoExplorer() {
  const theme = useMantineTheme();
  const [previewOpened, previewHandlers] = useDisclosure(false);
  const [previewDoc, setPreviewDoc] = useState<OpenApiDocument | null>(null);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [services, setServices] = useState<Microservice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [specTitle, setSpecTitle] = useState<string | null>(null);

  const resolveRef = useMemo(() => buildSchemaResolver(previewDoc), [previewDoc]);

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

  const previewJson = useMemo(
    () => (previewDoc ? JSON.stringify(previewDoc, null, 2) : ""),
    [previewDoc]
  );

  const previewLines = useMemo(() => previewJson.split("\n"), [previewJson]);
  const previewTitle = useMemo(() => {
    if (!loadedSource) return "preview.json";
    const trimmed = loadedSource.split("?")[0];
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || "preview.json";
  }, [loadedSource]);

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
      setPreviewDoc(openApi);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the source.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="lg">
      <Modal
        opened={previewOpened}
        onClose={previewHandlers.close}
        size="xl"
        padding={0}
        centered
        withCloseButton={false}
        classNames={{ content: "vscode-modal", body: "vscode-body" }}
        overlayProps={{ blur: 3, opacity: 0.45 }}
      >
        <div className="vscode-titlebar">
          <div className="vscode-dots">
            <span className="vscode-dot red" />
            <span className="vscode-dot yellow" />
            <span className="vscode-dot green" />
          </div>
          <div className="vscode-title">{previewTitle}</div>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Close preview"
            onClick={previewHandlers.close}
          >
            X
          </ActionIcon>
        </div>
        <div className="vscode-panel">
          {previewDoc ? (
            <div className="vscode-code" role="region" aria-label="Preview JSON">
              {previewLines.map((line, index) => (
                <div key={`${index}-${line}`} className="vscode-line">
                  <span className="vscode-linenum">{index + 1}</span>
                  <span className="vscode-text">{line || " "}</span>
                </div>
              ))}
            </div>
          ) : (
            <Text className="vscode-empty">Load a document to preview the raw JSON.</Text>
          )}
        </div>
      </Modal>

      <Paper className="glass-card rise-in" p="lg" radius="lg">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap="xs">
              <Badge variant="gradient" gradient={{ from: "orange", to: "yellow", deg: 90 }}>
                OpenAPI explorer
              </Badge>
              <Title order={2}>OpenAPI I/O Explorer (Accordion + Payload YAML)</Title>
              <Text c="dimmed">Load an OpenAPI JSON file from a URL or local path in data/.</Text>
              {specTitle ? <Text fw={600}>Spec: {specTitle}</Text> : null}
              {loadedSource ? (
                <Text size="sm" c="dimmed">
                  Source: <code>{loadedSource}</code>
                </Text>
              ) : null}
              <Group gap="xs" wrap="wrap">
                <Badge variant="light" color="teal">
                  {totals.services} services
                </Badge>
                <Badge variant="light" color="cyan">
                  {totals.endpoints} endpoints
                </Badge>
                <Badge variant="light" color="green">
                  {totals.methods} methods
                </Badge>
              </Group>
            </Stack>

            <Stack gap="sm" align="flex-end">
              <Stack gap="xs" className="legend-card">
                <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                  Method palette
                </Text>
                <Group gap="xs" wrap="wrap">
                  {METHOD_ORDER.map((method) => {
                    const meta = METHOD_META[method];
                    return (
                      <Badge key={method} variant="light" color={meta.color} size="xs">
                        {method}
                      </Badge>
                    );
                  })}
                </Group>
              </Stack>
              <Button
                variant="gradient"
                gradient={{ from: "teal", to: "cyan", deg: 120 }}
                onClick={previewHandlers.open}
                disabled={!previewDoc}
              >
                Preview JSON
              </Button>
            </Stack>
          </Group>

          <Divider />

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
        </Stack>
      </Paper>

      <Divider label="Services" labelPosition="center" />

      {services.length ? (
        <Accordion
          multiple
          variant="separated"
          radius="lg"
          defaultValue={[services[0]?.name].filter(Boolean) as string[]}
        >
          {services.map((svc, svcIndex) => {
            const serviceColor = pickServiceColor(svc.name);
            const serviceShade = theme.colors[serviceColor][6];

            return (
              <Accordion.Item
                key={svc.name}
                value={svc.name}
                className="service-item rise-in"
                style={{
                  borderLeft: `4px solid ${serviceShade}`,
                  animationDelay: `${svcIndex * 90}ms`,
                }}
              >
                <Accordion.Control>
                  <Group justify="space-between" wrap="wrap">
                    <Group gap="xs">
                      <Box className="service-dot" style={{ backgroundColor: serviceShade }} />
                      <Text fw={700}>{svc.name}</Text>
                    </Group>
                    <Badge variant="light" color={serviceColor}>
                      {svc.endpoints.length} endpoints
                    </Badge>
                  </Group>
                </Accordion.Control>

                <Accordion.Panel>
                  <Accordion multiple variant="separated" radius="md">
                    {svc.endpoints.map((ep) => (
                      <Accordion.Item key={ep.path} value={ep.path}>
                        <Accordion.Control>
                          <Group justify="space-between" wrap="wrap">
                            <Text ff="var(--font-mono)" fw={600}>
                              {ep.path}
                            </Text>
                            <Group gap="xs" wrap="wrap">
                              {ep.methods.map((method) => {
                                const meta = METHOD_META[method.method];
                                return (
                                  <Badge
                                    key={`${ep.path}:${method.method}`}
                                    color={meta.color}
                                    size="xs"
                                    variant="light"
                                  >
                                    {method.method}
                                  </Badge>
                                );
                              })}
                            </Group>
                          </Group>
                        </Accordion.Control>

                        <Accordion.Panel>
                          <Accordion multiple variant="separated" radius="md">
                            {ep.methods.map((m) => (
                              <Accordion.Item
                                key={`${ep.path}:${m.method}:${m.operationId}`}
                                value={`${ep.path}:${m.method}:${m.operationId}`}
                              >
                                <Accordion.Control>
                                  <MethodHeader m={m} />
                                </Accordion.Control>

                                <Accordion.Panel>
                                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                                    <SchemaPanel
                                      title="Request"
                                      schema={m.request}
                                      resolveRef={resolveRef}
                                    />
                                    <SchemaPanel
                                      title="Response"
                                      schema={m.response}
                                      resolveRef={resolveRef}
                                    />
                                  </SimpleGrid>
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
            );
          })}
        </Accordion>
      ) : (
        <Text c="dimmed">No endpoints loaded yet. Provide a source and click Load.</Text>
      )}
    </Stack>
  );
}
