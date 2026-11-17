// Checks a Dependabot configuration (DAN-922): one YAML document, valid under the
// SchemaStore dependabot-2.0 schema vendored in scripts/dependabot/ (pinned by
// sha256, so the check needs no network), plus the repository rule: weekly npm
// and github-actions updates, each with at least one group. Run by
// test/dependabot.test.ts in `pnpm test`. Same pattern as ductura/.github.
import { createHash } from 'node:crypto';
import { Ajv, type ValidateFunction } from 'ajv';
import { parseAllDocuments } from 'yaml';

// SchemaStore/schemastore 2d47a4b71131d25133e2908e312c0133a668cdab, src/schemas/json/dependabot-2.0.json
export const SCHEMA_SHA256 = '814298f5cdcf8701a52d6974958423aa8bd002551466d3d306f66e163040336d';
const REQUIRED_ECOSYSTEMS = ['npm', 'github-actions'];

/** Parses the vendored schema bytes; any other content fails closed. */
export const loadSchema = (bytes: Buffer): object => {
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== SCHEMA_SHA256) throw new Error(`schema sha256 ${sha} is not the pinned ${SCHEMA_SHA256}`);
  return JSON.parse(bytes.toString('utf8')) as object;
};

const validators = new WeakMap<object, ValidateFunction>();
const validatorFor = (schema: object): ValidateFunction => {
  let validate = validators.get(schema);
  if (!validate) {
    // strict mode stays on; only the schema's editor annotation is declared.
    const ajv = new Ajv({ strict: true, allErrors: true });
    ajv.addKeyword({ keyword: 'x-intellij-enum-metadata' });
    validate = ajv.compile(schema);
    validators.set(schema, validate);
  }
  return validate;
};

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns every problem in the configuration text; an empty list means it passes. */
export const checkDependabot = (text: string, schema: object): string[] => {
  const docs = parseAllDocuments(text, { uniqueKeys: true });
  if (!Array.isArray(docs) || docs.length !== 1) return ['expected one YAML document'];
  const doc = docs[0]!;
  if (doc.errors.length) return doc.errors.map((e) => `YAML: ${e.message}`);
  const config: unknown = doc.toJS();
  if (!isMap(config)) return ['the document is not a mapping'];

  const validate = validatorFor(schema);
  if (!validate(config)) return (validate.errors ?? []).map((e) => `schema: ${e.instancePath || '/'} ${e.message ?? ''}`);

  // The schema guarantees updates is a list of mappings.
  const updates = config['updates'] as Record<string, unknown>[];
  const problems = REQUIRED_ECOSYSTEMS.filter((eco) => !updates.some((u) => u['package-ecosystem'] === eco)).map(
    (eco) => `no ${eco} entry`,
  );
  updates.forEach((u, i) => {
    const schedule = u['schedule'];
    if (!isMap(schedule) || schedule['interval'] !== 'weekly') problems.push(`updates[${i}] interval is not weekly`);
    const groups = u['groups'];
    if (!isMap(groups) || Object.keys(groups).length === 0) problems.push(`updates[${i}] has no group`);
  });
  return problems;
};
