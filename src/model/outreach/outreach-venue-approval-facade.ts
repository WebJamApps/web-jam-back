import Model from '../../lib/facade.js';
import outreachVenueApprovalSchema from './outreach-venue-approval-schema.js';

const DEFAULT_SORT: Record<string, 1 | -1> = { createdAt: -1, _id: -1 };

class OutreachVenueApprovalModel extends Model {
  findOneAndDelete(query: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.Schema.findOneAndDelete(query).lean().exec() as unknown as Promise<Record<string, unknown> | null>;
  }

  findLatestOne(
    query: Record<string, unknown>,
    sort: Record<string, 1 | -1> = DEFAULT_SORT,
  ): Promise<Record<string, unknown> | null> {
    return this.Schema.findOne(query).sort(sort).lean().exec() as unknown as Promise<Record<string, unknown> | null>;
  }
}

export default new OutreachVenueApprovalModel(outreachVenueApprovalSchema);
