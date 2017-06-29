const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const volOppSchema = new Schema({
  voName: { type: String, required: true },
  voCharityId: { type: String, required: true },
  voNumPeopleNeeded: { type: Number, required: false },
  voDescription: { type: String, required: false },
  voWorkTypes: { type: [String], required: false },
  voStartDate: { type: Date, min: Date('2017-07-07'), required: false },
  voStartTime: { type: String, required: false },
  voEndDate: { type: Date, min: Date('2017-07-07'), required: false },
  voEndTime: { type: String, required: false },
  voContactName: { type: String, required: false },
  voContactEmail: { type: String, required: false },
  voContactPhone: { type: String, required: false }
});

module.exports = mongoose.model('VolOpp', volOppSchema);
