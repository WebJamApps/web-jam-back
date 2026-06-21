/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import controller from '#src/model/template/template-controller.js';
import userModel from '#src/model/user/user-facade.js';

const c = controller as any;

describe('Template Controller', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => {
      status = s;
      return { json: (obj: any) => { payload = obj; return obj; } };
    },
  };

  // Default: an AI-agent identity holding every template capability.
  const asAgent = (privileges = ['template:create', 'template:edit', 'template:delete']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };

  beforeEach(() => {
    status = 0;
    payload = undefined;
    asAgent();
  });

  describe('authorize', () => {
    it('403s when the capability is missing', async () => {
      asAgent(['template:edit']);
      await c.createTemplate({ user: 'a', body: { type: 'Originals' } }, resStub);
      expect(status).toBe(403);
      expect(payload.message).toContain('template:create');
    });

    it('401s when the user is not found', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      await c.listTemplates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(401);
    });

    it('allows a privilege-less admin via role fallback', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin', privileges: [] }));
      c.model.find = vi.fn(() => Promise.resolve([]));
      await c.listTemplates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
    });
  });

  describe('createTemplate', () => {
    it('rejects a missing type', async () => {
      await c.createTemplate({ user: 'a', body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('type is required');
    });

    it('rejects an invalid type', async () => {
      await c.createTemplate({ user: 'a', body: { type: 'Bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('type not valid');
    });

    it('creates a new template when there is no duplicate', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      const create = vi.fn(() => Promise.resolve({ _id: 'new' }));
      c.model.create = create;
      await c.createTemplate({ user: 'agent', body: { type: 'Originals', subject: 'Hi', actor: 'sonnet' } }, resStub);
      expect(status).toBe(201);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.active).toBe(true);
      expect(arg.lastModifiedBy).toBe('sonnet');
    });

    it('upserts onto an existing template of the same type', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'dup1' }));
      const upd = vi.fn(() => Promise.resolve({ _id: 'dup1' }));
      c.model.findByIdAndUpdate = upd;
      const create = vi.fn();
      c.model.create = create;
      await c.createTemplate({ user: 'agent', body: { type: 'Originals', subject: 'New' } }, resStub);
      expect(status).toBe(200);
      expect(create).not.toHaveBeenCalled();
      expect(upd).toHaveBeenCalledWith('dup1', expect.objectContaining({ active: true }));
    });

    it('dedupes by type', async () => {
      const findOne = vi.fn(() => Promise.resolve(null));
      c.model.findOne = findOne;
      c.model.create = vi.fn(() => Promise.resolve({ _id: 'n' }));
      await c.createTemplate({ user: 'a', body: { type: 'MidRangeCafeBar' } }, resStub);
      expect(findOne).toHaveBeenCalledWith({ type: 'MidRangeCafeBar' });
    });
  });

  describe('updateTemplate', () => {
    it('rejects an invalid id', async () => {
      await c.updateTemplate({ user: 'a', params: { id: 'nope' }, body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('Update id');
    });

    it('rejects an invalid type', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.updateTemplate({ user: 'a', params: { id }, body: { type: 'bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('type not valid');
    });

    it('updates a valid record', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateTemplate({ user: 'agent', params: { id }, body: { subject: 'Updated' } }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ subject: 'Updated', lastModifiedBy: 'agent' }));
    });
  });

  describe('deleteTemplate (soft-delete)', () => {
    it('deactivates rather than hard-deleting', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id, active: false }));
      c.model.findByIdAndUpdate = upd;
      await c.deleteTemplate({ user: 'a', params: { id }, body: {} }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ active: false }));
      expect(payload.message).toContain('deactivated');
    });

    it('rejects an invalid id', async () => {
      await c.deleteTemplate({ user: 'a', params: { id: 'bad' }, body: {} }, resStub);
      expect(status).toBe(400);
    });
  });

  describe('getTemplate', () => {
    it('rejects an invalid id', async () => {
      await c.getTemplate({ user: 'a', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('returns a found template', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, type: 'Originals' }));
      await c.getTemplate({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(payload.type).toBe('Originals');
    });
  });

  describe('listTemplates', () => {
    it('returns the collection', async () => {
      c.model.find = vi.fn(() => Promise.resolve([{ type: 'Originals' }, { type: 'MidRangeCafeBar' }]));
      await c.listTemplates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(2);
    });
  });

  describe('buildListFilter', () => {
    it('is empty by default', () => {
      expect((controller as any).constructor.buildListFilter({})).toEqual({});
    });

    it('honors type and active', () => {
      const f = (controller as any).constructor.buildListFilter({ type: 'Originals', active: 'true' });
      expect(f).toEqual({ type: 'Originals', active: true });
    });
  });
});
