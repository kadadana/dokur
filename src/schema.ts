import rawSchema from '../schema/compose-spec.json';

export type Schema = {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  patternProperties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  unevaluatedProperties?: boolean;
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  required?: string[];
  deprecated?: boolean;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minItems?: number;
  [key: string]: unknown;
};
export const composeSchema = rawSchema as Schema;
export type Path = (string | number)[];
export type Model = Record<string, any>;

function merge(a: Schema, b: Schema): Schema {
  return {
    ...a,
    ...b,
    properties: { ...a.properties, ...b.properties },
    patternProperties: { ...a.patternProperties, ...b.patternProperties },
    required: [...new Set([...(a.required ?? []), ...(b.required ?? [])])],
  };
}

/** Resolve references and inherited fields for rendering. Validation uses the untouched schema. */
export function resolveSchema(input: Schema, seen = new Set<string>()): Schema {
  let schema = { ...input };
  if (schema.$ref) {
    const ref = schema.$ref;
    if (!ref.startsWith('#/') || seen.has(ref)) return {};
    const target = ref
      .slice(2)
      .split('/')
      .reduce<any>(
        (value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')],
        composeSchema,
      );
    const next = new Set(seen).add(ref);
    delete schema.$ref;
    schema = merge(resolveSchema(target ?? {}, next), schema);
  }
  if (schema.allOf) {
    const parts = schema.allOf;
    delete schema.allOf;
    schema = parts.reduce((result, part) => merge(result, resolveSchema(part, seen)), schema);
  }
  return schema;
}

export function valueType(value: unknown): string {
  return value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'number' && Number.isInteger(value)
        ? 'integer'
        : typeof value;
}

export function schemaTypes(schema: Schema): string[] {
  const s = resolveSchema(schema);
  return Array.isArray(s.type)
    ? s.type
    : s.type
      ? [s.type]
      : s.properties && Object.keys(s.properties).length
        ? ['object']
        : [];
}

/** Only structural unions become form variants; anyOf constraint-only branches remain validation rules. */
export function variants(input: Schema): Schema[] {
  const s = resolveSchema(input);
  const branches = s.oneOf ?? s.anyOf;
  if (
    branches?.some((part) => {
      const p = resolveSchema(part);
      return p.type || p.oneOf || p.anyOf || (p.properties && Object.keys(p.properties).length);
    })
  ) {
    const base = { ...s };
    delete base.oneOf;
    delete base.anyOf;
    return branches.flatMap((part) => variants(merge(base, resolveSchema(part))));
  }
  if (Array.isArray(s.type)) return s.type.map((type) => ({ ...s, type }));
  return [s];
}

export function variantIndex(schema: Schema, value: unknown): number {
  const choices = variants(schema);
  const type = valueType(value);
  const scores = choices.map((s) => {
    const types = schemaTypes(s);
    if (types.length && !types.includes(type) && !(type === 'integer' && types.includes('number')))
      return -1000;
    let score = 0;
    if (s.enum?.some((item) => item === value)) score += 10;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value)) {
        if (s.properties?.[key]) score += 2;
        else if (!childSchema(s, key)) score -= 5;
      }
      for (const key of s.required ?? []) if (!(key in value)) score -= 2;
    }
    return score;
  });
  return Math.max(0, scores.indexOf(Math.max(...scores)));
}

export function childSchema(input: Schema, key: string | number): Schema | undefined {
  const s = resolveSchema(input);
  if (typeof key === 'number') return s.items;
  if (Object.hasOwn(s.properties ?? {}, key)) return s.properties![key];
  const matches = Object.entries(s.patternProperties ?? {}).filter(([pattern]) =>
    new RegExp(pattern).test(key),
  );
  if (matches.length)
    return matches.reduce((result, [, part]) => merge(result, part), {} as Schema);
  if (s.additionalProperties === false || s.unevaluatedProperties === false) return undefined;
  return typeof s.additionalProperties === 'object' ? s.additionalProperties : {};
}

export function schemaAt(path: Path, model: Model): Schema {
  let schema = composeSchema;
  let value: any = model;
  for (const key of path) {
    schema = variants(schema)[variantIndex(schema, value)] ?? schema;
    schema = childSchema(schema, key) ?? {};
    value = value?.[key];
  }
  return resolveSchema(schema);
}

export function initialValue(input: Schema, depth = 0): any {
  const s = variants(input)[0];
  if (s.default !== undefined) return structuredClone(s.default);
  if (s.const !== undefined) return structuredClone(s.const);
  if (s.enum?.length) return s.enum[0];
  switch (schemaTypes(s)[0]) {
    case 'object':
      return depth > 12
        ? {}
        : Object.fromEntries(
            (s.required ?? []).map((key) => [
              key,
              initialValue(s.properties?.[key] ?? {}, depth + 1),
            ]),
          );
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return s.minimum ?? 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return '';
  }
}

export function at(model: any, path: Path): any {
  return path.reduce((value, key) => value?.[key], model);
}
export const resourceKinds = Object.keys(composeSchema.properties ?? {}).filter((key) => {
  const s = resolveSchema(composeSchema.properties![key]);
  return (
    s.type === 'object' &&
    Object.keys(s.patternProperties ?? {}).some((pattern) => pattern !== '^x-')
  );
});
export function resourceSchema(kind: string): Schema {
  return (
    Object.values(
      resolveSchema(composeSchema.properties?.[kind] ?? {}).patternProperties ?? {},
    )[0] ?? {}
  );
}
