// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Query, Document } from 'mongoose';

enum Method {
  find = 'find', findOne = 'findOne'
}
interface Ischema {
  modelName:string;
  create:(...args:[Record<string, unknown>])=>Promise<Document>;
  deleteMany:(...args:[Query<Record<string, unknown>>])=>({lean:()=>({exec:()=>any})});
  findOneAndUpdate:(...args:[Record<string, unknown>, Record<string, unknown>, {new:boolean}])=>({lean:()=>({exec:()=>Promise<Document | null>})});
  findByIdAndUpdate:(...args:[string, Record<string, unknown>, {new:boolean}])=>({lean:()=>({exec:()=>Promise<Document | null>})});
  findById:(...args:[string])=>({lean:()=>({exec:()=>Promise<Document | null>})});
  findByIdAndRemove:(...args:[string])=>({lean:()=>({exec:()=>Promise<Document | null >})});
  find:(...args:[Query<Record<string, unknown>>])=>({lean:()=>({exec:()=>Promise<any>})});
  findOne:(...args:[Query<Record<string, unknown>>])=>({lean:()=>({exec:()=>Promise<Document | null>})});
}

class Facade {
  Schema: Ischema;

  constructor(Schema: Ischema) {
    this.Schema = Schema;
  }

  create(input: Record<string, unknown>): Promise<Document> { return this.Schema.create(input); }

  async f(query: Query<Record<string, unknown>>, method: Method):Promise<any| Document | null> {
    let result;// eslint-disable-next-line security/detect-object-injection
    try { result = await this.Schema[method](query).lean().exec(); } catch (e) { return Promise.reject(e); }
    return result;
  }

  find(query: Query<Record<string, unknown>>): Promise<any> { return this.f(query, Method.find); }

  findOne(query: Query<Record<string, unknown>>): Promise<Document | null> { return this.f(query, Method.findOne); }

  deleteMany(query: Query<Record<string, unknown>>): Promise<any> { return this.Schema.deleteMany(query).lean().exec(); }

  async findOneAndUpdate(conditions: Record<string, unknown>, update: Record<string, unknown>): Promise<Document | null> {
    let result;
    try {
      result = await this.Schema.findOneAndUpdate(conditions, update, { new: true }).lean().exec();
    } catch (e) { return Promise.reject(e); }
    return result;
  }

  findByIdAndUpdate(id: string, update: Record<string, unknown>): Promise<Document | null> { 
    return this.Schema.findByIdAndUpdate(id, update, { new: true }).lean().exec(); 
  }

  findById(id: string): Promise<Document | null> { return this.Schema.findById(id).lean().exec(); }

  findByIdAndRemove(id: string): Promise<Document | null> { return this.Schema.findByIdAndRemove(id).lean().exec(); }
}

export default Facade;
