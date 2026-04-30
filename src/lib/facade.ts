import type {
  Model, QueryFilter, UpdateQuery, HydratedDocument,
} from 'mongoose';

type AnyDoc = Record<string, unknown>;

class Facade {
  Schema: Model<AnyDoc>;

  constructor(Schema: Model<AnyDoc>) {
    this.Schema = Schema;
  }

  create(input: AnyDoc): Promise<HydratedDocument<AnyDoc>> {
    return this.Schema.create(input) as unknown as Promise<HydratedDocument<AnyDoc>>;
  }

  find(query: QueryFilter<AnyDoc>): Promise<AnyDoc[]> {
    return this.Schema.find(query).lean().exec() as unknown as Promise<AnyDoc[]>;
  }

  findOne(query: QueryFilter<AnyDoc>): Promise<AnyDoc | null> {
    return this.Schema.findOne(query).lean().exec() as unknown as Promise<AnyDoc | null>;
  }

  deleteMany(query: QueryFilter<AnyDoc>): Promise<unknown> {
    return this.Schema.deleteMany(query).lean().exec();
  }

  async findOneAndUpdate(conditions: QueryFilter<AnyDoc>, update: UpdateQuery<AnyDoc>): Promise<AnyDoc | null> {
    try {
      return await this.Schema.findOneAndUpdate(conditions, update, { returnDocument: 'after' })
        .lean().exec() as unknown as AnyDoc | null;
    } catch (e) { return Promise.reject(e); }
  }

  findByIdAndUpdate(id: string, update: UpdateQuery<AnyDoc>): Promise<AnyDoc | null> {
    return this.Schema.findByIdAndUpdate(id, update, { returnDocument: 'after' })
      .lean().exec() as unknown as Promise<AnyDoc | null>;
  }

  findById(id: string): Promise<AnyDoc | null> {
    return this.Schema.findById(id).lean().exec() as unknown as Promise<AnyDoc | null>;
  }

  findByIdAndDelete(id: string): Promise<AnyDoc | null> {
    return this.Schema.findByIdAndDelete(id).lean().exec() as unknown as Promise<AnyDoc | null>;
  }
}

export default Facade;
