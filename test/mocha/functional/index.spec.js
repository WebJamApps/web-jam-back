/* eslint-disable jest/valid-expect */
/* eslint-disable no-useless-catch */
describe('Index test', () => {
  let allowedUrl, server;
  beforeEach((done) => {
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];// eslint-disable-line prefer-destructuring
    server = require('../../../index'); // eslint-disable-line global-require
    done();
  });
  it('should return status 200 when use -> app.get', (done) => {
    chai.request(server)
      .get('/anyrul')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ')
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });
  it('should return status 200 when use -> app.get to /music/buymusic', (done) => {
    chai.request(server)
      .get('/music/buymusic')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ')
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });
  it('should return status 200 when use -> app.get to /shop/inventory', (done) => {
    chai.request(server)
      .get('/shop/inventory')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ')
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });
});
