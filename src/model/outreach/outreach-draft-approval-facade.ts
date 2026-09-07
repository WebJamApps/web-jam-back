import Model from '../../lib/facade.js';
import outreachDraftApprovalSchema from './outreach-draft-approval-schema.js';

class OutreachDraftApprovalModel extends Model {
  findOneAndDelete(query: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.Schema.findOneAndDelete(query).lean().exec() as unknown as Promise<Record<string, unknown> | null>;
  }
}

export default new OutreachDraftApprovalModel(outreachDraftApprovalSchema);
