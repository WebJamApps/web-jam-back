import Model from '../../lib/facade.js';
import subscriberSchema from './subscriber-schema.js';

class SubscriberModel extends Model {}

export default new SubscriberModel(subscriberSchema);
