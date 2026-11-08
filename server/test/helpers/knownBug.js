import { it } from 'vitest';

// A test that asserts the app's INTENDED behaviour but currently fails because
// of a confirmed application bug (documented in docs/hw2/BUGS.md). It is run
// with `it.fails`, so the suite stays green while the bug exists and this test
// starts failing as soon as the bug is fixed: then delete the knownBug wrapper.
export function knownBug(id, name, fn) {
  return it.fails(`[${id}] ${name}`, fn);
}
