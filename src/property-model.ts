import {
  at,
  childSchema,
  composeSchema,
  resourceKinds,
  schemaAt,
  schemaTypes,
  variantIndex,
  variants,
  valueType,
  type Path,
  type Schema,
} from './schema';
import type { Snapshot } from './protocol';

export function propertyScope(state: Snapshot): Path {
  return state.selected && state.selected !== '@project' ? state.selected.split('/') : [];
}
export function propertySchema(state: Snapshot, path: Path): Schema {
  const schema = path.length
    ? schemaAt(path, state.model)
    : {
        ...composeSchema,
        properties: Object.fromEntries(
          Object.entries(composeSchema.properties ?? {}).filter(
            ([key]) => !resourceKinds.includes(key),
          ),
        ),
      };
  return variants(schema)[variantIndex(schema, at(state.model, path))] ?? schema;
}
export function propertyChildren(
  state: Snapshot,
  path: Path,
): { key: string | number; value: unknown; missing?: boolean }[] {
  const value = at(state.model, path);
  if (Array.isArray(value)) return value.map((value, key) => ({ key, value }));
  const entries =
    value && typeof value === 'object'
      ? Object.entries(value)
          .filter(([key]) => path.length || !resourceKinds.includes(key))
          .map(([key, value]) => ({ key, value }))
      : [];
  // Common optional fields stay discoverable without writing an empty image to YAML.
  if (
    path.length === 2 &&
    childSchema(propertySchema(state, path), 'image') &&
    !Object.hasOwn(value ?? {}, 'image')
  )
    entries.unshift({ key: 'image', value: undefined });
  return entries.map((entry) => ({ ...entry, missing: entry.value === undefined }));
}
export function propertyVariants(schema: Schema): Schema[] {
  const choices = variants(schema);
  return choices.some(
    (choice) => schemaTypes(choice).length || choice.enum || Object.hasOwn(choice, 'const'),
  )
    ? choices
    : ['string', 'object', 'array', 'number', 'boolean', 'null'].map((type) => ({ type }));
}
export function currentVariant(schema: Schema, value: unknown): Schema {
  const choices = propertyVariants(schema);
  if (schemaTypes(schema).length || choices.length === variants(schema).length)
    return choices[variantIndex(schema, value)] ?? choices[0];
  const type = valueType(value);
  return (
    choices.find(
      (choice) => choice.type === type || (type === 'integer' && choice.type === 'number'),
    ) ?? choices[0]
  );
}
export function canAddProperty(state: Snapshot, path: Path): boolean {
  const value = at(state.model, path);
  const schema = propertySchema(state, path);
  if (Array.isArray(value) || schemaTypes(schema).includes('array')) return true;
  return (
    Object.keys(schema.properties ?? {}).some((key) => !Object.hasOwn(value ?? {}, key)) ||
    Object.keys(schema.patternProperties ?? {}).length > 0 ||
    (schema.additionalProperties !== false && schema.unevaluatedProperties !== false)
  );
}
export function propertyPreview(value: unknown): string {
  if (value === undefined) return 'Not set';
  if (value === null) return 'Default';
  if (Array.isArray(value))
    return value.length
      ? value
          .map((item) =>
            item && typeof item === 'object'
              ? typeof item.source === 'string'
                ? `${item.source}${item.target ? ' → ' + item.target : ''}`
                : Object.keys(item).join(', ')
              : String(item),
          )
          .join(', ')
          .slice(0, 180)
      : 'Empty list';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length
      ? entries
          .map(([key, item]) =>
            item === null || typeof item === 'object' ? key : `${key}=${String(item)}`,
          )
          .join(', ')
          .slice(0, 180)
      : 'Empty object';
  }
  return String(value).replace(/\n/g, ' ↵ ').slice(0, 180);
}
