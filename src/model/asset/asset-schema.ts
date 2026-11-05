import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

const assetSchema = new Schema({
  name: { type: String, required: true },
  category: { type: String, required: false },
  description: { type: String, required: false },
  serialNumber: { type: String, required: false },
  purchaseDate: { type: Date, required: false },
  purchasePrice: { type: Number, required: false },
  cost: { type: Number, required: false },
  placedInServiceDate: { type: Date, required: false },
  businessPercentage: { type: Number, required: false, default: 100 },
  salemPropertyTax: { type: Boolean, required: false, default: true },
  status: {
    type: String, required: false, enum: ['active', 'retired', 'sold', 'disposed'], default: 'active',
  },
  notes: { type: String, required: false },
}, options);

export default mongoose.models.Asset || mongoose.model('Asset', assetSchema);
