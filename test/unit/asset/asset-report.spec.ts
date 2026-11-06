import { describe, it, expect } from 'vitest';
import { generateYearlyReport } from '#src/model/asset/asset-controller.js';

describe('generateYearlyReport', () => {
  it('handles an empty asset list', () => {
    const report = generateYearlyReport([], 2026);
    expect(report.year).toBe(2026);
    expect(report.totalAssets).toBe(0);
    expect(report.totalCost).toBe(0);
    expect(report.totalBusinessBasis).toBe(0);
    expect(report.salemPropertyTaxCount).toBe(0);
    expect(report.salemPropertyTaxTotal).toBe(0);
    expect(report.additionsCount).toBe(0);
    expect(report.additionsCost).toBe(0);
    expect(report.additionsBusinessBasis).toBe(0);
    expect(report.items).toEqual([]);
  });

  it('produces a yearly report with made-up items', () => {
    const fakeItems = [
      {
        _id: '507f1f77bcf86cd799439011',
        name: 'Test USB MIDI Keyboard',
        category: 'instrument',
        description: 'Made-up 49-key controller for testing',
        serialNumber: 'SN-TEST-0001',
        purchaseDate: new Date('2026-03-15T00:00:00.000Z'),
        placedInServiceDate: new Date('2026-03-20T00:00:00.000Z'),
        purchasePrice: 150,
        businessPercentage: 100,
        salemPropertyTax: true,
        status: 'active',
        notes: 'Made-up test note',
      },
      {
        _id: '507f1f77bcf86cd799439012',
        name: 'Test Audio Interface',
        category: 'audio',
        description: 'Made-up 2-channel audio interface',
        serialNumber: 'SN-TEST-0002',
        purchaseDate: new Date('2026-06-01T00:00:00.000Z'),
        purchasePrice: 200,
        businessPercentage: 80,
        salemPropertyTax: true,
        status: 'active',
      },
      {
        _id: '507f1f77bcf86cd799439013',
        name: 'Test Studio Laptop',
        category: 'computer',
        description: 'Made-up studio computer',
        serialNumber: 'SN-TEST-0003',
        purchaseDate: new Date('2025-11-10T00:00:00.000Z'),
        cost: 1000,
        businessPercentage: 50,
        salemPropertyTax: false,
        status: 'active',
      },
      {
        _id: '507f1f77bcf86cd799439014',
        name: 'Personal Headphones',
        category: 'audio',
        description: 'Made-up headphones used mostly personally',
        serialNumber: 'SN-TEST-0004',
        purchaseDate: new Date('2026-01-10T00:00:00.000Z'),
        purchasePrice: 100,
        businessPercentage: 20,
        salemPropertyTax: true,
        status: 'active',
      },
    ];

    const report = generateYearlyReport(fakeItems, 2026);

    expect(report.year).toBe(2026);
    expect(report.totalAssets).toBe(4);
    // Total cost: 150 + 200 + 1000 + 100 = 1450
    expect(report.totalCost).toBe(1450);
    // Total business basis: (150 * 1.0) + (200 * 0.8) + (1000 * 0.5) + (100 * 0.2) = 150 + 160 + 500 + 20 = 830
    expect(report.totalBusinessBasis).toBe(830);

    // 2026 Additions:
    // Item 1 (in-service 2026): cost 150, basis 150
    // Item 2 (purchase 2026): cost 200, basis 160
    // Item 4 (purchase 2026): cost 100, basis 20
    // Item 3 was 2025, so not an addition in 2026
    expect(report.additionsCount).toBe(3);
    expect(report.additionsCost).toBe(450);
    expect(report.additionsBusinessBasis).toBe(330);

    // Salem personal property tax:
    // Item 1: salemPropertyTax true, businessPct 100 (>= 50) -> basis 150
    // Item 2: salemPropertyTax true, businessPct 80 (>= 50) -> basis 160
    // Item 3: salemPropertyTax false -> not included
    // Item 4: businessPct 20 (< 50) -> not included
    expect(report.salemPropertyTaxCount).toBe(2);
    expect(report.salemPropertyTaxTotal).toBe(310);

    expect(report.items).toHaveLength(4);
    expect(report.items[0]).toEqual({
      id: '507f1f77bcf86cd799439011',
      name: 'Test USB MIDI Keyboard',
      category: 'instrument',
      description: 'Made-up 49-key controller for testing',
      serialNumber: 'SN-TEST-0001',
      purchaseDate: fakeItems[0].purchaseDate,
      purchasePrice: 150,
      placedInServiceDate: fakeItems[0].placedInServiceDate,
      businessPercentage: 100,
      businessBasis: 150,
      salemPropertyTax: true,
      status: 'active',
      notes: 'Made-up test note',
    });
  });

  it('bounds report to requested year and excludes future acquisitions/service entries', () => {
    const mixedYearItems = [
      {
        _id: '507f1f77bcf86cd799439021',
        name: '2025 Acquired Amp',
        purchaseDate: new Date('2025-05-10T00:00:00.000Z'),
        purchasePrice: 400,
        businessPercentage: 100,
        salemPropertyTax: true,
      },
      {
        _id: '507f1f77bcf86cd799439022',
        name: '2026 Acquired Guitar',
        purchaseDate: new Date('2026-02-15T00:00:00.000Z'),
        placedInServiceDate: new Date('2026-03-01T00:00:00.000Z'),
        purchasePrice: 800,
        businessPercentage: 75,
        salemPropertyTax: true,
      },
      {
        _id: '507f1f77bcf86cd799439023',
        name: '2027 Future Synth',
        purchaseDate: new Date('2027-01-20T00:00:00.000Z'),
        placedInServiceDate: new Date('2027-02-01T00:00:00.000Z'),
        purchasePrice: 1200,
        businessPercentage: 100,
        salemPropertyTax: true,
      },
    ];

    // 2026 report must NOT pick up 2027 equipment in inventory or totals
    const report2026 = generateYearlyReport(mixedYearItems, 2026);
    expect(report2026.year).toBe(2026);
    expect(report2026.totalAssets).toBe(2);
    expect(report2026.totalCost).toBe(1200); // 400 + 800
    expect(report2026.totalBusinessBasis).toBe(1000); // 400 + (800 * 0.75)
    expect(report2026.additionsCount).toBe(1); // Only 2026 item
    expect(report2026.additionsCost).toBe(800);
    expect(report2026.additionsBusinessBasis).toBe(600);
    expect(report2026.salemPropertyTaxCount).toBe(2);
    expect(report2026.salemPropertyTaxTotal).toBe(1000);
    expect(report2026.items.map((i) => i.name)).toEqual(['2025 Acquired Amp', '2026 Acquired Guitar']);

    // 2027 report includes all three items
    const report2027 = generateYearlyReport(mixedYearItems, 2027);
    expect(report2027.year).toBe(2027);
    expect(report2027.totalAssets).toBe(3);
    expect(report2027.totalCost).toBe(2400); // 400 + 800 + 1200
    expect(report2027.totalBusinessBasis).toBe(2200); // 400 + 600 + 1200
    expect(report2027.additionsCount).toBe(1); // Only 2027 item
    expect(report2027.additionsCost).toBe(1200);
    expect(report2027.additionsBusinessBasis).toBe(1200);
    expect(report2027.items.map((i) => i.name)).toEqual([
      '2025 Acquired Amp',
      '2026 Acquired Guitar',
      '2027 Future Synth',
    ]);
  });

  it('preserves cost-only assets even when purchasePrice is 0 or undefined', () => {
    const costOnlyItems = [
      {
        _id: '507f1f77bcf86cd799439031',
        name: 'Cost Only Microphone',
        cost: 600,
        purchasePrice: 0, // Mongoose default or explicit 0 must not mask cost
        businessPercentage: 50,
        salemPropertyTax: true,
        purchaseDate: new Date('2026-05-01T00:00:00.000Z'),
      },
    ];

    const report = generateYearlyReport(costOnlyItems, 2026);
    expect(report.totalAssets).toBe(1);
    expect(report.totalCost).toBe(600);
    expect(report.totalBusinessBasis).toBe(300); // 600 * 0.5
    expect(report.salemPropertyTaxCount).toBe(1);
    expect(report.salemPropertyTaxTotal).toBe(300);
    expect(report.additionsCost).toBe(600);
    expect(report.additionsBusinessBasis).toBe(300);
    expect(report.items[0].purchasePrice).toBe(600);
  });

  it('defaults to current calendar year when year is omitted', () => {
    const report = generateYearlyReport([]);
    expect(report.year).toBe(new Date().getFullYear());
  });
});
