const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const volOppSchema = new Schema({
  voName: { type: String, required: true },
  voCharityName: { type: String, required: true },
  voCharityId: { type: String, required: true },
  voNumPeopleNeeded: { type: Number, required: false },
  voDescription: { type: String, required: false },
  voWorkTypes: { type: [String], required: false },
  voWorkTypeOther: { type: String, required: false },
  voTalentTypeOther: { type: String, required: false },
  voTalentTypes: { type: [String], required: false },
  voStartDate: { type: Date, required: false },
  voStartTime: { type: String, required: false },
  voEndDate: { type: Date, required: false },
  voEndTime: { type: String, required: false },
  voContactName: { type: String, required: false },
  voContactEmail: { type: String, required: false },
  voContactPhone: { type: String, required: false }
});

module.exports = mongoose.model('VolOpp', volOppSchema);
