import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  generateDatabaseDiagram,
  mapMongooseType,
  isFieldUnique,
  getRefTarget,
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

      // 4. Asserts each field line within its entity block
      for (const modelName of registeredModels) {
        const model = mongoose.model(modelName);
        const schemaPaths = model.schema.paths as Record<string, SchemaTypeLike>;

        for (const [pathKey, schemaType] of Object.entries(schemaPaths)) {
          const sanitizedField = pathKey.replace(/\./g, '_');
          const typeStr = mapMongooseType(schemaType.instance);
          const isUnique = isFieldUnique(schemaType);
          const expectedFieldLine = `        ${typeStr} ${sanitizedField}${isUnique ? ' UK' : ''}`;
          expect(diagram).toContain(expectedFieldLine);
        }
      }

      // 5. Asserts unique marks on known unique fields
      expect(diagram).toContain('        string email UK');
      expect(diagram).toContain('        string url UK');
      expect(diagram).toContain('        string weekend UK');
      expect(diagram).toContain('        string pageId UK');

      // 6. Asserts relationship lines for fields pointing at other collections
      expect(diagram).toContain('    Gig }o--|| Venue : venueId');
      expect(diagram).toContain('    Outreach }o--|| Venue : venueId');
      expect(diagram).toContain('    OutreachDispatch }o--|| Venue : venueIds');
      expect(diagram).toContain('    OutreachDispatch }o--|| Venue : attemptedVenueIds');
      expect(diagram).toContain('    OutreachDispatch }o--|| OutreachVenueApproval : venueApprovalId');
      expect(diagram).toContain('    OutreachDispatch }o--|| OutreachDraftApproval : draftApprovalId');
      expect(diagram).toContain('    OutreachVenueApproval }o--|| Venue : venueIds');

      // 7. A collection that has no record definition appears as an entity with no fields
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
