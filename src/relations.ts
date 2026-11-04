import { at, resourceSchema, resolveSchema, type Model, type Path } from './schema';

export type Relation = {
  sourceKind: string;
  source: string;
  targetKind: string;
  target: string;
  field: string;
  path: Path;
  suffix?: string;
};
const fields: Record<string, string> = {
  services: 'depends_on',
  networks: 'networks',
  volumes: 'volumes',
  secrets: 'secrets',
  configs: 'configs',
  models: 'models',
};
export function relationField(sourceKind: string, targetKind: string): string | undefined {
  const field = fields[targetKind];
  return field && resolveSchema(resourceSchema(sourceKind)).properties?.[field] ? field : undefined;
}
export function isNamedVolume(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) && !value.includes('${');
}
export function relations(model: Model): Relation[] {
  const result: Relation[] = [];
  function collect(sourceKind: string, source: string, config: any, prefix: Path) {
    if (!config || typeof config !== 'object') return;
    for (const [targetKind, field] of Object.entries(fields)) {
      const value = config[field];
      if (!value) continue;
      if (Array.isArray(value))
        value.forEach((item, index) => {
          let target: string | undefined;
          let suffix: string | undefined;
          if (typeof item === 'string') {
            if (field === 'volumes') {
              // A Windows drive prefix is a bind mount, never a named volume.
              if (/^[a-zA-Z]:[\\/]/.test(item)) return;
              const separator = item.indexOf(':');
              const name = separator < 0 ? '' : item.slice(0, separator);
              if (isNamedVolume(name)) {
                target = name;
                suffix = item.slice(separator);
              }
            } else target = item;
          } else if (item && typeof item === 'object') {
            if (field !== 'volumes' || (item.type === 'volume' && item.source))
              target = item.source;
          }
          if (target)
            result.push({
              sourceKind,
              source,
              targetKind,
              target,
              field,
              path: [...prefix, field, index],
              suffix,
            });
        });
      else if (typeof value === 'object')
        for (const target of Object.keys(value))
          result.push({
            sourceKind,
            source,
            targetKind,
            target,
            field,
            path: [...prefix, field, target],
          });
    }
    if (typeof config.build === 'object' && config.build)
      collect(sourceKind, source, { secrets: config.build.secrets }, [...prefix, 'build']);
    if (Array.isArray(config.pre_start))
      config.pre_start.forEach((hook: any, index: number) =>
        collect(sourceKind, source, hook, [...prefix, 'pre_start', index]),
      );
  }
  for (const sourceKind of ['services', 'jobs'])
    for (const [source, config] of Object.entries(model[sourceKind] ?? {}))
      collect(sourceKind, source, config, [sourceKind, source]);
  return result;
}

export function wouldCycle(model: Model, source: string, target: string): boolean {
  const edges = relations(model).filter(
    (r) => r.sourceKind === 'services' && r.targetKind === 'services',
  );
  const visited = new Set<string>();
  function visit(name: string): boolean {
    if (name === source) return true;
    if (visited.has(name)) return false;
    visited.add(name);
    return edges.filter((edge) => edge.source === name).some((edge) => visit(edge.target));
  }
  return visit(target);
}

/** Additional local service-name references, outside the graph's attachable relationships. */
export function serviceReferences(
  model: Model,
): { path: Path; name: string; replace: (next: string) => any }[] {
  const result: { path: Path; name: string; replace: (next: string) => any }[] = [];
  for (const kind of ['services', 'jobs'])
    for (const [name, config] of Object.entries<any>(model[kind] ?? {})) {
      if (!config || typeof config !== 'object') continue;
      for (const field of ['network_mode', 'ipc', 'pid'])
        if (typeof config[field] === 'string' && config[field].startsWith('service:'))
          result.push({
            path: [kind, name, field],
            name: config[field].slice(8),
            replace: (next) => `service:${next}`,
          });
      for (const field of ['links', 'volumes_from'])
        if (Array.isArray(config[field]))
          config[field].forEach((value: any, index: number) => {
            if (typeof value !== 'string' || value.startsWith('container:')) return;
            const [target, ...suffix] = value.split(':');
            result.push({
              path: [kind, name, field, index],
              name: target,
              replace: (next) => [next, ...suffix].join(':'),
            });
          });
      const ext = config.extends;
      if (kind === 'services' && typeof ext === 'string')
        result.push({ path: [kind, name, 'extends'], name: ext, replace: (next) => next });
      else if (kind === 'services' && ext?.service && !ext.file)
        result.push({
          path: [kind, name, 'extends', 'service'],
          name: ext.service,
          replace: (next) => next,
        });
    }
  return result;
}
