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

function parseYear(val: unknown): number | undefined {
  if (!val) return undefined;
  const d = new Date(val as string | number | Date);
  return Number.isNaN(d.getTime()) ? undefined : d.getFullYear();
}

function shouldIncludeInYear(doc: Record<string, unknown>, targetYear: number): boolean {
  const inServiceYear = parseYear(doc.placedInServiceDate);
  const purchaseYear = parseYear(doc.purchaseDate);

  if (inServiceYear !== undefined && inServiceYear > targetYear) {
    return false;
  }
  if (inServiceYear === undefined && purchaseYear !== undefined && purchaseYear > targetYear) {
    return false;
  }
  if (purchaseYear !== undefined && purchaseYear > targetYear) {
    return false;
  }
  return true;
}

function resolveCost(doc: Record<string, unknown>): number {
  if (doc.purchasePrice !== undefined && doc.purchasePrice !== null && doc.purchasePrice !== 0) {
    return Number(doc.purchasePrice);
  }
  if (doc.cost !== undefined && doc.cost !== null) {
    return Number(doc.cost);
  }
  return Number(doc.purchasePrice ?? 0);
}

function toReportItem(
  doc: Record<string, unknown>,
  cost: number,
  busPct: number,
  businessBasis: number,
  salemTax: boolean,
): AssetReportItem {
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

  const items: AssetReportItem[] = [];

  for (const doc of assets) {
    if (!shouldIncludeInYear(doc, targetYear)) {
      continue;
    }

    const cost = resolveCost(doc);
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

    const additionYear = parseYear(doc.placedInServiceDate) ?? parseYear(doc.purchaseDate);
    if (additionYear === targetYear) {
      additionsCount += 1;
      additionsCost += cost;
      additionsBusinessBasis += businessBasis;
    }

    items.push(toReportItem(doc, cost, busPct, businessBasis, salemTax));
  }

  return {
    year: targetYear,
    generatedAt: new Date().toISOString(),
    totalAssets: items.length,
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
    if (req.body.cost !== undefined && req.body.purchasePrice === undefined) {
      req.body.purchasePrice = req.body.cost;
    } else if (req.body.purchasePrice !== undefined && req.body.cost === undefined) {
      req.body.cost = req.body.purchasePrice;
    }
    return super.create(req, res);
  }

  override findByIdAndUpdate(req: Request<{ id: string }>, res: Response<unknown>): Response<unknown> | Promise<unknown> {
    if (req.body) {
      if (req.body.cost !== undefined && req.body.purchasePrice === undefined) {
        req.body.purchasePrice = req.body.cost;
      } else if (req.body.purchasePrice !== undefined && req.body.cost === undefined) {
        req.body.cost = req.body.purchasePrice;
      }
    }
    return super.findByIdAndUpdate(req, res);
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
