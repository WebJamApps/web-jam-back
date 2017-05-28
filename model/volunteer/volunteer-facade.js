const Model = require('../../lib/facade');
const volunteerSchema  = require('./volunteer-schema');


class VolunteerModel extends Model {

}

module.exports = new VolunteerModel(volunteerSchema);
