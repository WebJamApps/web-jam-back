import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  generateDatabaseDiagram,
  mapMongooseType,
  isFieldUnique,
  getRefTarget,
  collectSchemaFieldsAndRefs,
  type SchemaTypeLike,
} from '#src/model/backup/database-diagram.js';

describe('database-diagram', () => {
  describe('type and attribute helpers', () => {
    it('maps Mongoose schema types to lowercase Mermaid types', () => {
      expect(mapMongooseType('String')).toBe('string');
      expect(mapMongooseType('Number')).toBe('number');
      expect(mapMongooseType('Date')).toBe('date');
      expect(mapMongooseType('Boolean')).toBe('boolean');
      expect(mapMongooseType('ObjectID')).toBe('objectId');
      expect(mapMongooseType('ObjectId')).toBe('objectId');
      expect(mapMongooseType('Array')).toBe('array');
      expect(mapMongooseType('Mixed')).toBe('mixed');
      expect(mapMongooseType('Buffer')).toBe('buffer');
      expect(mapMongooseType('Map')).toBe('map');
      expect(mapMongooseType('Decimal128')).toBe('decimal');
      expect(mapMongooseType('Embedded')).toBe('object');
      expect(mapMongooseType('DocumentArray')).toBe('array');
      expect(mapMongooseType(undefined)).toBe('string');
      expect(mapMongooseType('CustomType')).toBe('customtype');
    });

    it('identifies unique fields correctly', () => {
      expect(isFieldUnique({ options: { unique: true } })).toBe(true);
      expect(isFieldUnique({ options: { index: { unique: true } } })).toBe(true);
      expect(isFieldUnique({ options: { _index: { unique: true } } })).toBe(true);
      expect(isFieldUnique({ options: { unique: false } })).toBe(false);
      expect(isFieldUnique({ options: {} })).toBe(false);
      expect(isFieldUnique({})).toBe(false);
    });

    it('identifies reference targets across direct, caster, and array schemas', () => {
      expect(getRefTarget({ options: { ref: 'Venue' } })).toBe('Venue');
      expect(getRefTarget({ caster: { options: { ref: 'Song' } } })).toBe('Song');
      expect(getRefTarget({ options: { type: [{ ref: 'Venue' }] } })).toBe('Venue');
      expect(getRefTarget({ options: {} })).toBeNull();
      expect(getRefTarget({})).toBeNull();
    });

    it('recursively collects embedded schema fields and relationships across nested schemas', () => {
      const setlistModel = mongoose.model('Setlist');
      const { rawFields, relationships } = collectSchemaFieldsAndRefs('Setlist', setlistModel.schema);
      const fieldNames = rawFields.map((f) => f.sanitizedField);

      expect(fieldNames).toContain('items');
      expect(fieldNames).toContain('items_order');
      expect(fieldNames).toContain('items_songId');
      expect(fieldNames).toContain('items_title');
      expect(fieldNames).toContain('items_artist');
      expect(fieldNames).toContain('items_playLink');
      expect(fieldNames).toContain('items_notes');

      const songRel = relationships.find((r) => r.source === 'Setlist' && r.target === 'Song');
      expect(songRel).toBeDefined();
      expect(songRel?.field).toBe('items_songId');
    });
  });

  describe('generateDatabaseDiagram', () => {
    it('loads real record definitions and builds valid Mermaid ER diagram text line by line', async () => {
      const diagram = await generateDatabaseDiagram({ extraCollections: ['jamPics'] });
      const lines = diagram.split('\n');

      // 1. Opens with erDiagram header
      expect(lines[0]).toBe('erDiagram');

      // 2. Line-by-line syntax validation:
      // Every line after line 0 is strictly a relationship line, entity block line, or field line
      const relRegex = /^ {4}[A-Za-z0-9_-]+ \}o--\|\| [A-Za-z0-9_-]+ : [A-Za-z0-9_.-]+$/;
      const entityOpenRegex = /^ {4}[A-Za-z0-9_-]+ \{$/;
      const entityCloseRegex = /^ {4}\}$/;
      const fieldRegex = /^ {8}[a-zA-Z0-9_.-]+ [a-zA-Z0-9_.-]+( UK)?$/;

      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        const isRel = relRegex.test(line);
        const isEntityOpen = entityOpenRegex.test(line);
        const isEntityClose = entityCloseRegex.test(line);
        const isField = fieldRegex.test(line);

        const isValid = isRel || isEntityOpen || isEntityClose || isField;
        expect(isValid, `Line ${i} does not match any Mermaid ER form: "${line}"`).toBe(true);
      }

      // 3. Asserts one entity block per registered record definition
      const registeredModels = [...mongoose.modelNames()];
      expect(registeredModels.length).toBeGreaterThanOrEqual(12);

      for (const modelName of registeredModels) {
        expect(diagram).toContain(`    ${modelName} {`);
      }

      // Helper to extract an entity block from the Mermaid diagram text
      const getEntityBlock = (diagramText: string, entityName: string): string => {
        const match = diagramText.match(new RegExp(` {4}${entityName} \\{([\\s\\S]*?)^ {4}\\}`, 'm'));
        expect(match, `Entity block for ${entityName} should exist`).not.toBeNull();
        return match ? match[1] : '';
      };

      // Recursive helper to collect all expected field lines across parent and embedded schemas
      function collectAllExpectedFieldLines(
        schema: mongoose.Schema,
        prefix = '',
        ancestors: Set<mongoose.Schema> = new Set(),
      ): string[] {
        if (ancestors.has(schema)) return [];
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(schema);

        const lines: string[] = [];
        const schemaPaths = schema.paths as Record<string, SchemaTypeLike>;
        for (const [pathKey, schemaType] of Object.entries(schemaPaths)) {
          const fullPath = prefix ? `${prefix}.${pathKey}` : pathKey;
          const sanitizedField = fullPath.replace(/\./g, '_');
          const typeStr = mapMongooseType(schemaType.instance);
          const isUnique = isFieldUnique(schemaType);
          lines.push(`        ${typeStr} ${sanitizedField}${isUnique ? ' UK' : ''}`);

          const subSchema = (schemaType as { schema?: mongoose.Schema; caster?: { schema?: mongoose.Schema } }).schema
            || (schemaType as { schema?: mongoose.Schema; caster?: { schema?: mongoose.Schema } }).caster?.schema;
          if (subSchema && subSchema.paths) {
            lines.push(...collectAllExpectedFieldLines(subSchema, fullPath, nextAncestors));
          }
        }
        return lines;
      }

      // 4. Asserts all field lines (including recursive embedded fields) within their entity block
      for (const modelName of registeredModels) {
        const model = mongoose.model(modelName);
        const entityBlock = getEntityBlock(diagram, modelName);
        const expectedFieldLines = collectAllExpectedFieldLines(model.schema);

        for (const expectedLine of expectedFieldLines) {
          expect(entityBlock).toContain(expectedLine.trim());
        }
      }

      // 5. Asserts unique marks on known unique fields
      expect(diagram).toContain('        string email UK');
      expect(diagram).toContain('        string url UK');
      expect(diagram).toContain('        string weekend UK');
      expect(diagram).toContain('        string pageId UK');

      // 6. Asserts relationship lines for fields pointing at other collections (direct and embedded)
      expect(diagram).toContain('    Gig }o--|| Venue : venueId');
      expect(diagram).toContain('    Outreach }o--|| Venue : venueId');
      expect(diagram).toContain('    OutreachDispatch }o--|| Venue : venueIds');
      expect(diagram).toContain('    OutreachDispatch }o--|| Venue : attemptedVenueIds');
      expect(diagram).toContain('    OutreachDispatch }o--|| OutreachVenueApproval : venueApprovalId');
      expect(diagram).toContain('    OutreachDispatch }o--|| OutreachDraftApproval : draftApprovalId');
      expect(diagram).toContain('    OutreachVenueApproval }o--|| Venue : venueIds');
      expect(diagram).toContain('    Setlist }o--|| Song : items_songId');
      expect(diagram).toContain('    Venue }o--|| Outreach : touches_outreachId');
      expect(diagram).toContain('    OutreachDraftApproval }o--|| Venue : draftFingerprints_venueId');

      // 7. Independent assertions for real nested fields inside their respective entity blocks
      const setlistBlock = getEntityBlock(diagram, 'Setlist');
      expect(setlistBlock).toContain('array items');
      expect(setlistBlock).toContain('number items_order');
      expect(setlistBlock).toContain('objectId items_songId');
      expect(setlistBlock).toContain('string items_title');
      expect(setlistBlock).toContain('string items_artist');
      expect(setlistBlock).toContain('string items_playLink');
      expect(setlistBlock).toContain('string items_notes');
      expect(setlistBlock).toContain('objectId items__id');

      const venueBlock = getEntityBlock(diagram, 'Venue');
      expect(venueBlock).toContain('array touches');
      expect(venueBlock).toContain('date touches_date');
      expect(venueBlock).toContain('string touches_type');
      expect(venueBlock).toContain('string touches_note');
      expect(venueBlock).toContain('string touches_templateType');
      expect(venueBlock).toContain('object touches_targetWeekend');
      expect(venueBlock).toContain('date touches_targetWeekend_start');
      expect(venueBlock).toContain('date touches_targetWeekend_end');
      expect(venueBlock).toContain('string touches_outcome');
      expect(venueBlock).toContain('date touches_bookedDate');
      expect(venueBlock).toContain('objectId touches_outreachId');
      expect(venueBlock).toContain('string touches_actor');

      const draftApprovalBlock = getEntityBlock(diagram, 'OutreachDraftApproval');
      expect(draftApprovalBlock).toContain('array draftFingerprints');
      expect(draftApprovalBlock).toContain('objectId draftFingerprints_venueId');
      expect(draftApprovalBlock).toContain('string draftFingerprints_fingerprint');
      expect(draftApprovalBlock).toContain('string draftFingerprints_subject');
      expect(draftApprovalBlock).toContain('object targetWeekend');
      expect(draftApprovalBlock).toContain('date targetWeekend_start');
      expect(draftApprovalBlock).toContain('date targetWeekend_end');

      const outreachBlock = getEntityBlock(diagram, 'Outreach');
      expect(outreachBlock).toContain('object targetWeekend');
      expect(outreachBlock).toContain('date targetWeekend_start');
      expect(outreachBlock).toContain('date targetWeekend_end');
      expect(outreachBlock).toContain('object suggestion');
      expect(outreachBlock).toContain('string suggestion_sentiment');
      expect(outreachBlock).toContain('string suggestion_proposedBookingStatus');
      expect(outreachBlock).toContain('boolean suggestion_proposedInterested');
      expect(outreachBlock).toContain('string suggestion_rationale');
      expect(outreachBlock).toContain('string suggestion_model');
      expect(outreachBlock).toContain('boolean suggestion_reviewed');
      expect(outreachBlock).toContain('array followUps');
      expect(outreachBlock).toContain('date followUps_sentAt');
      expect(outreachBlock).toContain('string followUps_type');
      expect(outreachBlock).toContain('string followUps_messageId');
      expect(outreachBlock).toContain('string followUps_eventId');
      expect(outreachBlock).toContain('number followUps_step');

      const sweepBlock = getEntityBlock(diagram, 'VenueMiningSweep');
      expect(sweepBlock).toContain('object publication');
      expect(sweepBlock).toContain('string publication_name');
      expect(sweepBlock).toContain('string publication_url');
      expect(sweepBlock).toContain('string publication_api');
      expect(sweepBlock).toContain('string publication_type');

      // 8. A collection that has no record definition appears as an entity with no fields
      const jamPicsBlock = '    jamPics {\n    }';
      expect(diagram).toContain(jamPicsBlock);
    });

    it('discovers unregistered collections from DbLike listCollections', async () => {
      const mockDb = {
        listCollections: () => ({
          toArray: () => Promise.resolve([
            { name: 'users' }, // registered collection
            { name: 'gigs' }, // registered collection
            { name: 'jamPics' }, // unregistered collection
            { name: 'externalEvents' }, // unregistered collection
          ]),
        }),
        collection: () => ({ find: () => ({ [Symbol.asyncIterator]: async function* () {} }) }),
      };

      const diagram = await generateDatabaseDiagram({ db: mockDb });
      expect(diagram).toContain('    jamPics {\n    }');
      expect(diagram).toContain('    externalEvents {\n    }');
      // Does not create a duplicate entity block for already registered collections
      const userMatches = diagram.match(/ {4}User \{/g);
      expect(userMatches?.length).toBe(1);
    });

    it('handles listCollections failure gracefully', async () => {
      const failingDb = {
        listCollections: () => ({
          toArray: () => Promise.reject(new Error('Mongo connection closed')),
        }),
        collection: () => ({ find: () => ({ [Symbol.asyncIterator]: async function* () {} }) }),
      };

      const diagram = await generateDatabaseDiagram({ db: failingDb });
      expect(diagram.startsWith('erDiagram')).toBe(true);
      expect(diagram).toContain('    User {');
    });

    it('accepts array of extra collections directly', async () => {
      const diagram = await generateDatabaseDiagram(['customCollection']);
      expect(diagram).toContain('    customCollection {\n    }');
    });
  });
});
