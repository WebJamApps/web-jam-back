import type { Query, Document } from 'mongoose';

interface IdeleteMany {
  n:number;
  ok:number;
  deleteCount:number
}
interface Ischema {
  modelName:string;
  create:(...args:[Record<string, unknown>])=>Promise<Document>;
  deleteMany:(...args:[Query<any, any, any>])=>({ lean:()=>({ exec:()=>Promise<IdeleteMany | null> }) });
  findOneAndUpdate:(...args:[Record<string, unknown>, Record<string, unknown>, 
    { new:boolean }])=>({ lean:()=>({ exec:()=>Promise<Document | null> }) });
  findByIdAndUpdate:(...args:[string, Record<string, unknown>, { new:boolean }])=>({ lean:()=>({ exec:()=>Promise<Document | null> }) });
  findById:(...args:[string])=>({ lean:()=>({ exec:()=>Promise<Document | null> }) });
  findByIdAndDelete:(...args:[string])=>({ lean:()=>({ exec:()=>Promise<Document | null > }) });
  find:(...args:[Query<any, any, any>])=>({ lean:()=>({ exec:()=>Promise<Record<string, unknown>[]> }) });
  findOne:(...args:[Query<any, any, any>])=>({ lean:()=>({ exec:()=>Promise<Document | null> }) });
}

class Facade {
  Schema: Ischema;

  constructor(Schema: Ischema) {
    this.Schema = Schema;
  }

  create(input: Record<string, unknown>): Promise<Document> { return this.Schema.create(input); }

  find(query: Query<any, any, any>): Promise<Record<string, unknown>[]> { return this.Schema.find(query).lean().exec(); }

  findOne(query: Query<any, any, any>): Promise<Document | null> { return this.Schema.findOne(query).lean().exec(); }

  deleteMany(query: Query<any, any, any>): Promise<IdeleteMany | null> { return this.Schema.deleteMany(query).lean().exec(); }

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

  findByIdAndDelete(id: string): Promise<Document | null> { return this.Schema.findByIdAndDelete(id).lean().exec(); }
}

export default Facade;
