class Facade {
  constructor(Schema) {
    this.Schema = Schema;
  }

  create(input) {
    const schema = new this.Schema(input);
    return schema.save();
  }

  updateMany(conditions, update) {
    return this.Schema
      .updateMany(conditions, update, { new: true })
      .exec();
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
    return this.Schema.findOneAndUpdate(conditions, update, { new:true }).exec();
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
