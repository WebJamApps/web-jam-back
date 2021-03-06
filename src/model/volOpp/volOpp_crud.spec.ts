/* eslint-disable jest/no-commented-out-tests */
// const server = require('../../../index');
// const VolOpp1 = require('../../../model/volOpp/volOpp-schema');
// const authUtils = require('../../../auth/authUtils');

// describe('The volunteer opportunity feature', () => {
// let allowedUrl;
// beforeEach((done) => {
//   allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];// eslint-disable-line prefer-destructuring
//   done();
// });
// it('does nothing', () => new Promise((done) => {
//   done();
// }));
// it('should create a new volunteer opportunity', (done) => {
//   chai.request(server)
//     .post('/volopp/create')
//     .set({ origin: allowedUrl })
//     .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
//     .send({ voName: 'clean the homeless shelter', voCharityId: '333333', voCharityName: 'Rescue Mission' })
//     .end((err, res) => {
//       expect(res).to.have.status(201);
//       done();
//     });
// });
// it('should find all events that were scheduled by a particular charity', (done) => {
//   const voOp = new VolOpp1();
//   voOp.voName = 'paint';
//   voOp.voCharityId = '44444';
//   voOp.voCharityName = 'painters';
//   chai.request(server)
//     .get('/volopp/44444')
//     .set({ origin: allowedUrl })
//     .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
//     .end((err, res) => {
//       expect(res).to.have.status(200);
//       done();
//     });
// });
// it('should find all events', (done) => {
//   const voOp4 = new VolOpp1();
//   voOp4.voName = 'paint';
//   voOp4.voCharityId = '44444';
//   voOp4.voCharityName = 'painters';
//   voOp4.save(() => {
//     chai.request(server)
//       .get('/volopp/getall')
//       .set({ origin: allowedUrl })
//       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
//       .end((err, res) => {
//         expect(res).to.have.status(200);
//         done();
//       });
//   });
// });
// it('should find the event by event id', async () => {
//   await VolOpp1.deleteMany({});
//   const voOp2 = new VolOpp1();
//   voOp2.voName = 'paint';
//   voOp2.voCharityId = '44444';
//   voOp2.voCharityName = 'painters';
//   const newEvent = await voOp2.save();
//   try {
//     const cb = await chai.request(server)
//       .get(`/volopp/get/${newEvent._id}`)
//       .set({ origin: allowedUrl })
//       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
//     expect(cb).to.have.status(200);
//   } catch (e) { throw e; }
// });
// it('update modify an event', async () => {
//   await VolOpp1.deleteMany({});
//   const voOp3 = new VolOpp1();
//   voOp3.voName = 'paint';
//   voOp3.voCharityId = '44444';
//   voOp3.voCharityName = 'painters';
//   const newEvent = await voOp3.save();
//   try {
//     const cb = await chai.request(server)
//       .put(`/volopp/${newEvent._id}`)
//       .set({ origin: allowedUrl })
//       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
//       .send({ voCharityName: 'foobar' });
//     expect(cb).to.have.status(200);
//     expect(cb.body.nModified > 0);
//   } catch (e) { throw e; }
// });
// it('should respond with error when updateMany does not exist', async () => {
//   let result;
//   try {
//     result = await chai.request(server)
//       .put('/volopp')
//       .set({ origin: allowedUrl })
//       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
//       .send({ voCharityName: 'foobar' });
//     expect(result.status).to.equal(500);
//   } catch (e) { throw e; }
// });
// it('should delete an event', async () => {
//   await VolOpp1.deleteMany({});
//   const event = new VolOpp1();
//   event.voName = 'foo';
//   event.voCharityId = '12345';
//   event.voCharityName = 'fuzzies';
//   const newEvent = await event.save();
//   try {
//     const cb = await chai.request(server)
//       .delete(`/volopp/${newEvent._id}`)
//       .set({ origin: allowedUrl })
//       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
//     expect(cb).to.have.status(200);
//   } catch (e) { throw e; }
// });
// });
