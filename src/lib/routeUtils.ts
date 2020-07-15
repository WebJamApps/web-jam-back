function setRoot(router, controller, authUtils) {
  router.route('/')
    .get((...args) => controller.find(...args))
    .post(authUtils.ensureAuthenticated, (...args) => controller.create(...args))
    .delete(authUtils.ensureAuthenticated, (...args) => controller.deleteMany(...args));
}
export default { setRoot };
