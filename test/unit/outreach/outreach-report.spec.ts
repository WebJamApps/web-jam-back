/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';

const { default: controller, TABLE_SORT_JS } = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: reportModel } = await import('#src/model/outreach/outreach-report-facade.js');

const c = controller as any;
const oid = () => new mongoose.Types.ObjectId().toString();

describe('Outreach Report Endpoints (web-jam-back#1052)', () => {
  let status = 0;
  let payload: any;
  let headers: Record<string, string> = {};
  let rawBody: any;

  const resStub: any = {
    status: (s: number) => {
      status = s;
      return {
        json: (obj: any) => { payload = obj; return obj; },
        send: (body: any) => { rawBody = body; return body; },
      };
    },
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };

  const origFindOneAndDelete = reportModel.findOneAndDelete;

  beforeEach(() => {
    status = 0;
    payload = undefined;
    headers = {};
    rawBody = undefined;
    reportModel.findOneAndDelete = origFindOneAndDelete;
    vi.restoreAllMocks();
  });

  const asAgent = (privileges = ['outreach:create', 'outreach:edit', 'outreach:delete']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };

  const asApprover = () => asAgent(['outreach:approve']);

  const asNonOutreach = () => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges: ['venue:view'] }));
  };

  describe('POST /outreach/report (saveReport)', () => {
    it('rejects unauthenticated requests (401)', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), body: { weekend: '2026-10-16-to-2026-10-18', htmlContent: '<p>Report</p>' } };
      await c.saveReport(req, resStub);
      expect(status).toBe(401);
      expect(payload.message).toContain('user not found');
    });

    it('rejects unauthorized users without outreach privileges (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), body: { weekend: '2026-10-16-to-2026-10-18', htmlContent: '<p>Report</p>' } };
      await c.saveReport(req, resStub);
      expect(status).toBe(403);
    });

    it('rejects missing or empty weekend (400)', async () => {
      asAgent();
      const req: any = { user: oid(), body: { htmlContent: '<p>Report</p>' } };
      await c.saveReport(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('weekend is required');

      const reqEmpty: any = { user: oid(), body: { weekend: '   ', htmlContent: '<p>Report</p>' } };
      await c.saveReport(reqEmpty, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('weekend is required');
    });

    it('rejects missing or empty htmlContent (400)', async () => {
      asAgent();
      const req: any = { user: oid(), body: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.saveReport(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('htmlContent is required');

      const reqEmpty: any = { user: oid(), body: { weekend: '2026-10-16-to-2026-10-18', htmlContent: '   ' } };
      await c.saveReport(reqEmpty, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('htmlContent is required');
    });

    it('creates a new report with 201 status when not previously existing', async () => {
      asAgent();
      const reportId = oid();
      (reportModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (reportModel as any).create = vi.fn((data: any) => Promise.resolve({ _id: reportId, ...data }));

      const req: any = {
        user: oid(),
        body: {
          weekend: '2026-10-16-to-2026-10-18',
          title: 'October 16-18 Weekend Run',
          htmlContent: '<html><body>Report Content</body></html>',
          candidatesCount: 15,
          dispatchedCount: 10,
          metadata: { metro: 'salem-roanoke' },
        },
      };

      await c.saveReport(req, resStub);
      expect(status).toBe(201);
      expect(payload._id).toBe(reportId);
      expect(payload.weekend).toBe('2026-10-16-to-2026-10-18');
      expect(payload.title).toBe('October 16-18 Weekend Run');
      expect(payload.htmlContent).toBe('<html><body>Report Content</body></html>');
      expect(payload.candidatesCount).toBe(15);
      expect(payload.dispatchedCount).toBe(10);
      expect((reportModel as any).create).toHaveBeenCalledWith(expect.objectContaining({
        weekend: '2026-10-16-to-2026-10-18',
        title: 'October 16-18 Weekend Run',
      }));
    });

    it('uses fallback default title when title is omitted', async () => {
      asAgent();
      const reportId = oid();
      (reportModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (reportModel as any).create = vi.fn((data: any) => Promise.resolve({ _id: reportId, ...data }));

      const req: any = {
        user: oid(),
        body: {
          weekend: '2026-10-16-to-2026-10-18',
          htmlContent: '<html><body>Report Content</body></html>',
        },
      };

      await c.saveReport(req, resStub);
      expect(status).toBe(201);
      expect((reportModel as any).create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Outreach Report - 2026-10-16-to-2026-10-18',
      }));
    });

    it('updates an existing report with 200 status when already existing', async () => {
      asApprover();
      const existingId = oid();
      (reportModel as any).findOne = vi.fn(() => Promise.resolve({ _id: existingId, weekend: '2026-10-16-to-2026-10-18' }));
      (reportModel as any).findByIdAndUpdate = vi.fn((id: string, data: any) => Promise.resolve({ _id: id, ...data }));

      const req: any = {
        user: oid(),
        body: {
          weekend: '2026-10-16-to-2026-10-18',
          title: 'Updated Title',
          htmlContent: '<html><body>Updated Body</body></html>',
        },
      };

      await c.saveReport(req, resStub);
      expect(status).toBe(200);
      expect(payload._id).toBe(existingId);
      expect(payload.title).toBe('Updated Title');
      expect((reportModel as any).findByIdAndUpdate).toHaveBeenCalledWith(existingId, expect.objectContaining({
        weekend: '2026-10-16-to-2026-10-18',
        title: 'Updated Title',
      }));
    });

    it('returns 500 when database throws', async () => {
      asAgent();
      (reportModel as any).findOne = vi.fn(() => Promise.reject(new Error('Mongo connection drop')));

      const req: any = {
        user: oid(),
        body: {
          weekend: '2026-10-16-to-2026-10-18',
          htmlContent: '<p>Report</p>',
        },
      };

      await c.saveReport(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toBe('Mongo connection drop');
    });
  });

  describe('GET /outreach/report/:weekend (getReport)', () => {
    it('returns 400 when weekend param is missing/empty', async () => {
      const req: any = { params: { weekend: '   ' } };
      await c.getReport(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('weekend parameter is required');
    });

    it('returns 404 when report document does not exist', async () => {
      (reportModel as any).findOne = vi.fn(() => Promise.resolve(null));
      const req: any = { params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.getReport(req, resStub);
      expect(status).toBe(404);
      expect(payload.message).toContain("Outreach report for weekend '2026-10-16-to-2026-10-18' not found");
    });

    it('returns 404 when report document has empty htmlContent', async () => {
      (reportModel as any).findOne = vi.fn(() => Promise.resolve({ weekend: '2026-10-16-to-2026-10-18', htmlContent: '' }));
      const req: any = { params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.getReport(req, resStub);
      expect(status).toBe(404);
    });

    it('serves HTML report with Content-Type: text/html and 200 status', async () => {
      const html = '<!DOCTYPE html><html><body><h1>Gig Outreach Review</h1></body></html>';
      (reportModel as any).findOne = vi.fn(() => Promise.resolve({
        weekend: '2026-10-16-to-2026-10-18',
        htmlContent: html,
      }));

      const req: any = { params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.getReport(req, resStub);
      expect(status).toBe(200);
      expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(headers['Cache-Control']).toBe('public, max-age=300');
      expect(rawBody).toBe(html);
    });

    it('returns 500 when database throws on retrieval', async () => {
      (reportModel as any).findOne = vi.fn(() => Promise.reject(new Error('Mongo read error')));
      const req: any = { params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.getReport(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toBe('Mongo read error');
    });
  });

  describe('GET /outreach/table-sort.js (getTableSortScript)', () => {
    it('serves static table sorting JavaScript with application/javascript Content-Type and immutable cache', () => {
      const req: any = {};
      c.getTableSortScript(req, resStub);
      expect(status).toBe(200);
      expect(headers['Content-Type']).toBe('application/javascript; charset=utf-8');
      expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
      expect(rawBody).toContain('initTableSorting');
      expect(rawBody).toContain('copyPitch');
    });

    it('includes sequential row re-indexing logic in served script', () => {
      const req: any = {};
      c.getTableSortScript(req, resStub);
      expect(status).toBe(200);
      expect(rawBody).toContain('.num-col');
      expect(rawBody).toContain('numCell.textContent = idx + 1');
    });

    it('re-numbers row numbers sequentially when sorting rows via TABLE_SORT_JS', () => {
      let sortCol1Handler: (() => void) | null = null;
      const makeTh = (colIndex: number) => ({
        classList: { add: vi.fn() },
        appendChild: vi.fn(),
        getAttribute: vi.fn(() => null),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        querySelector: vi.fn(() => ({ textContent: '' })),
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'click' && colIndex === 1) sortCol1Handler = handler;
        }),
      });

      const th0 = makeTh(0);
      const th1 = makeTh(1);

      const row1Cell0 = { textContent: '1', innerText: '1' };
      const row1Cell1 = { textContent: 'Zeta Venue', innerText: 'Zeta Venue' };
      const row1 = {
        children: [row1Cell0, row1Cell1],
        querySelector: vi.fn((sel: string) => (sel === '.num-col' ? row1Cell0 : null)),
      };

      const row2Cell0 = { textContent: '2', innerText: '2' };
      const row2Cell1 = { textContent: 'Alpha Venue', innerText: 'Alpha Venue' };
      const row2 = {
        children: [row2Cell0, row2Cell1],
        querySelector: vi.fn(() => null), // fallback to children[0]
      };

      const rowsList: any[] = [row1, row2];
      const tbodyMock: any = {
        querySelectorAll: vi.fn(() => rowsList),
        appendChild: vi.fn((r: any) => {
          const idx = rowsList.indexOf(r);
          if (idx !== -1) rowsList.splice(idx, 1);
          rowsList.push(r);
        }),
      };

      const tableMock: any = {
        querySelectorAll: vi.fn((sel: string) => (sel === 'thead th' ? [th0, th1] : [])),
        querySelector: vi.fn((sel: string) => (sel === 'tbody' ? tbodyMock : null)),
      };

      const docMock: any = {
        querySelectorAll: vi.fn((sel: string) => (sel === 'table.candidate-table' ? [tableMock] : [])),
        createElement: vi.fn(() => ({ className: '', textContent: '' })),
        readyState: 'complete',
      };

      // eslint-disable-next-line sonarjs/code-eval
      new Function('document', `${TABLE_SORT_JS}; initTableSorting();`)(docMock);

      expect(sortCol1Handler).toBeDefined();
      if (sortCol1Handler) {
        (sortCol1Handler as () => void)();
      }

      // After sorting by column 1 asc ("Alpha Venue" before "Zeta Venue"):
      // row2 (Alpha Venue) is now row 0, row1 (Zeta Venue) is now row 1.
      expect(row2Cell0.textContent).toBe(1);
      expect(row1Cell0.textContent).toBe(2);
    });
  });

  describe('DELETE /outreach/report/:weekend (deleteReport)', () => {
    it('rejects unauthenticated requests (401)', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.deleteReport(req, resStub);
      expect(status).toBe(401);
    });

    it('rejects unauthorized users without outreach privileges (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.deleteReport(req, resStub);
      expect(status).toBe(403);
    });

    it('returns 400 when weekend param is missing/empty', async () => {
      asAgent();
      const req: any = { user: oid(), params: { weekend: '   ' } };
      await c.deleteReport(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('weekend parameter is required');
    });

    it('returns 404 when report to delete is not found', async () => {
      asAgent();
      (reportModel as any).findOneAndDelete = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.deleteReport(req, resStub);
      expect(status).toBe(404);
      expect(payload.message).toContain("Outreach report for weekend '2026-10-16-to-2026-10-18' not found");
    });

    it('deletes report and returns 200 success message', async () => {
      asAgent();
      (reportModel as any).findOneAndDelete = vi.fn(() => Promise.resolve({ weekend: '2026-10-16-to-2026-10-18' }));
      const req: any = { user: oid(), params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.deleteReport(req, resStub);
      expect(status).toBe(200);
      expect(payload.message).toContain("Outreach report for weekend '2026-10-16-to-2026-10-18' deleted successfully");
      expect((reportModel as any).findOneAndDelete).toHaveBeenCalledWith({ weekend: '2026-10-16-to-2026-10-18' });
    });

    it('returns 500 when database throws on delete', async () => {
      asAgent();
      (reportModel as any).findOneAndDelete = vi.fn(() => Promise.reject(new Error('Mongo delete error')));
      const req: any = { user: oid(), params: { weekend: '2026-10-16-to-2026-10-18' } };
      await c.deleteReport(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toBe('Mongo delete error');
    });
  });

  describe('OutreachReport Facade and Schema', () => {
    it('findOneAndDelete delegates to mongoose Schema.findOneAndDelete', async () => {
      const mockExec = vi.fn(() => Promise.resolve({ weekend: '2026-10-16-to-2026-10-18' }));
      const mockLean = vi.fn(() => ({ exec: mockExec }));
      (reportModel.Schema as any).findOneAndDelete = vi.fn(() => ({ lean: mockLean }));

      const res = await reportModel.findOneAndDelete({ weekend: '2026-10-16-to-2026-10-18' });
      expect(res).toEqual({ weekend: '2026-10-16-to-2026-10-18' });
      expect((reportModel.Schema as any).findOneAndDelete).toHaveBeenCalledWith({ weekend: '2026-10-16-to-2026-10-18' });
    });
  });
});
