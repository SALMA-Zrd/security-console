// Wraps an async Express handler so a rejected promise (e.g. a database error)
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Wraps every handler already registered on an Express Router so a rejected
function protectRouter(router) {
  router.stack.forEach((layer) => {
    if (!layer.route) return;
    layer.route.stack.forEach((routeLayer) => {
      const original = routeLayer.handle;
      if (typeof original !== 'function' || original.length > 3) return; // skip error-handling middleware (4 args)
      routeLayer.handle = function (req, res, next) {
        try {
          const result = original(req, res, next);
          if (result && typeof result.catch === 'function') result.catch(next);
        } catch (e) {
          next(e);
        }
      };
    });
  });
  return router;
}

module.exports = asyncRoute;
module.exports.asyncRoute = asyncRoute;
module.exports.protectRouter = protectRouter;
