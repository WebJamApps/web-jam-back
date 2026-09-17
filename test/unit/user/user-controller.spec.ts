/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
import controller from '#src/model/user/user-controller.js';
import LibController from '#src/lib/controller.js';
import authGoogle from '#src/auth/google.js';

describe('User Controller', () => {
  let status = 0,
    testObj:any;
  const resStub:any = {
    status: (s:number) => { status = s; return ({ json: (obj: any) => { testObj = obj; } }); },
  };
  const reqStub:any = { body: { email: '' }, userType: 'JaM-admin' };
  it('catches error on findByEmail', async () => {
    controller.resErr = vi.fn();
    (controller as unknown as LibController).model.findOne = vi.fn(() => Promise.reject(new Error('bad')));
    await controller.findByEmail(reqStub, resStub);
    expect(controller.resErr).toHaveBeenCalled();
  });
  it('returns 200 on findByEmail', async () => {
    (controller as unknown as LibController).model.findOne = vi.fn(() => Promise.resolve({ _id: 'id' }));
    await controller.findByEmail(reqStub, resStub);
    expect(testObj._id).toBe('id');
  });
  it('successfully google authenticate', async () => {
    (controller as unknown as LibController).model.findOneAndUpdate = vi.fn(() => Promise.resolve({}));
    const authMock:any = vi.fn(() => Promise.resolve({ names: [{ displayName: 'tester' }], emailAddresses: [{ value: 't@s.com' }] }));
    authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect(testObj.token).toBeDefined();
    testObj = {};
  });
  it('successfully google authenticate when new user', async () => {
    (controller as unknown as LibController).model.create = vi.fn(() => Promise.resolve({ password: 'password' }));
    (controller as unknown as LibController).model.findOneAndUpdate = vi.fn(() => Promise.resolve(null));
    const authMock:any = vi.fn(() => Promise.resolve({ names: [{ displayName: 'tester' }], emailAddresses: [{ value: 't@s.com' }] }));
    authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect(status).toBe(201);
  });
  it('stamps the slug-derived artist-admin grant for a configured email on login (#885)', async () => {
    const prev = process.env.ArtistAdmins;
    process.env.ArtistAdmins = JSON.stringify({ 'tim@sherman.com': 'tim' });
    const update = vi.fn(() => Promise.resolve({ email: 'tim@sherman.com' }));
    (controller as unknown as LibController).model.findOneAndUpdate = update as any;
    const authMock:any = vi.fn(() => Promise.resolve({ names: [{ displayName: 'Tim' }], emailAddresses: [{ value: 'tim@sherman.com' }] }));
    authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect((update.mock.calls[0] as unknown[])[1]).toMatchObject({ userType: 'tim-admin', artist: 'tim' });
    process.env.ArtistAdmins = prev;
    testObj = {};
  });
});

describe('User Controller access rules (web-jam-back#1110)', () => {
  let status = 0;
  const resStub:any = {
    status: (s:number) => { status = s; return ({ json: () => undefined }); },
  };
  const lib = () => controller as unknown as LibController;
  const ownId = '507f1f77bcf86cd799439011';
  const otherId = '507f1f77bcf86cd799439012';

  beforeEach(() => { status = 0; });

  it('findById proceeds for the record of the caller', async () => {
    lib().model.findById = vi.fn(() => Promise.resolve({ _id: ownId })) as any;
    await controller.findById({ params: { id: ownId }, user: ownId, userType: 'clc-admin' } as any, resStub);
    expect(status).toBe(200);
  });

  it('findById proceeds for a user admin reading another record', async () => {
    for (const userType of ['JaM-admin', 'Developer']) {
      status = 0;
      lib().model.findById = vi.fn(() => Promise.resolve({ _id: otherId })) as any;
      await controller.findById({ params: { id: otherId }, user: ownId, userType } as any, resStub);
      expect(status).toBe(200);
    }
  });

  it('findById refuses the record of another user for a non-admin and reads nothing', async () => {
    for (const userType of ['clc-admin', 'tim-admin', 'web-jam-llm', 'none']) {
      status = 0;
      const find = vi.fn();
      lib().model.findById = find as any;
      await controller.findById({ params: { id: otherId }, user: ownId, userType } as any, resStub);
      expect(status).toBe(403);
      expect(find).not.toHaveBeenCalled();
    }
  });

  it('findById refuses when the caller cannot be determined', async () => {
    const find = vi.fn();
    lib().model.findById = find as any;
    await controller.findById({ params: { id: otherId } } as any, resStub);
    expect(status).toBe(403);
    await controller.findById({ params: { id: '' } } as any, resStub);
    expect(status).toBe(403);
    expect(find).not.toHaveBeenCalled();
  });

  it('findByIdAndUpdate refuses every caller and writes nothing', async () => {
    const update = vi.fn();
    lib().model.findByIdAndUpdate = update as any;
    for (const caller of [
      { user: ownId, userType: 'JaM-admin' },
      { user: ownId, userType: 'clc-admin' },
      { user: ownId, userType: 'web-jam-llm' },
      {},
    ]) {
      status = 0;
      await controller.findByIdAndUpdate({
        params: { id: ownId }, body: { userType: 'JaM-admin', privileges: ['outreach:approve'] }, ...caller,
      } as any, resStub);
      expect(status).toBe(403);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('findByIdAndDelete refuses every caller and deletes nothing', async () => {
    const del = vi.fn();
    lib().model.findByIdAndDelete = del as any;
    for (const caller of [{ user: ownId, userType: 'Developer' }, { user: ownId, userType: 'tim-admin' }, {}]) {
      status = 0;
      await controller.findByIdAndDelete({ params: { id: otherId }, ...caller } as any, resStub);
      expect(status).toBe(403);
    }
    expect(del).not.toHaveBeenCalled();
  });

  it('findByEmail refuses non-admins and callers with no role, and looks nothing up', async () => {
    const findOne = vi.fn();
    lib().model.findOne = findOne as any;
    for (const userType of ['clc-admin', 'tim-admin', 'web-jam-llm', undefined]) {
      status = 0;
      await controller.findByEmail({ body: { email: 'a@b.com' }, userType } as any, resStub);
      expect(status).toBe(403);
    }
    expect(findOne).not.toHaveBeenCalled();
  });
});
