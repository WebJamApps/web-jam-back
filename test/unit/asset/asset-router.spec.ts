import mongoose from 'mongoose';
import {
  describe, it, expect, beforeEach,
} from 'vitest';
import app from '#src/index.js';
import assetModel from '#src/model/asset/asset-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

describe('Asset Router (401 without token on all routes, and CRUD + report)', () => {
  let authHeaders: Record<string, string>;
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  const sampleId = new mongoose.Types.ObjectId().toString();

  beforeEach(async () => {
    await assetModel.deleteMany({});
    await userModel.deleteMany({ email: 'asset-test-user@example.com' });
    const user = await userModel.create({
      name: 'Asset Tester',
      email: 'asset-test-user@example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    authHeaders = {
      origin: allowedUrl,
      Authorization: `Bearer ${authUtils.createJWT({ _id: user._id.toString() })}`,
    };
  });

  describe('Unauthenticated route guards (401 without token)', () => {
    it('GET /asset answers 401 without token (list)', async () => {
      const res: ApiResponse = await request(app).get('/asset').set({ origin: allowedUrl });
      expect(res.status).toBe(401);
    });

    it('GET /asset/report answers 401 without token (report)', async () => {
      const res: ApiResponse = await request(app).get('/asset/report').set({ origin: allowedUrl });
      expect(res.status).toBe(401);
    });

    it('POST /asset answers 401 without token (create)', async () => {
      const res: ApiResponse = await request(app).post('/asset').set({ origin: allowedUrl }).send({ name: 'Test' });
      expect(res.status).toBe(401);
    });

    it('GET /asset/:id answers 401 without token (read by id)', async () => {
      const res: ApiResponse = await request(app).get(`/asset/${sampleId}`).set({ origin: allowedUrl });
      expect(res.status).toBe(401);
    });

    it('PUT /asset/:id answers 401 without token (update)', async () => {
      const res: ApiResponse = await request(app).put(`/asset/${sampleId}`).set({ origin: allowedUrl }).send({ name: 'Updated' });
      expect(res.status).toBe(401);
    });

    it('DELETE /asset/:id answers 401 without token (delete)', async () => {
      const res: ApiResponse = await request(app).delete(`/asset/${sampleId}`).set({ origin: allowedUrl });
      expect(res.status).toBe(401);
    });
  });

  describe('Authenticated asset lifecycle and report', () => {
    it('creates an asset and retrieves it in the list and report', async () => {
      // Validation: name is required
      const invalid = await request(app).post('/asset').set(authHeaders).send({});
      expect(invalid.status).toBe(400);

      // Create valid asset
      const created = await request(app).post('/asset').set(authHeaders).send({
        name: 'Test Audio Interface',
        category: 'audio',
        purchasePrice: 250,
        purchaseDate: '2026-04-10T00:00:00.000Z',
        placedInServiceDate: '2026-04-15T00:00:00.000Z',
        businessPercentage: 90,
        salemPropertyTax: true,
      });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe('Test Audio Interface');
      expect(created.body.purchasePrice).toBe(250);
      const { _id } = created.body;

      // List assets
      const list = await request(app).get('/asset').set(authHeaders);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]._id).toBe(_id);

      // Read asset by id
      const single = await request(app).get(`/asset/${_id}`).set(authHeaders);
      expect(single.status).toBe(200);
      expect(single.body.name).toBe('Test Audio Interface');

      // Invalid ID returns 400
      const badId = await request(app).get('/asset/not-a-valid-id').set(authHeaders);
      expect(badId.status).toBe(400);

      // Update asset
      const updated = await request(app).put(`/asset/${_id}`).set(authHeaders).send({
        name: 'Test Audio Interface MkII',
      });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Test Audio Interface MkII');

      // Yearly report
      const report = await request(app).get('/asset/report?year=2026').set(authHeaders);
      expect(report.status).toBe(200);
      expect(report.body.year).toBe(2026);
      expect(report.body.totalAssets).toBe(1);
      expect(report.body.totalCost).toBe(250);
      expect(report.body.totalBusinessBasis).toBe(225); // 250 * 0.9
      expect(report.body.salemPropertyTaxCount).toBe(1);
      expect(report.body.salemPropertyTaxTotal).toBe(225);
      expect(report.body.additionsCount).toBe(1);

      // Delete asset
      const deleted = await request(app).delete(`/asset/${_id}`).set(authHeaders);
      expect(deleted.status).toBe(200);

      // Verify deletion
      const afterDelete = await request(app).get('/asset').set(authHeaders);
      expect(afterDelete.status).toBe(200);
      expect(afterDelete.body).toHaveLength(0);
    });
  });
});
