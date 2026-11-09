import mongoose from 'mongoose';
import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request from '../../helpers/api.js';

describe('POST /gig and PUT /gig/:id capabilities', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  let callerId: string;
  let gigId: string;

  const createGig = (body?: Record<string, unknown>, userId = callerId) => request(app)
    .post('/gig')
    .set({ origin: allowedUrl })
    .set('Authorization', `Bearer ${authUtils.createJWT({ _id: userId })}`)
    .send(body ?? { venue: 'Write-check fixture' });

  const editGig = (body?: Record<string, unknown>, id = gigId, userId = callerId) => request(app)
    .put(`/gig/${id}`)
    .set({ origin: allowedUrl })
    .set('Authorization', `Bearer ${authUtils.createJWT({ _id: userId })}`)
    .send(body ?? { venue: 'Updated fixture' });

  const deleteGig = (id = gigId, userId = callerId) => request(app)
    .delete(`/gig/${id}`)
    .set({ origin: allowedUrl })
    .set('Authorization', `Bearer ${authUtils.createJWT({ _id: userId })}`);

  beforeEach(async () => {
    await userModel.deleteMany({ email: { $in: ['gig-write-caller@example.com', 'tim-scoped-caller@example.com'] } });
    await GigModel.deleteMany({ venue: { $in: ['Write-check fixture', 'Updated fixture', 'Tim fixture', 'JaM fixture'] } });
    const caller = await userModel.create({
      name: 'Write caller', email: 'gig-write-caller@example.com', privileges: ['venue:edit'],
    });
    callerId = String(caller._id);
    const gig = await GigModel.create({ venue: 'Write-check fixture' });
    gigId = String(gig._id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await userModel.deleteMany({ email: { $in: ['gig-write-caller@example.com', 'tim-scoped-caller@example.com'] } });
    await GigModel.deleteMany({ venue: { $in: ['Write-check fixture', 'Updated fixture', 'Tim fixture', 'JaM fixture'] } });
  });

  // Case 1: A caller holding gig:create, or tour:create, creates a gig (201).
  it.each(['gig:create', 'tour:create'])('allows %s to create a gig (201)', async (capability) => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [capability] });
    const response = await createGig({ venue: 'Updated fixture' });
    expect(response.status).toBe(201);
    expect(response.body.venue).toBe('Updated fixture');
    expect(await GigModel.findById(String(response.body._id))).not.toBeNull();
  });

  // Case 2: A caller holding only venue:edit is refused on create (403) and nothing is written.
  it.each(['venue:edit', 'gig:edit', 'gig:delete', 'gig:announce'])(
    'refuses %s on create (403) and writes nothing',
    async (capability) => {
      await userModel.findByIdAndUpdate(callerId, { privileges: [capability] });
      const response = await createGig({ venue: 'Updated fixture' });
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('missing gig:create/tour:create capability');
      expect(await GigModel.find({ venue: 'Updated fixture' })).toHaveLength(0);
    },
  );

  // Case 3: A caller with no privileges list and the role JaM-admin or Developer may create, edit and delete.
  it.each(['JaM-admin', 'Developer'])(
    'allows %s with no privileges list to create, edit and delete',
    async (role) => {
      await userModel.findByIdAndUpdate(callerId, { userType: role, privileges: [] });

      const created = await createGig({ venue: 'Updated fixture' });
      expect(created.status).toBe(201);
      const createdId = String(created.body._id);

      const edited = await editGig({ venue: 'Write-check fixture' }, createdId);
      expect(edited.status).toBe(200);
      expect(edited.body.venue).toBe('Write-check fixture');

      const deleted = await deleteGig(createdId);
      expect(deleted.status).toBe(200);
      expect(await GigModel.findById(createdId)).toBeNull();
    },
  );

  // Case 4: A caller with no privileges list and no role (a fresh Google sign-in) is refused on create, edit and delete.
  it('refuses a caller with no privileges list and no role on create, edit and delete (403)', async () => {
    await userModel.findByIdAndUpdate(callerId, { userType: '', privileges: [] });

    const created = await createGig({ venue: 'Updated fixture' });
    expect(created.status).toBe(403);
    expect(created.body.message).toBe('not authorized for gig:create/tour:create');
    expect(await GigModel.find({ venue: 'Updated fixture' })).toHaveLength(0);

    const edited = await editGig({ venue: 'Updated fixture' });
    expect(edited.status).toBe(403);
    expect(edited.body.message).toBe('not authorized for gig:edit/tour:edit');
    expect((await GigModel.findById(gigId))?.venue).toBe('Write-check fixture');

    const deleted = await deleteGig();
    expect(deleted.status).toBe(403);
    expect(deleted.body.message).toBe('not authorized for gig:delete/tour:delete');
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  // Case 5: A token naming an account that cannot be found is refused (401).
  it('refuses a token naming an account that cannot be found on create, edit and delete (401)', async () => {
    const missingUserId = new mongoose.Types.ObjectId().toString();

    const created = await createGig({ venue: 'Updated fixture' }, missingUserId);
    expect(created.status).toBe(401);
    expect(await GigModel.find({ venue: 'Updated fixture' })).toHaveLength(0);

    const edited = await editGig({ venue: 'Updated fixture' }, gigId, missingUserId);
    expect(edited.status).toBe(401);
    expect((await GigModel.findById(gigId))?.venue).toBe('Write-check fixture');

    const deleted = await deleteGig(gigId, missingUserId);
    expect(deleted.status).toBe(401);
    expect(await GigModel.findById(gigId)).not.toBeNull();
  });

  // Case 6: gig:edit or tour:edit may edit; a caller holding only gig:create is refused (403).
  it.each(['gig:edit', 'tour:edit'])('allows %s to edit a gig (200)', async (capability) => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [capability] });
    const response = await editGig({ venue: 'Updated fixture' });
    expect(response.status).toBe(200);
    expect(response.body.venue).toBe('Updated fixture');
    expect((await GigModel.findById(gigId))?.venue).toBe('Updated fixture');
  });

  it.each(['gig:create', 'venue:edit', 'gig:delete', 'gig:announce'])(
    'refuses %s on edit (403) without changing the gig',
    async (capability) => {
      await userModel.findByIdAndUpdate(callerId, { privileges: [capability] });
      const response = await editGig({ venue: 'Updated fixture' });
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('missing gig:edit/tour:edit capability');
      expect((await GigModel.findById(gigId))?.venue).toBe('Write-check fixture');
    },
  );

  // Case 9: A caller tied to Tim's artist and holding gig:edit or gig:delete changes Tim's gigs,
  // is refused on another artist's gigs (403), and cannot move a gig to another artist.
  it('enforces artist scoping alongside gig:edit and gig:delete for a caller tied to Tim', async () => {
    const timCaller = await userModel.create({
      name: 'Tim caller',
      email: 'tim-scoped-caller@example.com',
      artist: 'tim',
      privileges: ['gig:edit'],
    });
    const timCallerId = String(timCaller._id);
    const timGig = await GigModel.create({ venue: 'Tim fixture', artist: 'tim' });
    const jamGig = await GigModel.create({ venue: 'JaM fixture', artist: 'jammusic' });

    const editedOwn = await editGig({ venue: 'Updated fixture' }, String(timGig._id), timCallerId);
    expect(editedOwn.status).toBe(200);
    expect(editedOwn.body.venue).toBe('Updated fixture');

    const refusedOtherEdit = await editGig({ venue: 'Updated fixture' }, String(jamGig._id), timCallerId);
    expect(refusedOtherEdit.status).toBe(403);
    expect(refusedOtherEdit.body.message).toBe('not authorized for this artist');
    expect((await GigModel.findById(String(jamGig._id)))?.venue).toBe('JaM fixture');

    const refusedMove = await editGig({ artist: 'jammusic' }, String(timGig._id), timCallerId);
    expect(refusedMove.status).toBe(403);
    expect(refusedMove.body.message).toBe('not authorized for this artist');
    expect((await GigModel.findById(String(timGig._id)))?.artist).toBe('tim');

    await userModel.findByIdAndUpdate(timCallerId, { privileges: ['gig:delete'] });
    const refusedOtherDelete = await deleteGig(String(jamGig._id), timCallerId);
    expect(refusedOtherDelete.status).toBe(403);
    expect(refusedOtherDelete.body.message).toBe('not authorized for this artist');
    expect(await GigModel.findById(String(jamGig._id))).not.toBeNull();

    const deletedOwn = await deleteGig(String(timGig._id), timCallerId);
    expect(deletedOwn.status).toBe(200);
    expect(await GigModel.findById(String(timGig._id))).toBeNull();
  });

  it('requires the capability even for an admin with a nonempty privileges list', async () => {
    await userModel.findByIdAndUpdate(callerId, { userType: 'Developer', privileges: ['gig:edit'] });
    expect((await createGig({ venue: 'Updated fixture' })).status).toBe(403);
    expect(await GigModel.find({ venue: 'Updated fixture' })).toHaveLength(0);

    await userModel.findByIdAndUpdate(callerId, { userType: 'Developer', privileges: ['gig:create'] });
    expect((await editGig({ venue: 'Updated fixture' })).status).toBe(403);
    expect((await GigModel.findById(gigId))?.venue).toBe('Write-check fixture');
  });

  it('checks capabilities before a malformed id on edit', async () => {
    await userModel.findByIdAndUpdate(callerId, { privileges: [] });
    const lookup = vi.spyOn(GigModel, 'findById');
    const update = vi.spyOn(GigModel, 'findByIdAndUpdate');
    expect((await editGig({ venue: 'Updated fixture' }, 'not-an-id')).status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    await userModel.findByIdAndUpdate(callerId, { privileges: ['gig:edit'] });
    expect((await editGig({ venue: 'Updated fixture' }, 'not-an-id')).status).toBe(400);
  });

  it('refuses an unsigned request on create and edit without writing anything', async () => {
    const createRes = await request(app).post('/gig').set({ origin: allowedUrl }).send({ venue: 'Updated fixture' });
    expect(createRes.status).toBe(401);
    expect(await GigModel.find({ venue: 'Updated fixture' })).toHaveLength(0);

    const editRes = await request(app).put(`/gig/${gigId}`).set({ origin: allowedUrl }).send({ venue: 'Updated fixture' });
    expect(editRes.status).toBe(401);
    expect((await GigModel.findById(gigId))?.venue).toBe('Write-check fixture');
  });

  it('returns 500 on an authorization lookup error on create and edit without writing anything', async () => {
    vi.spyOn(userModel, 'findById').mockRejectedValue(new Error('authorization lookup failed'));

    const createRes = await createGig({ venue: 'Updated fixture' });
    expect(createRes.status).toBe(500);
    expect(createRes.body.message).toBe('authorization lookup failed');
    expect(await GigModel.find({ venue: 'Updated fixture' })).toHaveLength(0);

    const editRes = await editGig({ venue: 'Updated fixture' });
    expect(editRes.status).toBe(500);
    expect(editRes.body.message).toBe('authorization lookup failed');
    expect((await GigModel.findById(gigId))?.venue).toBe('Write-check fixture');
  });
});
