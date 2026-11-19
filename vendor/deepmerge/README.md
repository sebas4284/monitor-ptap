# Local deepmerge maintenance

This is an internal modified copy of **deepmerge 4.3.1**, identified as `4.3.1-ptap.1`.
It is not an upstream release or a claim that an upstream fixed version exists.

Copied from the already installed, reviewed package without downloading software:

| Original file | SHA256 before modification |
| --- | --- |
| `node_modules/deepmerge/dist/cjs.js` | `2E5160F84A1141BD927264AFE4D15766F1E6CF07DAEF182B37FF53FEA121DE7D` |
| `node_modules/deepmerge/index.d.ts` | `146BA4B99C5FEB82663E17A671BF9F53BB39C704CD76345D6C5A801C26372F44` |
| `node_modules/deepmerge/license.txt` | `6CFC4687CB2F2D86F4A77E6B526290D3878E5E512F3FEC2F4CB36A9CB36F798B` |

Upstream: https://github.com/TehShrike/deepmerge/tree/v4.3.1

The original MIT copyright and permission notice are preserved verbatim in `license.txt`;
retain this notice in copies or substantial portions of the software.

PTAP modification: omit the string keys `__proto__`, `constructor` and `prototype`
from both target and source object copy paths. Other enumerable symbol keys, array merging,
clone settings and custom merge options retain their existing behavior. Intentionally shared
objects with `clone: false` and arbitrary custom callbacks remain caller-controlled.

The root npm override resolves Expo's transitive dependency to this local package.
Run `npm run test:security:deps` to verify the actual installed resolution and regressions.
This bounded patch addresses the reproduced prototype-control key issue associated with
DEP-01; it does not certify the absence of other defects. Review future upstream releases
and replace or reassess this local copy when a suitable official fix becomes available.
