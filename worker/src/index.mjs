import { handleRequest } from './worker-core.mjs';
export { ClaimAuth } from './claim-auth.mjs';

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
