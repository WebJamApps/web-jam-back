/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import controller from '#src/model/subscriber/subscriber-controller.js';
import LibController from '#src/lib/controller.js';

vi.mock('#src/lib/mailer.js', () => ({
  sendMail: vi.fn(() => Promise.resolve()),
  default: { sendMail: vi.fn(() => Promise.resolve()) },
}));

describe('Subscriber Controller', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => {
      status = s;
      return {
        json: (obj: any) => { payload = obj; return obj; },
        send: (html: any) => { payload = html; return html; },
      };
    },
  };
  const lib = controller as unknown as LibController;
  const reqBase = { get: () => 'localhost', protocol: 'http', query: {} };

  beforeEach(() => {
    status = 0;
    payload = undefined;
  });

  describe('optIn (public)', () => {
    it('rejects a missing name', async () => {
      await (controller as any).optIn({ ...reqBase, body: { email: 'a@b.com' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('Name');
    });

    it('rejects an invalid email', async () => {
      await (controller as any).optIn({ ...reqBase, body: { name: 'Fan', email: 'nope' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('valid email');
    });

    it('no-ops for an already-active subscriber', async () => {
      lib.model.findOne = vi.fn(() => Promise.resolve({ _id: 'x', status: 'active' })) as any;
      await (controller as any).optIn({ ...reqBase, body: { name: 'Fan', email: 'a@b.com' } }, resStub);
      expect(status).toBe(200);
      expect(payload.message).toContain('already subscribed');
    });

    it('creates a pending subscriber for a new email', async () => {
      lib.model.findOne = vi.fn(() => Promise.resolve(null)) as any;
      const create = vi.fn(() => Promise.resolve({ _id: 'new' }));
      lib.model.create = create as any;
      await (controller as any).optIn({ ...reqBase, body: { name: 'Fan', email: 'New@B.com' } }, resStub);
      expect(create).toHaveBeenCalled();
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.email).toBe('new@b.com');
      expect(arg.status).toBe('pending');
      expect(arg.confirmToken).toBeTruthy();
      expect(status).toBe(200);
    });

    it('reactivates a previously unsubscribed email as pending', async () => {
      lib.model.findOne = vi.fn(() => Promise.resolve({ _id: 'old', status: 'unsubscribed' })) as any;
      const upd = vi.fn(() => Promise.resolve({ _id: 'old' }));
      lib.model.findByIdAndUpdate = upd as any;
      await (controller as any).optIn({ ...reqBase, body: { name: 'Fan', email: 'a@b.com' } }, resStub);
      expect(upd).toHaveBeenCalledWith('old', expect.objectContaining({ status: 'pending' }));
      expect(status).toBe(200);
    });
  });

  describe('confirm (public)', () => {
    it('rejects a missing token', async () => {
      await (controller as any).confirm({ ...reqBase }, resStub);
      expect(status).toBe(400);
      expect(payload).toContain('Invalid confirmation');
    });

    it('404s an unknown token', async () => {
      lib.model.findOne = vi.fn(() => Promise.resolve(null)) as any;
      await (controller as any).confirm({ ...reqBase, query: { token: 'zzz' } }, resStub);
      expect(status).toBe(404);
    });

    it('activates on a valid token', async () => {
      lib.model.findOne = vi.fn(() => Promise.resolve({ _id: 'c1', status: 'pending' })) as any;
      const upd = vi.fn(() => Promise.resolve({ _id: 'c1' }));
      lib.model.findByIdAndUpdate = upd as any;
      await (controller as any).confirm({ ...reqBase, query: { token: 'good' } }, resStub);
      expect(upd).toHaveBeenCalledWith('c1', expect.objectContaining({ status: 'active' }));
      expect(status).toBe(200);
      expect(payload).toContain('subscribed');
    });
  });

  describe('unsubscribe (public)', () => {
    it('rejects a missing token', async () => {
      await (controller as any).unsubscribe({ ...reqBase }, resStub);
      expect(status).toBe(400);
    });

    it('marks a valid token unsubscribed', async () => {
      lib.model.findOne = vi.fn(() => Promise.resolve({ _id: 'u1', status: 'active' })) as any;
      const upd = vi.fn(() => Promise.resolve({ _id: 'u1' }));
      lib.model.findByIdAndUpdate = upd as any;
      await (controller as any).unsubscribe({ ...reqBase, query: { token: 'good' } }, resStub);
      expect(upd).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'unsubscribed' }));
      expect(status).toBe(200);
      expect(payload).toContain('unsubscribed');
    });
  });

  describe('create (admin)', () => {
    it('rejects a missing name', async () => {
      await controller.create({ body: { email: 'a@b.com' } } as any, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('Name');
    });

    it('rejects an invalid email', async () => {
      await controller.create({ body: { name: 'Fan', email: 'bad' } } as any, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('valid email');
    });

    it('rejects an invalid status', async () => {
      await controller.create({ body: { name: 'Fan', email: 'a@b.com', status: 'bogus' } } as any, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('status');
    });

    it('creates an active subscriber by default', async () => {
      const create = vi.fn(() => Promise.resolve({ _id: 'a1', status: 'active' }));
      lib.model.create = create as any;
      await controller.create({ body: { name: 'Fan', email: 'a@b.com' } } as any, resStub);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.status).toBe('active');
      expect(arg.unsubscribeToken).toBeTruthy();
      expect(status).toBe(201);
    });
  });

  describe('findByIdAndUpdate (admin)', () => {
    it('rejects an invalid id', async () => {
      await (controller as any).findByIdAndUpdate({ params: { id: 'nope' }, body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('Update id');
    });

    it('rejects an invalid status', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await (controller as any).findByIdAndUpdate({ params: { id }, body: { status: 'bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('status');
    });

    it('updates a valid record', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      lib.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: id, status: 'unsubscribed' })) as any;
      await (controller as any).findByIdAndUpdate({ params: { id }, body: { status: 'unsubscribed' } }, resStub);
      expect(status).toBe(200);
    });
  });
});
