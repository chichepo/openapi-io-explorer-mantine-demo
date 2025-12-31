import type { TreeNodeData } from "@mantine/core";

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

function schemaTypeLabel(schema: Exclude<JsonSchema, boolean>): string {
  const parts: string[] = [];
  if (schema.$ref) parts.push(`$ref: ${schema.$ref}`);
  if (schema.type) parts.push(schema.type);
  if (schema.format) parts.push(`(${schema.format})`);
  if (schema.nullable) parts.push("nullable");
  if (schema.enum) parts.push(`enum[${schema.enum.length}]`);
  return parts.join(" ");
}

function node(label: string, value: string, children?: TreeNodeData[]): TreeNodeData {
  return { label, value, children };
}

export function schemaToTree(schema: JsonSchema, rootName = "Schema"): TreeNodeData[] {
  if (schema === true) {
    return [node(`${rootName}: any`, rootName)];
  }
  if (schema === false) {
    return [node(`${rootName}: never`, rootName)];
  }

  const rootLabel = `${rootName}: ${schemaTypeLabel(schema) || "object"}`.trim();
  return [build(schema, rootName, rootLabel)];
}

function build(schema: Exclude<JsonSchema, boolean>, key: string, label?: string): TreeNodeData {
  const currentLabel = label ?? `${key}: ${schemaTypeLabel(schema) || "object"}`;

  // composition (oneOf/anyOf/allOf)
  const compositionNodes: TreeNodeData[] = [];
  if (schema.oneOf?.length) {
    compositionNodes.push(
      node(
        "oneOf",
        `${key}:oneOf`,
        schema.oneOf.map((s, i) => build(s as any, `${key}.oneOf[${i}]`, `#${i + 1}`))
      )
    );
  }
  if (schema.anyOf?.length) {
    compositionNodes.push(
      node(
        "anyOf",
        `${key}:anyOf`,
        schema.anyOf.map((s, i) => build(s as any, `${key}.anyOf[${i}]`, `#${i + 1}`))
      )
    );
  }
  if (schema.allOf?.length) {
    compositionNodes.push(
      node(
        "allOf",
        `${key}:allOf`,
        schema.allOf.map((s, i) => build(s as any, `${key}.allOf[${i}]`, `#${i + 1}`))
      )
    );
  }

  // arrays
  if (schema.type === "array" && schema.items) {
    const itemsNode = build(schema.items as any, `${key}[]`, "items");
    return node(currentLabel, key, [...compositionNodes, itemsNode]);
  }

  // objects
  const propNodes: TreeNodeData[] = [];
  if (schema.properties && typeof schema.properties === "object") {
    const required = new Set(schema.required ?? []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema === "boolean") {
        propNodes.push(
          node(
            `${propName}${required.has(propName) ? " *" : ""}: ${propSchema ? "any" : "never"}`,
            `${key}.${propName}`
          )
        );
        continue;
      }

      const suffix = required.has(propName) ? " *" : "";
      const propLabel = `${propName}${suffix}: ${schemaTypeLabel(propSchema) || "object"}`;
      propNodes.push(build(propSchema, `${key}.${propName}`, propLabel));
    }
  }

  // additionalProperties
  if (schema.additionalProperties) {
    if (schema.additionalProperties === true) {
      propNodes.push(node("additionalProperties: any", `${key}.$additional`));
    } else if (typeof schema.additionalProperties === "object") {
      propNodes.push(
        node("additionalProperties", `${key}.$additional`, [
          build(schema.additionalProperties, `${key}.$additional`, "value"),
        ])
      );
    }
  }

  return node(currentLabel, key, [...compositionNodes, ...propNodes]);
}
