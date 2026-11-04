import Ajv2020 from 'ajv/dist/2020';
import { composeSchema, type Model, type Path } from './schema';
import type { Issue } from './protocol';
import { relations, serviceReferences, wouldCycle } from './relations';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  validateFormats: false,
});
const validate = ajv.compile(composeSchema);
export function validateModel(model: Model): Issue[] {
  validate(model);
  const issues: Issue[] = (validate.errors ?? []).map((error) => {
    const path: Path = error.instancePath
      .split('/')
      .slice(1)
      .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    const extra =
      error.params.additionalProperty ??
      error.params.unevaluatedProperty ??
      error.params.missingProperty;
    if (extra) path.push(extra);
    return { path, message: error.message ?? 'Invalid value', severity: 'error', source: 'schema' };
  });
  const deduped = [
    ...new Map(issues.map((issue) => [`${issue.path.join('/')}:${issue.message}`, issue])).values(),
  ];
  const composed =
    !!model.include ||
    Object.values<any>(model.services ?? {}).some((service) => service?.extends?.file);
  for (const relation of relations(model)) {
    if (relation.target.includes('${')) continue;
    if (
      !Object.hasOwn(model[relation.targetKind] ?? {}, relation.target) &&
      !(relation.targetKind === 'networks' && relation.target === 'default')
    ) {
      deduped.push({
        path: relation.path,
        message: `${relation.targetKind}.${relation.target} is not declared${composed ? ' locally; check included files' : ''}.`,
        severity: composed ? 'warning' : 'error',
        source: 'reference',
      });
    }
    if (
      relation.sourceKind === 'services' &&
      relation.targetKind === 'services' &&
      wouldCycle(model, relation.source, relation.target)
    )
      deduped.push({
        path: relation.path,
        message: 'Circular service dependency.',
        severity: 'error',
        source: 'reference',
      });
  }
  for (const reference of serviceReferences(model))
    if (!reference.name.includes('${') && !Object.hasOwn(model.services ?? {}, reference.name))
      deduped.push({
        path: reference.path,
        message: `Service ${reference.name} is not declared${composed ? ' locally' : ''}.`,
        severity: composed ? 'warning' : 'error',
        source: 'reference',
      });
  for (const kind of ['services', 'jobs'])
    for (const [name, service] of Object.entries<any>(model[kind] ?? {}))
      if (service?.network_mode && service?.networks)
        deduped.push({
          path: [kind, name, 'networks'],
          message: 'networks and network_mode cannot be used together.',
          severity: 'error',
          source: 'reference',
        });
  return deduped;
}
