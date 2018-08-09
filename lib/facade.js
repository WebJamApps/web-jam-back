class Facade {
  constructor(Schema) {
    this.Schema = Schema;
  }

  create(input) {
    const schema = new this.Schema(input);
    return schema.save();
  }

  update(conditions, update) {
    return this.Schema
      .update(conditions, update, { new: true })
      .exec();
  }

  find(query) {
    return this.Schema
      .find(query)
      .exec();
  }

  remove(query) {
    return this.Schema
      .remove(query)
      .exec();
  }

  // deleteAll(query) {
  //   return this.Schema
  //   .find(query)
  //   .exec();
  // }

  // findOne(query) {
  //   return this.Schema
  //   .findOne(query)
  //   .exec();
  // }

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
