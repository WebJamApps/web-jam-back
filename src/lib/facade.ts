class Facade {
  Schema: any;

  constructor(Schema: any) {
    this.Schema = Schema;
  }

  create(input: Record<string, unknown>): Promise<any> { return this.Schema.create(input); }

  async f(query: Record<string, unknown>, method: string): Promise<unknown> {
    let result;// eslint-disable-next-line security/detect-object-injection
    try { result = await this.Schema[method](query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  find(query: Record<string, unknown>): Promise<unknown> { return this.f(query, 'find'); }

  findOne(query: Record<string, unknown>): Promise<unknown> { return this.f(query, 'findOne'); }

  deleteMany(query: Record<string, unknown>): Promise<unknown> { return this.Schema.deleteMany(query); }

  async findOneAndUpdate(conditions: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown> {
    let result;
    try {
      result = await this.Schema.findOneAndUpdate(conditions, update, { new: true }).lean().exec();
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(result);
  }

  findByIdAndUpdate(id: string, update: string): void { return this.Schema.findByIdAndUpdate(id, update, { new: true }).lean().exec(); }

  findById(id: string): void { return this.Schema.findById(id).lean().exec(); }

  findByIdAndRemove(id: string): void { return this.Schema.findByIdAndRemove(id).lean().exec(); }
}

export default Facade;
