describe('Index test', () => {
  let allowedUrl;
  beforeEach((done) => {
    mockgoose(mongoose).then(() => {
      allowedUrl = JSON.parse(process.env.AllowUrl).urls[0]; // eslint-disable-line
      global.server = require('../../index'); // eslint-disable-line global-require
      done();
    });
  });

  it('should return status 200 when use -> app.get', (done) => {
    chai.request(server)
      .get('/anyUrl')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ')
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });
});
