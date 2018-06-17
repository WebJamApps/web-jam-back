describe('Index test', () => {
  beforeEach((done) => {
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
    server = require('../../index'); // eslint-disable-line global-require
    done();
  });
  it('should return status 200 when use -> app.get', (done) => {
    chai.request(server)
      .get('/')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ')
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });
});
