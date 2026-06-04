/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import controller from '../../../src/model/admin-user/admin-user-controller.js';
import LibController from '../../../src/lib/controller.js';

describe('Admin User Controller', () => {
  let status = 0;
  let testObj: any = {};
  const resStub: any = {
    status: (s: number) => { status = s; return ({ json: (obj: any) => { testObj = obj; return testObj; } }); },
  };
  const lib = controller as unknown as LibController;

  beforeEach(() => {
    status = 0;
    testObj = {};
  });

  describe('create', () => {
    it('rejects missing name', async () => {
      await controller.create({ body: { email: 'a@b.com' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('Name');
    });

    it('rejects missing email', async () => {
      await controller.create({ body: { name: 'Bot' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('Email');
    });

    it('rejects invalid privileges', async () => {
      await controller.create({ body: { name: 'Bot', email: 'a@b.com', privileges: ['tour:nuke'] } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('tour:nuke');
    });

    it('rejects unknown userType', async () => {
      lib.userRoles = ['JaM-admin'];
      await controller.create({ body: { name: 'Bot', email: 'a@b.com', userType: 'unknown-role' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('userType');
    });

    it('creates with valid privileges', async () => {
      lib.userRoles = ['web-jam-llm'];
      lib.model.create = vi.fn(() => Promise.resolve({ _id: 'id', name: 'Bot', privileges: ['tour:create'] })) as any;
      await controller.create({
        userType: 'Developer',
        body: {
          name: 'Bot', email: 'a@b.com', userType: 'web-jam-llm', privileges: ['tour:create'],
        },
      } as any, resStub);
      expect(status).toBe(201);
      expect(testObj._id).toBe('id');
    });

    it('forbids a JaM-admin from granting clc-admin (403)', async () => {
      lib.userRoles = ['JaM-admin', 'clc-admin'];
      await controller.create({
        userType: 'JaM-admin',
        body: { name: 'Kyle', email: 'k@b.com', userType: 'clc-admin' },
      } as any, resStub);
      expect(status).toBe(403);
      expect(testObj.message).toContain('clc-admin');
    });

    it('lets a Developer grant clc-admin', async () => {
      lib.userRoles = ['JaM-admin', 'clc-admin'];
      lib.model.create = vi.fn(() => Promise.resolve({ _id: 'id2', name: 'Kyle' })) as any;
      await controller.create({
        userType: 'Developer',
        body: { name: 'Kyle', email: 'k@b.com', userType: 'clc-admin' },
      } as any, resStub);
      expect(status).toBe(201);
    });

    it('creates with no privileges field set', async () => {
      lib.model.create = vi.fn(() => Promise.resolve({ _id: 'id', name: 'Bot' })) as any;
      await controller.create({ body: { name: 'Bot', email: 'a@b.com' } } as any, resStub);
      expect(status).toBe(201);
    });

    it('returns 500 on model error', async () => {
      lib.model.create = vi.fn(() => Promise.reject(new Error('boom'))) as any;
      await controller.create({ body: { name: 'Bot', email: 'a@b.com' } } as any, resStub);
      expect(status).toBe(500);
    });

    it('rejects an invalid userStatus', async () => {
      await controller.create({ body: { name: 'Bot', email: 'a@b.com', userStatus: 'enabled' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('userStatus not valid');
    });

    it('rejects ai-agent without the web-jam-llm role', async () => {
      lib.userRoles = ['JaM-admin', 'web-jam-llm'];
      await controller.create({ body: { name: 'Bot', email: 'a@b.com', userStatus: 'ai-agent' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('web-jam-llm');
    });

    it('allows ai-agent with the web-jam-llm role', async () => {
      lib.userRoles = ['web-jam-llm'];
      lib.model.create = vi.fn(() => Promise.resolve({ _id: 'bot', name: 'Bot' })) as any;
      await controller.create({
        userType: 'Developer',
        body: {
          name: 'Bot', email: 'a@b.com', userType: 'web-jam-llm', userStatus: 'ai-agent',
        },
      } as any, resStub);
      expect(status).toBe(201);
    });
  });

  describe('findByIdAndUpdate', () => {
    it('rejects invalid id', async () => {
      await controller.findByIdAndUpdate({ params: { id: 'not-an-id' }, body: {} } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('Update id');
    });

    it('rejects invalid privileges in update', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { privileges: ['evil:capability'] } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('evil:capability');
    });

    it('rejects invalid userType in update', async () => {
      lib.userRoles = ['JaM-admin'];
      lib.model.findById = vi.fn(() => Promise.resolve({})) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { userType: 'fake' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('userType');
    });

    it('updates with valid privileges', async () => {
      lib.userRoles = ['web-jam-llm'];
      lib.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: 'id', privileges: ['tour:create'] })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { privileges: ['tour:create'] } } as any, resStub);
      expect(status).toBe(200);
    });

    it('forbids a JaM-admin from removing someone\'s clc-admin role (403)', async () => {
      lib.userRoles = ['JaM-admin', 'clc-admin'];
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: 'clc-admin' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, userType: 'JaM-admin', body: { userType: '' } } as any, resStub);
      expect(status).toBe(403);
      expect(testObj.message).toContain('removing');
    });

    it('lets a clc-admin remove a clc-admin role', async () => {
      lib.userRoles = ['JaM-admin', 'clc-admin'];
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: 'clc-admin' })) as any;
      lib.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: 'id' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, userType: 'clc-admin', body: { userType: '' } } as any, resStub);
      expect(status).toBe(200);
    });

    it('treats an unchanged role as a no-op (privilege-only edit not blocked)', async () => {
      // clc-admin not even in userRoles here, yet resending the same role must
      // not 400 — only an actual change is validated/authorized.
      lib.userRoles = ['JaM-admin'];
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: 'clc-admin' })) as any;
      lib.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: 'id', privileges: [] })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { userType: 'clc-admin', privileges: [] } } as any, resStub);
      expect(status).toBe(200);
    });

    it('returns 500 when looking up the current role fails', async () => {
      lib.model.findById = vi.fn(() => Promise.reject(new Error('db down'))) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, userType: 'Developer', body: { userType: 'web-jam-llm' } } as any, resStub);
      expect(status).toBe(500);
    });

    it('rejects an invalid userStatus in update', async () => {
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { userStatus: 'enabled' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('userStatus not valid');
    });

    it('rejects setting ai-agent on a non web-jam-llm user', async () => {
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { userStatus: 'ai-agent' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('web-jam-llm');
    });

    it('corrects a legacy userStatus to human', async () => {
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin' })) as any;
      lib.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: 'id', userStatus: 'human' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({ params: { id }, body: { userStatus: 'human' } } as any, resStub);
      expect(status).toBe(200);
    });

    it('allows ai-agent when the same update assigns the web-jam-llm role', async () => {
      lib.userRoles = ['JaM-admin', 'web-jam-llm'];
      lib.model.findById = vi.fn(() => Promise.resolve({ userType: '' })) as any;
      lib.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: 'id' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.findByIdAndUpdate({
        params: { id }, userType: 'Developer', body: { userType: 'web-jam-llm', userStatus: 'ai-agent' },
      } as any, resStub);
      expect(status).toBe(200);
    });
  });

  describe('mintToken', () => {
    it('rejects invalid id', async () => {
      await controller.mintToken({ params: { id: 'bad' } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('id is invalid');
    });

    it('rejects when user not found', async () => {
      lib.model.findById = vi.fn(() => Promise.resolve(null)) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.mintToken({ params: { id } } as any, resStub);
      expect(status).toBe(400);
      expect(testObj.message).toContain('not found');
    });

    it('mints a token when user found', async () => {
      lib.model.findById = vi.fn(() => Promise.resolve({ _id: 'someid' })) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.mintToken({ params: { id } } as any, resStub);
      expect(status).toBe(200);
      expect(testObj.token).toBeDefined();
      expect(typeof testObj.token).toBe('string');
    });

    it('returns 500 when model throws', async () => {
      lib.model.findById = vi.fn(() => Promise.reject(new Error('db down'))) as any;
      const id = new mongoose.Types.ObjectId().toString();
      await controller.mintToken({ params: { id } } as any, resStub);
      expect(status).toBe(500);
    });
  });
});
