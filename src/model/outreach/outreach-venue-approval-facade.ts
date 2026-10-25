import Model from '../../lib/facade.js';
import outreachVenueApprovalSchema from './outreach-venue-approval-schema.js';
import { venueApprovalTime } from './pitch-eligibility.js';

export class VenueApprovalRevisionError extends Error {}

export function preserveVenueApprovalTimes(
  venueIds: string[],
  existing: Record<string, unknown> | null,
  renewedIds: string[],
  approvedAt: Date,
): { venueId: string; approvedAt: Date }[] {
  if (existing && !Array.isArray(existing.venueIds)) throw new Error('cannot read the stored Gate 1 venue set');
  const previous = new Set(((existing?.venueIds as unknown[]) || []).map(String));
  if ([...previous].some((id) => !venueIds.includes(id))) {
    throw new VenueApprovalRevisionError('Gate 1 venue set may only be widened; carried-over venues cannot be removed');
  }
  const renewed = new Set(renewedIds);
  return [...new Set(venueIds)].flatMap((venueId) => {
    if (!previous.has(venueId) || renewed.has(venueId)) return [{ venueId, approvedAt }];
    const priorTime = venueApprovalTime(existing!, venueId);
    // A legacy approval has no reliable per-venue time. Do not manufacture a
    // fresh approval for it just because the set was widened.
    return priorTime === null ? [] : [{ venueId, approvedAt: new Date(priorTime) }];
  });
}

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
