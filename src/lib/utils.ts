import { Error, Mongoose } from 'mongoose';

const mongoConnect = async (mongoose: Mongoose) => {
  let mongoDbUri: string = process.env.MONGO_DB_URI || /* istanbul ignore next */'';
  if (process.env.NODE_ENV === 'test') mongoDbUri = process.env.TEST_DB || /* istanbul ignore next */'';
  try {
    const m = await mongoose.connect(mongoDbUri);
    console.log('connected to MongoDB');
    console.log(m.connections[0].name);
  } catch (err) { console.log((err as Error).message); throw err; }
};
export default { mongoConnect };
