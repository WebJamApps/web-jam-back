import app from '#src/index.js';
import venueModel from '#src/model/venue/venue-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

describe('Venue Router (PATCH and PUT /venue/:id)', () => {
  let r: ApiResponse, agentUser: { _id: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];

  beforeAll(async () => {
    await venueModel.deleteMany({});
    await userModel.deleteMany({});
    const createdUser = await userModel.create({
      name: 'agent-test',
      email: 'agent-venue-router@example.com',
      privileges: ['venue:create', 'venue:edit', 'venue:delete'],
    }) as unknown as { _id: { toString(): string } };
    agentUser = { _id: createdUser._id.toString() };
  });

  beforeEach(async () => {
    await venueModel.deleteMany({});
  });

  it('updates a venue using PATCH /venue/:id with partial-merge semantics (#990)', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
      phone: '540-555-0100',
    }) as unknown as { _id: { toString(): string }; name: string; city: string; phone: string };

    r = await request(app)
      .patch(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({ phone: '540-555-0199' });

    expect(r.status).toBe(200);
    expect(r.body.phone).toBe('540-555-0199');
    expect(r.body.name).toBe('The Spot on Kirk');
    expect(r.body.city).toBe('Roanoke');
  });

  it('updates a venue using PUT /venue/:id with identical partial-merge semantics (#990)', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
      phone: '540-555-0100',
    }) as unknown as { _id: { toString(): string }; name: string; city: string; phone: string };

    r = await request(app)
      .put(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({ phone: '540-555-0200' });

    expect(r.status).toBe(200);
    expect(r.body.phone).toBe('540-555-0200');
    expect(r.body.name).toBe('The Spot on Kirk');
    expect(r.body.city).toBe('Roanoke');
  });

  it('enforces address validation rules identically on both PATCH and PUT /venue/:id (#987/#990)', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
    }) as unknown as { _id: { toString(): string } };

    // Attempting to remove address when one is already set fails on PATCH
    r = await request(app)
      .patch(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({ address: '' });

    expect(r.status).toBe(400);
    expect(r.body.message).toContain('cannot be removed');

    // Attempting to remove address when one is already set fails identically on PUT
    r = await request(app)
      .put(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({ address: '' });

    expect(r.status).toBe(400);
    expect(r.body.message).toContain('cannot be removed');
  });
});
