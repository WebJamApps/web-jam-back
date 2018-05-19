const VolOpp1 = require('../../model/volOpp/volOpp-schema');
const authUtils = require('../../auth/authUtils');

let previousId = '';
describe('The volunteer opportunity feature', () => {
  beforeEach((done) => {
    mockgoose(mongoose).then(() => {
        // VolOpp1.collection.drop();
      VolOpp1.ensureIndexes(() => {
        allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
        global.server = require('../../index'); // eslint-disable-line global-require
        done();
      });
    });
  });
  it('should create a new volunteer opportunity', (done) => {
    chai.request(server)
    .post('/volopp/create')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send({ voName: 'clean the homeless shelter', voCharityId: '333333', voCharityName: 'Rescue Mission' })
    .end((err, res) => {
      expect(res).to.have.status(201);
      done();
    });
  });

  it('should find all events that were scheduled by a particular charity', (done) => {
    const voOp = new VolOpp1();
    voOp.voName = 'paint';
    voOp.voCharityId = '44444';
    voOp.voCharityName = 'painters';
    chai.request(server)
    .get('/volopp/44444')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .end((err, res) => {
      expect(res).to.have.status(200);
      done();
    });
  });

  it('should find all events', (done) => {
    const voOp4 = new VolOpp1();
    voOp4.voName = 'paint';
    voOp4.voCharityId = '44444';
    voOp4.voCharityName = 'painters';
    voOp4.save((err) => {
      chai.request(server)
      .get('/volopp/getall')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
    });
  });

  it('should find the event by event id', (done) => {
    const voOp2 = new VolOpp1();
    voOp2.voName = 'paint';
    voOp2.voCharityId = '44444';
    voOp2.voCharityName = 'painters';
    const eventid = voOp2._id;
    chai.request(server)
    .get('/volopp/get/' + eventid)
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .end((err, res) => {
      // expect(
      //   res).to.have.status(200);
      done();
    });
  });

  it('should modify an event', (done) => {
    const voOp3 = new VolOpp1();
    voOp3.voName = 'paint';
    voOp3.voCharityId = '44444';
    voOp3.voCharityName = 'painters';
    voOp3.save();
    const eventid = voOp3._id;
    previousId = eventid;
    chai.request(server)
    .put('/volopp/' + eventid)
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send({ voCharityName: 'foobar' })
    .end((err, res) => {
      expect(res).to.have.status(200);
      expect(res.nModified > 0);
      done();
    });
  });

  it('should respond with 404 error when update by id has an id that does not exist', (done) => {
    const voOp3 = new VolOpp1();
    voOp3.voName = 'paint';
    voOp3.voCharityId = '44444';
    voOp3.voCharityName = 'painters';
    voOp3.save();
    // const eventid = voOp3._id;
    // voOp3.collection.drop(() => {
    chai.request(server)
    .put('/volopp/' + previousId)
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send({ voCharityName: 'foobar' })
    .end((err, res) => {
      expect(res).to.have.status(404);
      expect(res.nModified === 0);
      done();
    });
  // });
  });

  it('should delete an event', (done) => {
    const event = new VolOpp1();
    event.voName = 'foo';
    event.voCharityId = '12345';
    event.voCharityName = ['fuzzies'];
    event.save();
    chai.request(server)
    .delete('/volopp/' + event._id)
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .end((err, res) => {
      expect(res).to.have.status(204);
      done();
    });
  });
});
