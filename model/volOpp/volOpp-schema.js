const mongoose = require('mongoose');

const { Schema } = mongoose;
const volOppSchema = new Schema({
  voName: { type: String, required: true },
  voCharityName: { type: String, required: true },
  voCharityId: { type: String, required: true },
  voCharityTypes: { type: [String], required: false },
  voStreet: { type: String, required: false },
  voCity: { type: String, required: false },
  voState: { type: String, required: false },
  voZipCode: { type: String, required: false },
  voStatus: { type: String, required: false },
  voNumPeopleNeeded: { type: Number, required: false },
  voPeopleScheduled: { type: [String], required: false },
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
