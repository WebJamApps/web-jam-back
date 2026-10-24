import mongoose from 'mongoose';
import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request from '../../helpers/api.js';

describe('DELETE /gig/:id capabilities', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  let callerId: string;
  let gigId: string;

  const deleteGig = (id = gigId, userId = callerId) => request(app).delete(`/gig/${id}`)
    .set({ origin: allowedUrl }).set('Authorization', `Bearer ${authUtils.createJWT({ _id: userId })}`);

  beforeEach(async () => {
    await userModel.deleteMany({ email: 'gig-delete-caller@example.com' });
    await GigModel.deleteMany({ venue: 'Single-delete fixture' });
    const caller = await userModel.create({ name: 'Delete caller', email: 'gig-delete-caller@example.com', privileges: ['gig:edit'] });
    callerId = String(caller._id);
    const gig = await GigModel.create({ venue: 'Single-delete fixture' });
    gigId = String(gig._id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await userModel.deleteMany({ email: 'gig-delete-caller@example.com' });
    await GigModel.deleteMany({ venue: 'Single-delete fixture' });
  });

  it.each(['gig:delete', 'tour:delete'])('allows %s to delete only the named gig', async (capability) => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [capability] });
    const otherGig = await GigModel.create({ venue: 'Single-delete fixture', artist: 'tim' });
    const response = await deleteGig();
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Gig was deleted successfully');
    expect(await GigModel.findById(gigId)).toBeNull();
    expect(await GigModel.findById(String(otherGig._id))).not.toBeNull();
  });

  it.each(['gig:edit', 'gig:create', 'gig:announce'])('refuses %s without deleting anything', async (capability) => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [capability] });
    const response = await deleteGig();
    expect(response.status).toBe(403);
    expect(response.body.message).toBe('missing gig:delete/tour:delete capability');
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it.each(['JaM-admin', 'Developer'])('allows %s with no privileges through role fallback', async (role) => {
    await userModel.findByIdAndUpdate(callerId, { userType: role, privileges: [] });
    expect((await deleteGig()).status).toBe(200);
    expect(await GigModel.findById(gigId)).toBeNull();
  });

  it('requires the capability even for an admin with a nonempty privileges list', async () => {
    await userModel.findByIdAndUpdate(callerId, { userType: 'Developer', privileges: ['gig:edit'] });
    expect((await deleteGig()).status).toBe(403);
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it('refuses a caller with no role or capabilities', async () => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [] });
    expect((await deleteGig()).status).toBe(403);
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it('checks capabilities before a malformed id', async () => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [] });
    const lookup = vi.spyOn(GigModel, 'findById');
    const deletion = vi.spyOn(GigModel, 'findByIdAndDelete');
    expect((await deleteGig('not-an-id')).status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    expect(deletion).not.toHaveBeenCalled();
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it('keeps id validation for an authorized caller', async () => {
    await userModel.findByIdAndUpdate(callerId, { privileges: ['gig:delete'] });
    expect((await deleteGig('not-an-id')).status).toBe(400);
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it('refuses an unsigned request without deleting anything', async () => {
    const response = await request(app).delete(`/gig/${gigId}`).set({ origin: allowedUrl });
    expect(response.status).toBe(401);
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it('refuses a token whose account does not exist', async () => {
    expect((await deleteGig(gigId, new mongoose.Types.ObjectId().toString())).status).toBe(401);
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  it('returns 500 on an authorization lookup error without deleting anything', async () => {
    vi.spyOn(userModel, 'findById').mockRejectedValue(new Error('authorization lookup failed'));
    const response = await deleteGig();
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('authorization lookup failed');
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });
});
