class Facade {
  Schema:any;

  constructor(Schema: any) {
    this.Schema = Schema;
  }

  create(input: any) { return this.Schema.create(input); }

  async f(query: any, method: any) {
    let result;// eslint-disable-next-line security/detect-object-injection
    try { result = await this.Schema[method](query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  find(query: any) { return this.f(query, 'find'); }

  findOne(query: any) { return this.f(query, 'findOne'); }

  deleteMany(query: any) { return this.Schema.deleteMany(query); }

  async findOneAndUpdate(conditions: any, update: any) {
    let result;
    try {
      result = await this.Schema.findOneAndUpdate(conditions, update, { new: true }).lean().exec();
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  findByIdAndUpdate(id: any, update: any) { return this.Schema.findByIdAndUpdate(id, update, { new: true }).lean().exec(); }

  findById(id: any) { return this.Schema.findById(id).lean().exec(); }

  findByIdAndRemove(id: any) { return this.Schema.findByIdAndRemove(id).lean().exec(); }
}

export default Facade;
