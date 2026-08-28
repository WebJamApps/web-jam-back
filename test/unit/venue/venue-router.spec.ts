import app from '#src/index.js';
import venueModel from '#src/model/venue/venue-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

describe('Venue Router (PATCH /venue/:id)', () => {
  let r: ApiResponse, agentUser: { _id: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];

  beforeEach(async () => {
    await venueModel.deleteMany({});
    await userModel.deleteMany({ email: 'agent-venue-router@example.com' });
    const createdUser = await userModel.create({
      name: 'agent-test',
      email: 'agent-venue-router@example.com',
      privileges: ['venue:create', 'venue:edit', 'venue:delete'],
    }) as unknown as { _id: { toString(): string } };
    agentUser = { _id: createdUser._id.toString() };
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

  it('returns 404 for PUT /venue/:id now that PUT is removed (#991)', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
      phone: '540-555-0100',
    }) as unknown as { _id: { toString(): string } };

    r = await request(app)
      .put(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({ phone: '540-555-0200' });

    expect(r.status).toBe(404);
  });

  it('enforces address validation rules on PATCH /venue/:id (#987/#990)', async () => {
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
  });

  it('lists venues using GET /venue', async () => {
    await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
    });

    r = await request(app)
      .get('/venue')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBe(1);
    expect(r.body[0].name).toBe('The Spot on Kirk');
  });

  it('creates a venue using POST /venue', async () => {
    r = await request(app)
      .post('/venue')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({
        name: 'The Golden Pony',
        address: '181 N Main St',
        city: 'Harrisonburg',
        usState: 'Virginia',
      });

    expect(r.status).toBe(201);
    expect(r.body.name).toBe('The Golden Pony');
  });

  it('lists distinct cities using GET /venue/cities', async () => {
    await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
    });

    r = await request(app)
      .get('/venue/cities')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

    expect(r.status).toBe(200);
    expect(r.body).toContain('Roanoke');
  });

  it('gets a single venue by id using GET /venue/:id', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
    }) as unknown as { _id: { toString(): string } };

    r = await request(app)
      .get(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

    expect(r.status).toBe(200);
    expect(r.body.name).toBe('The Spot on Kirk');
  });

  it('archives a venue using DELETE /venue/:id', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
    }) as unknown as { _id: { toString(): string } };

    r = await request(app)
      .delete(`/venue/${venue._id.toString()}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

    expect(r.status).toBe(200);
    expect(r.body.message).toContain('archived successfully');
  });

  it('appends a touch event using POST /venue/:id/touch', async () => {
    const venue = await venueModel.create({
      name: 'The Spot on Kirk',
      address: '22 S Kirk St',
      city: 'Roanoke',
      usState: 'Virginia',
    }) as unknown as { _id: { toString(): string } };

    r = await request(app)
      .post(`/venue/${venue._id.toString()}/touch`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
      .send({
        type: 'call',
        note: 'Spoke with booking manager',
      });

    expect(r.status).toBe(201);
  });
});
