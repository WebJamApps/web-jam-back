const mongoConnect = (mongoose:any) => {
  let mongoDbUri: string = process.env.MONGO_DB_URI || /* istanbul ignore next */'';
  /* istanbul ignore else */
  if (process.env.NODE_ENV === 'test') mongoDbUri = process.env.TEST_DB || /* istanbul ignore next */'';
  mongoose.connect(mongoDbUri).then((m:any) => {
    console.log('connected to MongoDB');
    console.log(m.connections[0].name);
  })/* istanbul-ignore-next */.catch((e:Error) => { console.log(e.message); throw e; });
};
export default { mongoConnect };
