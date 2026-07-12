import type { QueryFilter } from 'mongoose';
import Model from '../../lib/facade.js';
import setlistSchema from './setlist-schema.js';
import { resolveSetlistDoc } from './setlist-resolve.js';

type AnyDoc = Record<string, unknown>;

// Overrides the base Facade's find/findById so the hybrid songId reference
// actually resolves: populate('items.songId') pulls in the referenced Song,
// then resolveSetlistDoc collapses each item to the uniform effective shape
// (title/artist/playLink from the Song when songId is set, else the item's
// own inline fields) — web-jam-back#946. lean() + populate() together are
// fine; the prior bug was the missing populate, not lean itself.
class SetlistModel extends Model {
  find(query: QueryFilter<AnyDoc>): Promise<AnyDoc[]> {
    return this.Schema.find(query).populate('items.songId').lean().exec()
      .then((docs) => (docs as AnyDoc[]).map((doc) => resolveSetlistDoc(doc))) as unknown as Promise<AnyDoc[]>;
  }

  findById(id: string): Promise<AnyDoc | null> {
    return this.Schema.findById(id).populate('items.songId').lean().exec()
      .then((doc) => (doc ? resolveSetlistDoc(doc as AnyDoc) : null)) as unknown as Promise<AnyDoc | null>;
  }
}

export default new SetlistModel(setlistSchema);
