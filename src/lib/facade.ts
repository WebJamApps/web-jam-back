class Facade {
  Schema:any;

  constructor(Schema: any) {
    this.Schema = Schema;
  }

  create(input) { return this.Schema.create(input); }

  async f(query, method) {
    let result;// eslint-disable-next-line security/detect-object-injection
    try { result = await this.Schema[method](query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  find(query) { return this.f(query, 'find'); }

  findOne(query) { return this.f(query, 'findOne'); }

  deleteMany(query) { return this.Schema.deleteMany(query); }

  async findOneAndUpdate(conditions, update) {
    let result;
    try {
      result = await this.Schema.findOneAndUpdate(conditions, update, { new: true }).lean().exec();
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  findByIdAndUpdate(id, update) { return this.Schema.findByIdAndUpdate(id, update, { new: true }).lean().exec(); }

  findById(id) { return this.Schema.findById(id).lean().exec(); }

  findByIdAndRemove(id) { return this.Schema.findByIdAndRemove(id).lean().exec(); }
}

export default Facade;
