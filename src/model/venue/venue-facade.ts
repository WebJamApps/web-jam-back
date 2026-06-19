import Model from '../../lib/facade.js';
import venueSchema from './venue-schema.js';

class VenueModel extends Model {}

export default new VenueModel(venueSchema);
