import { Request, Response } from 'express';
import Controller from '../../lib/controller.js';
import assetModel from './asset-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';

export interface AssetReportItem {
  id?: string;
  name: string;
  category?: string;
  description?: string;
  serialNumber?: string;
  purchaseDate?: Date | string;
  purchasePrice: number;
  placedInServiceDate?: Date | string;
  businessPercentage: number;
  businessBasis: number;
  salemPropertyTax: boolean;
  status: string;
  notes?: string;
}

export interface YearlyReport {
  year: number;
  generatedAt: string;
  totalAssets: number;
  totalCost: number;
  totalBusinessBasis: number;
  salemPropertyTaxCount: number;
  salemPropertyTaxTotal: number;
  additionsCount: number;
  additionsCost: number;
  additionsBusinessBasis: number;
  items: AssetReportItem[];
}

export function generateYearlyReport(assets: Record<string, unknown>[], year?: number): YearlyReport {
  const targetYear = year ?? new Date().getFullYear();
  let totalCost = 0;
  let totalBusinessBasis = 0;
  let salemPropertyTaxCount = 0;
  let salemPropertyTaxTotal = 0;

  let additionsCount = 0;
  let additionsCost = 0;
  let additionsBusinessBasis = 0;

  const items: AssetReportItem[] = assets.map((doc) => {
    const cost = Number(doc.purchasePrice ?? doc.cost ?? 0);
    const busPct = doc.businessPercentage !== undefined && doc.businessPercentage !== null
      ? Number(doc.businessPercentage)
      : 100;
    const businessBasis = Math.round(cost * (busPct / 100) * 100) / 100;
    const salemTax = Boolean(doc.salemPropertyTax ?? true);

    totalCost += cost;
    totalBusinessBasis += businessBasis;

    if (salemTax && busPct >= 50) {
      salemPropertyTaxCount += 1;
      salemPropertyTaxTotal += businessBasis;
    }

    const inService = doc.placedInServiceDate ?? doc.purchaseDate;
    if (inService) {
      const d = new Date(inService as string | number | Date);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() === targetYear) {
        additionsCount += 1;
        additionsCost += cost;
        additionsBusinessBasis += businessBasis;
      }
    }

    return {
      id: doc._id ? String(doc._id) : undefined,
      name: String(doc.name || ''),
      category: doc.category ? String(doc.category) : undefined,
      description: doc.description ? String(doc.description) : undefined,
      serialNumber: doc.serialNumber ? String(doc.serialNumber) : undefined,
      purchaseDate: doc.purchaseDate as Date | string | undefined,
      purchasePrice: cost,
      placedInServiceDate: doc.placedInServiceDate as Date | string | undefined,
      businessPercentage: busPct,
      businessBasis,
      salemPropertyTax: salemTax,
      status: String(doc.status || 'active'),
      notes: doc.notes ? String(doc.notes) : undefined,
    };
  });

  return {
    year: targetYear,
    generatedAt: new Date().toISOString(),
    totalAssets: assets.length,
    totalCost: Math.round(totalCost * 100) / 100,
    totalBusinessBasis: Math.round(totalBusinessBasis * 100) / 100,
    salemPropertyTaxCount,
    salemPropertyTaxTotal: Math.round(salemPropertyTaxTotal * 100) / 100,
    additionsCount,
    additionsCost: Math.round(additionsCost * 100) / 100,
    additionsBusinessBasis: Math.round(additionsBusinessBasis * 100) / 100,
    items,
  };
}

class AssetController extends Controller {
  override async create(req: Request, res: Response): Promise<unknown> {
    if (!req.body || !req.body.name) {
      return res.status(400).json({ message: 'Name is required' });
    }
    return super.create(req, res);
  }

  async getYearlyReport(req: Request, res: Response): Promise<unknown> {
    try {
      const yearParam = req.query.year ? Number(req.query.year) : undefined;
      const assets = await this.model.find({});
      const report = generateYearlyReport(assets, yearParam);
      return res.status(200).json(report);
    } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
  }
}

export default new AssetController(assetModel) as unknown as Icontroller & AssetController;
