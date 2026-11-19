// Loaded before every test file (npm test passes --import ./test/guard.mjs): no test process reaches a real host
// unless LIVE=1 (round 10, item 2).
import './server-env.mjs'
