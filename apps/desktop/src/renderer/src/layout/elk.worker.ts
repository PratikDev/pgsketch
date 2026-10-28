// ELK's own worker script: it answers the requests that `ELK` in `autoLayout.ts` sends it. It runs
// here and not on the page's thread because a layout can take a while for a big schema.
import 'elkjs/lib/elk-worker.min.js';
