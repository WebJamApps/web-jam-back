// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Model, Document, Query } from 'mongoose';

class Facade {
  Schema: Record<string, any>;

  constructor(Schema: Record<string, any>) {
    this.Schema = Schema;
  }

  create(input: Record<string, unknown>): Promise<any> { return this.Schema.create(input); }

  async f(query: Query<any>, method: string):Promise<any> {
    let result;// eslint-disable-next-line security/detect-object-injection
    try { result = await this.Schema[method](query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return result;
  }

  find(query: Query<any>): Promise<any> { return this.f(query, 'find'); }

  findOne(query: Query<any>): Promise<any> { return this.f(query, 'findOne'); }

  deleteMany(query: Query<any>): Promise<any> { return this.Schema.deleteMany(query); }

  async findOneAndUpdate(conditions: Record<string, unknown>, update: Record<string, unknown>): Promise<any> {
    let result;
    try {
      result = await this.Schema.findOneAndUpdate(conditions, update, { new: true }).lean().exec();
    } catch (e) { return Promise.reject(e); }
    return result;
  }

  findByIdAndUpdate(id: string, update: Record<string, unknown>): Promise<any> { 
    return this.Schema.findByIdAndUpdate(id, update, { new: true }).lean().exec(); 
  }

  findById(id: string): Promise<any> { return this.Schema.findById(id).lean().exec(); }

  findByIdAndRemove(id: string): Promise<any> { return this.Schema.findByIdAndRemove(id).lean().exec(); }
}

export default Facade;
