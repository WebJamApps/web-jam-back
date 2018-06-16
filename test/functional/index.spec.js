describe('Index test', () => {
  // beforeEach((done) => {
  // });
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
