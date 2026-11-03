import { handleRequest } from './worker-core.mjs';

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
