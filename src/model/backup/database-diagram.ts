import mongoose from 'mongoose';
import type { DbLike } from '#src/lib/backup-export.js';

// Pre-import all record definitions to ensure they are registered with mongoose.
import '#src/model/book/book-schema.js';
import '#src/model/facebook/facebook-schema.js';
import '#src/model/gig/gig-schema.js';
import '#src/model/outreach/outreach-schema.js';
import '#src/model/outreach/outreach-dispatch-schema.js';
import '#src/model/outreach/outreach-draft-approval-schema.js';
import '#src/model/outreach/outreach-report-schema.js';
import '#src/model/outreach/outreach-venue-approval-schema.js';
import '#src/model/setlist/setlist-schema.js';
import '#src/model/song/song-schema.js';
import '#src/model/subscriber/subscriber-schema.js';
import '#src/model/template/template-schema.js';
import '#src/model/user/user-schema.js';
import '#src/model/venue/venue-schema.js';
import '#src/model/venue-mining-sweep/venue-mining-sweep-schema.js';

export interface DiagramOptions {
  db?: DbLike;
  extraCollections?: string[];
}

export interface PathOptionsLike {
  unique?: boolean;
  ref?: string;
  index?: { unique?: boolean } | boolean;
  _index?: { unique?: boolean } | boolean;
  type?: unknown;
}

export interface SchemaTypeLike {
  instance?: string;
  options?: PathOptionsLike;
  caster?: {
    options?: PathOptionsLike;
  };
}

export interface EntityDef {
  name: string;
  fields: string[];
}

export interface RelationshipDef {
  source: string;
  target: string;
  field: string;
}

export function mapMongooseType(instance?: string): string {
  if (!instance) return 'string';
  switch (instance) {
    case 'String': return 'string';
    case 'Number': return 'number';
    case 'Date': return 'date';
    case 'Boolean': return 'boolean';
    case 'ObjectID':
    case 'ObjectId': return 'objectId';
    case 'Array': return 'array';
    case 'Mixed': return 'mixed';
    case 'Buffer': return 'buffer';
    case 'Map': return 'map';
    case 'Decimal128': return 'decimal';
    case 'Embedded': return 'object';
    case 'DocumentArray': return 'array';
    default: return instance.toLowerCase();
  }
}

export function isFieldUnique(schemaType: SchemaTypeLike): boolean {
  const opts = schemaType.options;
  if (!opts) return false;
  if (opts.unique === true) return true;
  if (opts.index && typeof opts.index === 'object' && opts.index.unique === true) return true;
  if (opts._index && typeof opts._index === 'object' && opts._index.unique === true) return true;
  return false;
}

export function getRefTarget(schemaType: SchemaTypeLike): string | null {
  const opts = schemaType.options;
  if (opts?.ref && typeof opts.ref === 'string') {
    return opts.ref;
  }
  if (schemaType.caster?.options?.ref && typeof schemaType.caster.options.ref === 'string') {
    return schemaType.caster.options.ref;
  }
  if (Array.isArray(opts?.type) && (opts.type[0] as PathOptionsLike)?.ref && typeof (opts.type[0] as PathOptionsLike).ref === 'string') {
    return (opts.type[0] as PathOptionsLike).ref as string;
  }
  return null;
}

export interface RawFieldDef {
  sanitizedField: string;
  line: string;
}

export interface SchemaLike {
  paths: Record<string, unknown>;
}

export function collectSchemaFieldsAndRefs(
  modelName: string,
  schema: SchemaLike,
  prefix = '',
  ancestors: Set<unknown> = new Set(),
): { rawFields: RawFieldDef[]; relationships: RelationshipDef[] } {
  if (ancestors.has(schema)) {
    return { rawFields: [], relationships: [] };
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(schema);

  const rawFields: RawFieldDef[] = [];
  const relationships: RelationshipDef[] = [];
  const schemaPaths = schema.paths as Record<string, SchemaTypeLike>;
  const pathKeys = Object.keys(schemaPaths).sort();

  for (const pathKey of pathKeys) {
    const schemaType = schemaPaths[pathKey];
    const fullPath = prefix ? `${prefix}.${pathKey}` : pathKey;
    const sanitizedField = fullPath.replace(/\./g, '_');
    const typeStr = mapMongooseType(schemaType.instance);
    const uniqueMark = isFieldUnique(schemaType) ? ' UK' : '';
    rawFields.push({
      sanitizedField,
      line: `        ${typeStr} ${sanitizedField}${uniqueMark}`,
    });

    const refTarget = getRefTarget(schemaType);
    if (refTarget) {
      relationships.push({
        source: modelName,
        target: refTarget,
        field: sanitizedField,
      });
    }

    const subSchema = (schemaType as { schema?: SchemaLike; caster?: { schema?: SchemaLike } }).schema
      || (schemaType as { schema?: SchemaLike; caster?: { schema?: SchemaLike } }).caster?.schema;
    if (subSchema && subSchema.paths) {
      const sub = collectSchemaFieldsAndRefs(modelName, subSchema, fullPath, nextAncestors);
      rawFields.push(...sub.rawFields);
      relationships.push(...sub.relationships);
    }
  }

  return { rawFields, relationships };
}

function extractModelEntityAndRefs(
  modelName: string,
): { entity: EntityDef; relationships: RelationshipDef[]; collectionName: string } {
  const model = mongoose.model(modelName);
  const { rawFields, relationships } = collectSchemaFieldsAndRefs(modelName, model.schema);

  rawFields.sort((a, b) => a.sanitizedField.localeCompare(b.sanitizedField));
  const fields = rawFields.map((f) => f.line);

  return {
    entity: { name: modelName, fields },
    relationships,
    collectionName: model.collection.name,
  };
}

async function discoverExtraCollections(
  dbHandle?: DbLike,
  registeredCollections?: Set<string>,
  modelNames?: string[],
  initialExtra?: string[],
): Promise<string[]> {
  const extraSet = new Set<string>(initialExtra || []);
  if (!dbHandle || typeof dbHandle.listCollections !== 'function') {
    return [...extraSet].sort();
  }

  try {
    const dbCols = await dbHandle.listCollections().toArray();
    for (const col of dbCols) {
      if (!registeredCollections?.has(col.name) && !modelNames?.includes(col.name)) {
        extraSet.add(col.name);
      }
    }
  } catch {
    // Ignore collection listing errors if db cannot be queried
  }

  return [...extraSet].sort();
}

function resolveOptions(optionsOrCols?: DiagramOptions | string[] | DbLike): DiagramOptions {
  if (Array.isArray(optionsOrCols)) {
    return { extraCollections: optionsOrCols };
  }
  if (optionsOrCols && 'listCollections' in optionsOrCols) {
    return { db: optionsOrCols as DbLike };
  }
  if (optionsOrCols) {
    return optionsOrCols;
  }
  return {};
}

export async function generateDatabaseDiagram(
  optionsOrCols?: DiagramOptions | string[] | DbLike,
): Promise<string> {
  const opts = resolveOptions(optionsOrCols);
  const modelNames = [...mongoose.modelNames()].sort();
  const registeredCollections = new Set<string>();
  const entities: EntityDef[] = [];
  const relationships: RelationshipDef[] = [];

  for (const modelName of modelNames) {
    const { entity, relationships: modelRels, collectionName } = extractModelEntityAndRefs(modelName);
    registeredCollections.add(collectionName);
    entities.push(entity);
    relationships.push(...modelRels);
  }

  const dbHandle = opts.db
    || (mongoose.connection && mongoose.connection.readyState === 1
      ? (mongoose.connection.db as unknown as DbLike)
      : undefined);

  const extraCollections = await discoverExtraCollections(
    dbHandle,
    registeredCollections,
    modelNames,
    opts.extraCollections,
  );

  for (const colName of extraCollections) {
    entities.push({ name: colName, fields: [] });
  }

  relationships.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    return a.field.localeCompare(b.field);
  });

  entities.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = ['erDiagram'];
  for (const rel of relationships) {
    lines.push(`    ${rel.source} }o--|| ${rel.target} : ${rel.field}`);
  }
  for (const ent of entities) {
    lines.push(`    ${ent.name} {`);
    for (const f of ent.fields) {
      lines.push(f);
    }
    lines.push('    }');
  }

  return lines.join('\n');
}

export default {
  generateDatabaseDiagram,
  mapMongooseType,
  isFieldUnique,
  getRefTarget,
  collectSchemaFieldsAndRefs,
};
