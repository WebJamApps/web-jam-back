const Controller = require('../../lib/controller');
const volunteerModel  = require('./volunteer-facade');

class VolunteerController extends Controller {

}

module.exports = new VolunteerController(volunteerModel);
