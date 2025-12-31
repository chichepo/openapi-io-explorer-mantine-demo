import { Badge, Text, Tooltip } from "@mantine/core";
import type { TreeNodeData } from "@mantine/core";
import { createElement } from "react";

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

function schemaTypeLabel(schema: Exclude<JsonSchema, boolean>): string {
  const parts: string[] = [];
  if (schema.$ref) parts.push(`$ref: ${schema.$ref}`);
  if (schema.type) parts.push(schema.type);
  if (schema.format) parts.push(`(${schema.format})`);
  if (schema.nullable) parts.push("nullable");
  if (!parts.length && schema.enum) parts.push("enum");
  return parts.join(" ");
}

function node(label: TreeNodeData["label"], value: string, children?: TreeNodeData[]): TreeNodeData {
  return { label, value, children };
}

function getExampleValue(schema: Exclude<JsonSchema, boolean>): unknown | undefined {
  if (schema.example !== undefined) return schema.example;
  if (schema.examples && schema.examples.length > 0) return schema.examples[0];
  return undefined;
}

function formatExampleValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 80) return `${serialized.slice(0, 77)}...`;
    return serialized;
  } catch {
    return String(value);
  }
}

function splitLabel(mainLabel: string): { name: string; description?: string } {
  const colonIndex = mainLabel.indexOf(":");
  if (colonIndex === -1) {
    return { name: mainLabel };
  }

  const name = mainLabel.slice(0, colonIndex).trim();
  const description = mainLabel.slice(colonIndex + 1).trim();
  return description ? { name, description } : { name };
}

function renderLabel(
  mainLabel: string,
  schema?: Exclude<JsonSchema, boolean>
): TreeNodeData["label"] {
  const { name, description } = splitLabel(mainLabel);
  const schemaDescription =
    schema && typeof schema.description === "string" ? schema.description.trim() : "";
  const fullDescription = [description, schemaDescription].filter(Boolean).join(" - ");

  const enumValues = schema?.enum?.length ? schema.enum : undefined;
  const exampleValue = schema ? getExampleValue(schema) : undefined;
  const enumLabel = enumValues ? enumValues.map(formatExampleValue).join(", ") : "";
  const exampleText = exampleValue !== undefined ? formatExampleValue(exampleValue) : "";
  const multiline = enumLabel.length > 60 || (enumValues?.length ?? 0) > 4;

  return createElement(
    "span",
    { className: "tree-label" },
    createElement(
      "span",
      { className: "tree-label-main" },
      createElement("span", { className: "tree-label-name" }, name),
      fullDescription
        ? createElement("span", { className: "tree-label-desc" }, `: ${fullDescription}`)
        : null
    ),
    enumValues
      ? createElement(
          Tooltip,
          { label: enumLabel, multiline, w: 260, withArrow: true },
          createElement(
            Badge,
            { size: "xs", variant: "light", color: "blue" },
            `enum[${enumValues.length}]`
          )
        )
      : null,
    exampleValue !== undefined
      ? createElement(
          Text,
          { component: "span", size: "xs", c: "dimmed" },
          "ex: ",
          createElement("span", { style: { fontFamily: "var(--font-mono)" } }, exampleText)
        )
      : null
  );
}

export function schemaToTree(schema: JsonSchema, rootName = "Schema"): TreeNodeData[] {
  if (schema === true) {
    return [node(renderLabel(`${rootName}: any`), rootName)];
  }
  if (schema === false) {
    return [node(renderLabel(`${rootName}: never`), rootName)];
  }

  const rootLabel = `${rootName}: ${schemaTypeLabel(schema) || "object"}`.trim();
  return [build(schema, rootName, rootLabel)];
}

function build(schema: Exclude<JsonSchema, boolean>, key: string, label?: string): TreeNodeData {
  const baseLabel = label ?? `${key}: ${schemaTypeLabel(schema) || "object"}`;
  const currentLabel = renderLabel(baseLabel, schema);

  // composition (oneOf/anyOf/allOf)
  const compositionNodes: TreeNodeData[] = [];
  if (schema.oneOf?.length) {
    compositionNodes.push(
      node(
        renderLabel("oneOf"),
        `${key}:oneOf`,
        schema.oneOf.map((s, i) => build(s as any, `${key}.oneOf[${i}]`, `#${i + 1}`))
      )
    );
  }
  if (schema.anyOf?.length) {
    compositionNodes.push(
      node(
        renderLabel("anyOf"),
        `${key}:anyOf`,
        schema.anyOf.map((s, i) => build(s as any, `${key}.anyOf[${i}]`, `#${i + 1}`))
      )
    );
  }
  if (schema.allOf?.length) {
    compositionNodes.push(
      node(
        renderLabel("allOf"),
        `${key}:allOf`,
        schema.allOf.map((s, i) => build(s as any, `${key}.allOf[${i}]`, `#${i + 1}`))
      )
    );
  }

  // arrays
  if (schema.type === "array" && schema.items) {
    if (schema.items === true) {
      const itemsNode = node(renderLabel("items: any"), `${key}[]`);
      return node(currentLabel, key, [...compositionNodes, itemsNode]);
    }
    if (schema.items === false) {
      const itemsNode = node(renderLabel("items: never"), `${key}[]`);
      return node(currentLabel, key, [...compositionNodes, itemsNode]);
    }

    const itemsLabel = `items: ${schemaTypeLabel(schema.items as any) || "object"}`;
    const itemsNode = build(schema.items as any, `${key}[]`, itemsLabel);
    return node(currentLabel, key, [...compositionNodes, itemsNode]);
  }

  // objects
  const propNodes: TreeNodeData[] = [];
  if (schema.properties && typeof schema.properties === "object") {
    const required = new Set(schema.required ?? []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema === "boolean") {
        const propLabel = `${propName}${required.has(propName) ? " *" : ""}: ${
          propSchema ? "any" : "never"
        }`;
        propNodes.push(node(renderLabel(propLabel), `${key}.${propName}`));
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
      propNodes.push(node(renderLabel("additionalProperties: any"), `${key}.$additional`));
    } else if (typeof schema.additionalProperties === "object") {
      const valueLabel = `value: ${schemaTypeLabel(schema.additionalProperties) || "object"}`;
      propNodes.push(
        node(renderLabel("additionalProperties"), `${key}.$additional`, [
          build(schema.additionalProperties, `${key}.$additional`, valueLabel),
        ])
      );
    }
  }

  return node(currentLabel, key, [...compositionNodes, ...propNodes]);
}
