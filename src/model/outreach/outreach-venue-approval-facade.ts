import Model from '../../lib/facade.js';
import outreachVenueApprovalSchema from './outreach-venue-approval-schema.js';

class OutreachVenueApprovalModel extends Model {
  findOneAndDelete(query: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.Schema.findOneAndDelete(query).lean().exec() as unknown as Promise<Record<string, unknown> | null>;
  }
}

export default new OutreachVenueApprovalModel(outreachVenueApprovalSchema);
