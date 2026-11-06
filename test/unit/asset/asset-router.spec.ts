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

      // Partial update without name accepts optional fields per AssetUpdateInput contract
      const partialUpdated = await request(app).put(`/asset/${_id}`).set(authHeaders).send({
        notes: 'Made-up partial update note',
      });
      expect(partialUpdated.status).toBe(200);
      expect(partialUpdated.body.name).toBe('Test Audio Interface MkII');
      expect(partialUpdated.body.notes).toBe('Made-up partial update note');

      // Create a cost-only asset to verify normalization and preservation in report
      const costAsset = await request(app).post('/asset').set(authHeaders).send({
        name: 'Made-up Cost Only Device',
        cost: 1000,
        businessPercentage: 50,
        purchaseDate: '2026-06-01T00:00:00.000Z',
        salemPropertyTax: true,
      });
      expect(costAsset.status).toBe(201);
      expect(costAsset.body.cost).toBe(1000);
      expect(costAsset.body.purchasePrice).toBe(1000);

      // Create a future year (2027) asset to verify year bounding in report
      const futureAsset = await request(app).post('/asset').set(authHeaders).send({
        name: 'Made-up Future 2027 Synth',
        purchasePrice: 600,
        purchaseDate: '2027-02-15T00:00:00.000Z',
        placedInServiceDate: '2027-03-01T00:00:00.000Z',
        businessPercentage: 100,
        salemPropertyTax: true,
      });
      expect(futureAsset.status).toBe(201);

      // Yearly report for 2026: excludes future 2027 equipment, preserves cost-only asset
      const report = await request(app).get('/asset/report?year=2026').set(authHeaders);
      expect(report.status).toBe(200);
      expect(report.body.year).toBe(2026);
      expect(report.body.totalAssets).toBe(2);
      expect(report.body.totalCost).toBe(1250); // 250 + 1000
      expect(report.body.totalBusinessBasis).toBe(725); // 225 + 500
      expect(report.body.salemPropertyTaxCount).toBe(2);
      expect(report.body.salemPropertyTaxTotal).toBe(725);
      expect(report.body.additionsCount).toBe(2);
      expect(report.body.items.map((i: { name: string }) => i.name)).toEqual([
        'Test Audio Interface MkII',
        'Made-up Cost Only Device',
      ]);

      // Yearly report for 2027: includes 2027 gear in inventory and additions
      const report2027 = await request(app).get('/asset/report?year=2027').set(authHeaders);
      expect(report2027.status).toBe(200);
      expect(report2027.body.year).toBe(2027);
      expect(report2027.body.totalAssets).toBe(3);
      expect(report2027.body.totalCost).toBe(1850); // 250 + 1000 + 600
      expect(report2027.body.totalBusinessBasis).toBe(1325); // 225 + 500 + 600
      expect(report2027.body.additionsCount).toBe(1); // Only the 2027 item
      expect(report2027.body.additionsCost).toBe(600);

      // Delete asset
      const deleted = await request(app).delete(`/asset/${_id}`).set(authHeaders);
      expect(deleted.status).toBe(200);
      await request(app).delete(`/asset/${costAsset.body._id}`).set(authHeaders);
      await request(app).delete(`/asset/${futureAsset.body._id}`).set(authHeaders);

      // Verify deletion
      const afterDelete = await request(app).get('/asset').set(authHeaders);
      expect(afterDelete.status).toBe(200);
      expect(afterDelete.body).toHaveLength(0);
    });
  });
});
