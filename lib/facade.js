class Facade {
  constructor(Schema) {
    this.Schema = Schema;
  }

  create(input) {
    return this.Schema.create(input);
  }

  async find(query) {
    if (query === undefined || query === null) query = {};// eslint-disable-line no-param-reassign
    let result;
    try { result = await this.Schema.find(query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  deleteMany(query) {
    return this.Schema.deleteMany(query);
  }

  async findOne(query) {
    let result;
    try { result = await this.Schema.findOne(query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  async findOneAndUpdate(conditions, update) {
    let result;
    try {
      result = await this.Schema.findOneAndUpdate(conditions, update, { new: true }).lean().exec();
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  findByIdAndUpdate(id, update) {
    return this.Schema.findByIdAndUpdate(id, update, { new: true }).lean().exec();
  }

  findById(id) {
    return this.Schema.findById(id).lean().exec();
  }

  findByIdAndRemove(id) {
    return this.Schema.findByIdAndRemove(id).lean().exec();
  }
}

module.exports = Facade;
