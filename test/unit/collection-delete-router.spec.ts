import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import SetlistModel from '#src/model/setlist/setlist-facade.js';
import BookModel from '#src/model/book/book-facade.js';
import SongModel from '#src/model/song/song-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request from '../helpers/api.js';

const collections = [
  { route: '/gig', model: GigModel, data: { venue: 'Delete-many fixture', artist: 'tim' }, query: { venue: 'Delete-many fixture' } },
  { route: '/setlist', model: SetlistModel, data: { name: 'Delete-many fixture' }, query: { name: 'Delete-many fixture' } },
  {
    route: '/book', model: BookModel,
    data: { title: 'Delete-many fixture', type: 'paperback', artist: 'tim' }, query: { title: 'Delete-many fixture' },
  },
  {
    route: '/song', model: SongModel,
    data: { title: 'Delete-many fixture', artist: 'Test artist', category: 'pub', url: 'https://example.com/delete-many-test.mp3' },
    query: { title: 'Delete-many fixture' },
  },
];

describe.each(collections)('DELETE $route', ({ route, model, data, query }) => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  let adminId: string;
  let recordId: string;

  beforeEach(async () => {
    await userModel.deleteMany({ email: 'collection-delete-admin@example.com' });
    const admin = await userModel.create({ name: 'Delete test admin', email: 'collection-delete-admin@example.com', userType: 'Developer' });
    adminId = String(admin._id);
    await model.deleteMany(query);
    const record = await model.create(data);
    recordId = String(record._id);
  });

  afterEach(async () => {
    await model.deleteMany(query);
    await userModel.deleteMany({ email: 'collection-delete-admin@example.com' });
  });

  it.each([false, true])('returns 404 and keeps records even for an admin (with query: %s)', async (withQuery) => {
    const apiRequest = request(app).delete(route).set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminId })}`);
    if (withQuery) apiRequest.query(query);
    const response = await apiRequest;
    expect(response.status).toBe(404);
    expect(await model.findById(recordId)).not.toBeNull();
  });
});
