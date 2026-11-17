import { handleGatewayRequest } from "./handler.mjs";

export default {
  fetch(request, env) {
    const limiter = env.AI_GATEWAY_RATE_LIMITER;
    return handleGatewayRequest(request, env, {
      fetchImpl: fetch,
      clientIp: request.headers.get("CF-Connecting-IP"),
      rateLimit: limiter
        ? (key) => limiter.limit({ key })
        : null,
    });
  },
};
