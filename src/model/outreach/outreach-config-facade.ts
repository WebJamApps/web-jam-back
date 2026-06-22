import Model from '../../lib/facade.js';
import outreachConfigSchema from './outreach-config-schema.js';

class OutreachConfigModel extends Model {}

export default new OutreachConfigModel(outreachConfigSchema);
