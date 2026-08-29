import Model from '../../lib/facade.js';
import outreachReportSchema from './outreach-report-schema.js';

class OutreachReportModel extends Model {
  findOneAndDelete(query: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.Schema.findOneAndDelete(query).lean().exec() as unknown as Promise<Record<string, unknown> | null>;
  }
}

export default new OutreachReportModel(outreachReportSchema);
