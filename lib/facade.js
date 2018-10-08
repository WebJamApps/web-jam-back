class Facade {
  constructor(Schema) {
    this.Schema = Schema;
  }

  create(input) {
    return this.Schema.create(input);
  }

  find(query) {
    return this.Schema
      .find(query)
      .exec();
  }

  deleteMany(query) {
    return this.Schema
      .deleteMany(query)
      .exec();
  }

  findOne(query) {
    return this.Schema.findOne(query).exec();
  }

  findOneAndUpdate(conditions, update) {
    return this.Schema.findOneAndUpdate(conditions, update, { new: true }).exec();
  }

  findByIdAndUpdate(id, update) {
    return this.Schema.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  findById(id) {
    return this.Schema
      .findById(id)
      .exec();
  }

  findByIdAndRemove(id) {
    return this.Schema
      .findByIdAndRemove(id)
      .exec();
  }
}

module.exports = Facade;
