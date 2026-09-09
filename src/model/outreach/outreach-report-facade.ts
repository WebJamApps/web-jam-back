import Model from '../../lib/facade.js';
import outreachReportSchema from './outreach-report-schema.js';

class OutreachReportModel extends Model {
  findOneAndDelete(query: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.Schema.findOneAndDelete(query).lean().exec() as unknown as Promise<Record<string, unknown> | null>;
  }

  // GET /outreach/report index (web-jam-back#1084, D-52/D-53) — every stored
  // report, newest-updated first, with `htmlContent` projected away so
  // listing many weekends doesn't transfer many rendered pages. The index is
  // a live view over this same collection: it holds no record of its own, so
  // a report removed by findOneAndDelete above disappears from it in the
  // same action.
  listIndex(): Promise<Record<string, unknown>[]> {
    return this.Schema.find({}, '-htmlContent').sort({ updated_at: -1 })
      .lean().exec() as unknown as Promise<Record<string, unknown>[]>;
  }
}

export default new OutreachReportModel(outreachReportSchema);
