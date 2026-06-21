import Model from '../../lib/facade.js';
import templateSchema from './template-schema.js';

class TemplateModel extends Model {}

export default new TemplateModel(templateSchema);
