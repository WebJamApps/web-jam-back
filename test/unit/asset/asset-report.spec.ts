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

  it('defaults to current calendar year when year is omitted', () => {
    const report = generateYearlyReport([]);
    expect(report.year).toBe(new Date().getFullYear());
  });
});
